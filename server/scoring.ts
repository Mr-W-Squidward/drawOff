/**
 * AI vision scoring service.
 *
 * Validates submitted drawing images and asks the Google Gemini API to score
 * them. Knows nothing about Socket.IO or room state.
 *
 * Image input is untrusted client-supplied base64, so the validators assume
 * hostile input: cap sizes, check magic bytes, trust no client-supplied type.
 */

import { GoogleGenAI, Type } from '@google/genai';
import { logScoringDebug, logSecurityEvent } from './logger.js';

// ---------------------------------------------------------------------------
// Image validation
// ---------------------------------------------------------------------------

/** Decoded-image size ceiling: 5MB (5 * 1024 * 1024 bytes). */
const MAX_DECODED_BYTES = 5_242_880;

/** Same ceiling expressed in encoded chars (base64 inflates size by ~4/3). */
const MAX_ENCODED_CHARS = Math.ceil((MAX_DECODED_BYTES * 4) / 3) + 4;

/** PNG signature: 89 50 4E 47 0D 0A 1A 0A. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** JPEG signature (SOI marker + marker byte): FF D8 FF. */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;

function matchesSignature(buffer: Buffer, signature: readonly number[]): boolean {
    if (buffer.length < signature.length) return false;
    for (let i = 0; i < signature.length; i++) {
        if (buffer[i] !== signature[i]) return false;
    }
    return true;
}

export type ValidateImageResult =
    | { ok: true; mimeType: 'image/png' | 'image/jpeg' }
    | { ok: false; reason: string };

/**
 * Checks size and magic bytes before an image is ever forwarded to Gemini.
 * Never throws: empty or non-string input is reported as an unsupported
 * format so a malformed `submit_drawing` payload can't crash the caller.
 */
export function validateImage(drawingBase64: string): ValidateImageResult {
    if (typeof drawingBase64 !== 'string' || drawingBase64.length === 0) {
        return { ok: false, reason: 'unsupported_format' };
    }

    // Reject before decoding, so a huge string can't force a huge allocation.
    if (drawingBase64.length > MAX_ENCODED_CHARS) {
        return { ok: false, reason: 'too_large' };
    }

    let decoded: Buffer;
    try {
        decoded = Buffer.from(drawingBase64, 'base64');
    } catch {
        return { ok: false, reason: 'unsupported_format' };
    }

    if (decoded.length > MAX_DECODED_BYTES) {
        return { ok: false, reason: 'too_large' };
    }

    if (matchesSignature(decoded, PNG_SIGNATURE)) {
        return { ok: true, mimeType: 'image/png' };
    }
    if (matchesSignature(decoded, JPEG_SIGNATURE)) {
        return { ok: true, mimeType: 'image/jpeg' };
    }

    return { ok: false, reason: 'unsupported_format' };
}

// ---------------------------------------------------------------------------
// Gemini configuration
// ---------------------------------------------------------------------------

/**
 * Env-driven so the model can be swapped without a code change. The default
 * has to be a currently-served id; a retired one makes every call 404.
 */
const SCORING_MODEL = process.env.SCORING_MODEL ?? 'gemini-3.5-flash-lite';

/** Per-attempt wall-clock ceiling. A retry gets its own fresh budget. */
const API_TIMEOUT_MS = 10_000;

/** Fixed delay before the single network/rate-limit retry. */
const RETRY_DELAY_MS = 2_000;

/** Generous: thinking tokens share this budget, so a tight cap returns empty text. */
const MAX_OUTPUT_TOKENS = 1_024;

const SYSTEM_PROMPT = [
    'You are a strict judge for a drawing game. You will be shown one player\'s',
    'drawing and the prompt they were asked to draw. Judge how well the drawing',
    'matches the prompt on: recognizability, relevance to the prompt, and',
    'effort/completeness. Respond with STRICT JSON only, no markdown fences, no',
    'extra prose:',
    '',
    '{"score": <integer 0-100>, "reasoning": "<under 50 words>"}',
].join('\n');

/**
 * Built once at module load. A missing or malformed `GEMINI_API_KEY` leaves
 * this null, so scoring fails with `api_error` instead of taking the game
 * server down at import time.
 */
const genai: GoogleGenAI | null = (() => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    try {
        return new GoogleGenAI({ apiKey });
    } catch {
        return null;
    }
})();

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoreRequest {
    promptText: string;
    /** Raw base64, no data-URL prefix. */
    drawingBase64: string;
    playerId: string;
    /** Debug-log context only; never sent to the model. */
    roomId?: string | undefined;
    /** Debug-log context only; never sent to the model. */
    side?: 'left' | 'right' | undefined;
}

