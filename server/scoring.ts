/**
 * AI vision scoring service.
 *
 * Validates submitted drawing images and requests AI-generated scores from
 * the Google Gemini API (`@google/genai`). This module has no dependency on
 * Socket.IO or room state, so it can be unit/property tested in isolation and
 * reused by a dev-only scoring test harness script.
 *
 * All validators are defensive: they assume input is hostile (untrusted
 * client-supplied base64), cap work to prevent memory-exhaustion, and never
 * trust client-supplied types.
 */

import { GoogleGenAI, Type } from '@google/genai';
import { logScoringDebug } from './logger.js';

// ---------------------------------------------------------------------------
// Image validation
// ---------------------------------------------------------------------------

/** Decoded-image size ceiling: 5MB (5 * 1024 * 1024 bytes). */
const MAX_DECODED_BYTES = 5_242_880;

/**
 * Base64 encoding inflates size by ~4/3. Reject strings whose *encoded*
 * length alone already implies a decoded size over the limit before paying
 * the cost of base64-decoding a potentially huge hostile payload into a
 * Buffer.
 */
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
 * Validates a base64-encoded drawing image before it is ever forwarded to
 * the Gemini API:
 *  - rejects payloads whose decoded size exceeds 5,242,880 bytes (5MB)
 *  - accepts only images whose magic bytes match the PNG or JPEG signature
 *
 * Never throws. Treats non-string/empty input the same as an unsupported
 * format, since a hostile or malformed `submit_drawing` payload should be
 * rejected rather than crash the caller.
 */
export function validateImage(drawingBase64: string): ValidateImageResult {
    if (typeof drawingBase64 !== 'string' || drawingBase64.length === 0) {
        return { ok: false, reason: 'unsupported_format' };
    }

    // Fast reject of grossly oversized payloads before decoding, so a
    // hostile multi-hundred-MB string can't force a large allocation just
    // to be told "too large".
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

/** Model id is env-driven so it can be swapped without a code change. */
const SCORING_MODEL = process.env.SCORING_MODEL ?? 'gemini-2.5-flash';

/** Per-attempt wall-clock ceiling. A retry gets its own fresh budget. */
const API_TIMEOUT_MS = 10_000;

/** Fixed delay before the single network/rate-limit retry. */
const RETRY_DELAY_MS = 2_000;

/** Output cap: the response is a tiny JSON object, so this is generous. */
const MAX_OUTPUT_TOKENS = 300;

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
 * Constructed once at module load. Wrapped in try/catch so a missing or
 * malformed `GEMINI_API_KEY` degrades to "every scoring call fails with
 * api_error" instead of crashing the game server at import time.
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

export interface GeminiRequestArgs {
    promptText: string;
    drawingBase64: string;
    mimeType: 'image/png' | 'image/jpeg';
    timeoutMs: number;
}

/** Resolves to the model's raw text response, or rejects on any failure. */
export type GeminiRequestFn = (args: GeminiRequestArgs) => Promise<string>;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Single Gemini `generateContent` call: the image as an inline-data part plus
 * the prompt text, a system instruction, and a response schema that forces
 * the JSON shape we parse. Aborts (and rejects) after `timeoutMs`.
 */
async function defaultGeminiRequest(args: GeminiRequestArgs): Promise<string> {
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
                // Structured output: ask the API itself to guarantee the JSON
                // shape rather than relying on prompt-only coercion.
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        score: { type: Type.INTEGER, minimum: 0, maximum: 100 },
                        reasoning: { type: Type.STRING },
                    },
                    required: ['score', 'reasoning'],
                    propertyOrdering: ['score', 'reasoning'],
                },
                // gemini-2.5-* models spend output tokens on thinking by
                // default, which can starve a small maxOutputTokens budget.
                thinkingConfig: { thinkingBudget: 0 },
            },
        });

        const text = response.text;
        if (typeof text !== 'string' || text.trim().length === 0) {
            throw new Error('empty response from model');
        }
        return text;
    } finally {
        clearTimeout(timer);
    }
}

let requestFn: GeminiRequestFn = defaultGeminiRequest;

/**
 * Replace the underlying Gemini request function (for tests / the dev
 * harness). Pass `null` to restore the real implementation.
 */
export function setGeminiRequestFn(fn: GeminiRequestFn | null): void {
    requestFn = fn ?? defaultGeminiRequest;
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

function truncateWords(text: string, maxWords: number): string {
    const words = text.trim().split(/\s+/);
    if (words.length <= maxWords) return text.trim();
    return words.slice(0, maxWords).join(' ');
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
 * Retry policy A - network error / timeout / rate limit: one attempt, a fixed
 * 2s wait, then exactly one more attempt. Any thrown error is treated as
 * retryable, since the failure modes we care about (timeout, transient
 * network, 429) are indistinguishable enough at this layer that a single
 * extra attempt is always the right response.
 */
async function callWithRetry(args: GeminiRequestArgs): Promise<string | null> {
    try {
        return await requestFn(args);
    } catch {
        // fall through to the single retry
    }
    await delay(RETRY_DELAY_MS);
    try {
        return await requestFn(args);
    } catch {
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

    const raw = await callWithRetry(args);
    if (raw === null) {
        return finish(request, { score: 0, reasoning: null, error: 'api_error', raw: null }, summary);
    }

    const parsed = parseModelText(raw);
    if (parsed) {
        return finish(request, { score: parsed.score, reasoning: parsed.reasoning, error: null, raw }, summary);
    }

    // Retry policy B - the response arrived but isn't the JSON we expect.
    // Re-parsing identical text can't help, so issue exactly ONE fresh
    // generation (no further sub-retries) and parse that instead.
    let retryRaw: string | null = null;
    try {
        retryRaw = await requestFn(args);
    } catch {
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