export interface ScoreResult {
    /** 0-100, clamped. 0 whenever `error` is non-null. */
    score: number;
    /** null when a fallback/error result. */
    reasoning: string | null;
    error: 'invalid_image' | 'api_error' | 'malformed_response' | null;
    /** Raw model text, for debug logging only. */
    raw: string | null;
}

interface GeminiRequestArgs {
    promptText: string;
    drawingBase64: string;
    mimeType: 'image/png' | 'image/jpeg';
    timeoutMs: number;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One Gemini `generateContent` call: the image as an inline-data part, the
 * prompt text, a system instruction, and a response schema that pins the JSON
 * shape we parse. Aborts (and rejects) after `timeoutMs`.
 */
async function geminiRequest(args: GeminiRequestArgs): Promise<string> {
    if (!genai) throw new Error('GEMINI_API_KEY is not configured');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), args.timeoutMs);
    try {
        const response = await genai.models.generateContent({
            model: SCORING_MODEL,
            contents: [
                {
                    role: 'user',
                    parts: [
                        { inlineData: { mimeType: args.mimeType, data: args.drawingBase64 } },
                        { text: `Prompt: "${args.promptText}"` },
                    ],
                },
            ],
            config: {
                abortSignal: controller.signal,
                systemInstruction: SYSTEM_PROMPT,
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                // Let the API guarantee the JSON shape instead of relying on
                // the prompt. The 0-100 range is left to clampScore() so the
                // schema only uses fields the endpoint definitely accepts.
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        score: { type: Type.INTEGER },
                        reasoning: { type: Type.STRING },
                    },
                    required: ['score', 'reasoning'],
                    propertyOrdering: ['score', 'reasoning'],
                },
            },
        });

        const text = response.text;
        if (typeof text !== 'string' || text.trim().length === 0) {
            // An empty answer is nearly always MAX_TOKENS or a safety block,
            // so carry the finish reason and usage into the logged message.
            throw new Error(
                'empty response from model' +
                ` (finishReason=${String(response.candidates?.[0]?.finishReason)},` +
                ` usage=${JSON.stringify(response.usageMetadata ?? null)})`
            );
        }
        return text;
    } finally {
        clearTimeout(timer);
    }
}

// ---------------------------------------------------------------------------
// Failure diagnostics
// ---------------------------------------------------------------------------

/** Cap on how much raw model text / error text is ever copied into a log. */
const LOG_TEXT_LIMIT = 500;

/** Which call in the retry sequence produced the failure being logged. */
type ScoringStage = 'initial' | 'retry' | 'reparse_retry';

interface ScoringLogContext {
    roomId: string;
    side?: 'left' | 'right' | undefined;
    playerId: string;
}

function truncate(text: string, limit: number = LOG_TEXT_LIMIT): string {
    return text.length <= limit ? text : `${text.slice(0, limit)}...[truncated]`;
}

/**
 * Flattens a failed request into a loggable shape. Field by field rather than
 * a blanket stringify, so nothing unexpected (an echoed request payload, say)
 * ends up in the log.
 */
function describeError(error: unknown): Record<string, unknown> {
    if (typeof error !== 'object' || error === null) {
        return { message: truncate(String(error)) };
    }
    const { name, message, status, code, statusText, response } = error as Record<string, unknown>;
    const details: Record<string, unknown> = {};
    if (typeof name === 'string') details.errorName = name;
    if (typeof message === 'string') details.message = truncate(message);
    if (typeof status === 'number' || typeof status === 'string') details.status = status;
    if (typeof code === 'number' || typeof code === 'string') details.code = code;
    if (typeof statusText === 'string') details.statusText = statusText;
    if (response !== undefined) {
        try {
            details.response = truncate(
                typeof response === 'string' ? response : JSON.stringify(response)
            );
        } catch {
            details.response = '[unserializable]';
        }
    }
    return details;
}

/**
 * Records a failed Gemini request. Not gated behind `DEBUG_SCORING`: this is
 * the only signal that AI scoring is broken, and with it hidden a total API
 * outage looks like an honest `score: 0` on both sides.
 */
function logScoringApiError(context: ScoringLogContext, stage: ScoringStage, error: unknown): void {
    logSecurityEvent({
        event: 'scoring_api_error',
        severity: 'warn',
        source: context.roomId,
        details: {
            stage,
            model: SCORING_MODEL,
            playerId: context.playerId,
            side: context.side,
            ...describeError(error),
        },
    });
}

/** Strips ```json ... ``` fences that models sometimes add anyway. */
function stripMarkdownFences(text: string): string {
    const trimmed = text.trim();
    if (!trimmed.startsWith('```')) return trimmed;
    return trimmed
        .replace(/^```[A-Za-z0-9_-]*\s*/, '')
        .replace(/```\s*$/, '')
        .trim();
}

function clampScore(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, Math.round(value)));
}

/** Backstop for the prompt's "under 50 words" - the model can ignore it. */
function truncateWords(text: string, maxWords: number): string {
    const words = text.trim().split(/\s+/);
    return words.length <= maxWords ? text.trim() : words.slice(0, maxWords).join(' ');
}

/** Parses the model text into a score/reasoning pair, or null if unusable. */
function parseModelText(raw: string): { score: number; reasoning: string } | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(stripMarkdownFences(raw));
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as { score?: unknown; reasoning?: unknown };
    if (typeof candidate.score !== 'number' || !Number.isFinite(candidate.score)) return null;
    if (typeof candidate.reasoning !== 'string') return null;
    return {
        score: clampScore(candidate.score),
        reasoning: truncateWords(candidate.reasoning, 50),
    };
}

/**
 * Retry policy A - network error, timeout or rate limit: one attempt, a fixed
 * 2s wait, then one more. Every thrown error is treated as retryable; at this
 * layer the cases worth distinguishing all warrant the same single retry.
 */
async function callWithRetry(
    args: GeminiRequestArgs,
    context: ScoringLogContext
): Promise<string | null> {
    try {
        return await geminiRequest(args);
    } catch (error) {
        // Swallowed for control flow, but never silently.
        logScoringApiError(context, 'initial', error);
    }
    await delay(RETRY_DELAY_MS);
    try {
        return await geminiRequest(args);
    } catch (error) {
        logScoringApiError(context, 'retry', error);
        return null;
    }
}

/**
 * Validates the image, calls Gemini with a vision part, parses the strict-JSON
 * response and applies both retry policies. Never throws - always resolves to
 * a `ScoreResult`, so callers never need try/catch around scoring.
 */
export async function scoreDrawing(request: ScoreRequest): Promise<ScoreResult> {
    const validation = validateImage(request.drawingBase64);
    if (!validation.ok) {
        // Short-circuit: a rejected image never reaches the Gemini API.
        return finish(request, { score: 0, reasoning: null, error: 'invalid_image', raw: null }, {
            model: SCORING_MODEL,
            skipped: true,
            imageRejectedReason: validation.reason,
        });
    }

    const args: GeminiRequestArgs = {
        promptText: request.promptText,
        drawingBase64: request.drawingBase64,
        mimeType: validation.mimeType,
        timeoutMs: API_TIMEOUT_MS,
    };
    const summary = {
        model: SCORING_MODEL,
        mimeType: validation.mimeType,
        encodedChars: request.drawingBase64.length,
        timeoutMs: API_TIMEOUT_MS,
    };

    const logContext: ScoringLogContext = {
        roomId: request.roomId ?? request.playerId,
        side: request.side,
        playerId: request.playerId,
    };

    const raw = await callWithRetry(args, logContext);
    if (raw === null) {
        return finish(request, { score: 0, reasoning: null, error: 'api_error', raw: null }, summary);
    }

    const parsed = parseModelText(raw);
    if (parsed) {
        return finish(request, { score: parsed.score, reasoning: parsed.reasoning, error: null, raw }, summary);
    }

    // Retry policy B - the response arrived but isn't the JSON we expect.
    // Re-parsing the same text can't help, so ask for one fresh generation
    // (no further sub-retries) and parse that instead.
    let retryRaw: string | null = null;
    try {
        retryRaw = await geminiRequest(args);
    } catch (error) {
        logScoringApiError(logContext, 'reparse_retry', error);
        retryRaw = null;
    }
    const retryParsed = retryRaw === null ? null : parseModelText(retryRaw);
    if (retryParsed && retryRaw !== null) {
        return finish(
            request,
            { score: retryParsed.score, reasoning: retryParsed.reasoning, error: null, raw: retryRaw },
            summary
        );
    }

    // Also logged unconditionally, with the offending text truncated.
    logSecurityEvent({
        event: 'scoring_malformed_response',
        severity: 'warn',
        source: logContext.roomId,
        details: {
            model: SCORING_MODEL,
            playerId: logContext.playerId,
            side: logContext.side,
            firstAttemptText: truncate(raw),
            retryText: retryRaw === null ? null : truncate(retryRaw),
        },
    });

    return finish(
        request,
        { score: 0, reasoning: null, error: 'malformed_response', raw: retryRaw ?? raw },
        summary
    );
}

/**
 * Emits the single per-invocation debug log entry (metadata + raw model text
 * only, never the base64 image) and returns the result unchanged.
 */
function finish(
    request: ScoreRequest,
    result: ScoreResult,
    requestPayloadSummary: Record<string, unknown>
): ScoreResult {
    logScoringDebug({
        roomId: request.roomId ?? request.playerId,
        side: request.side,
        promptText: request.promptText,
        requestPayloadSummary: { ...requestPayloadSummary, playerId: request.playerId },
        rawResponse: result.raw,
        parsedResult: result,
    });
    return result;
}
