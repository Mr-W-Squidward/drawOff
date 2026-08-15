/**
 * Gemini connectivity / model-availability diagnostic. Run it when AI scoring
 * goes quiet: it answers "is this key valid, and is SCORING_MODEL still served
 * to it?".
 *
 * Run from the `server/` directory:
 *   npm run check:gemini
 * or directly:
 *   node --env-file=.env --loader ts-node/esm scripts/checkGemini.ts
 */

import process from 'node:process';
import { GoogleGenAI, Type, type GenerateContentConfig } from '@google/genai';

const DIAGNOSTIC_TIMEOUT_MS = 30_000;

/** Mirrors the system prompt in server/scoring.ts. */
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
 * A tiny opaque PNG (8x8, two-colour palette) used as the image part. The live
 * call only needs a real, valid image to exercise the vision path; the score it
 * comes back with is not meaningful.
 */
const TEST_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=';

const TEST_IMAGE_PROMPT = 'a small two-tone pattern';

// ---------------------------------------------------------------------------
// Reporting helpers
// ---------------------------------------------------------------------------

function section(title: string): void {
    console.log(`\n=== ${title} ===`);
}

/** Dumps everything an SDK error exposes: status, status text, body, cause. */
function reportError(error: unknown): void {
    if (typeof error !== 'object' || error === null) {
        console.log(`  error: ${String(error)}`);
        return;
    }
    const candidate = error as Record<string, unknown>;
    for (const key of ['name', 'message', 'status', 'code', 'statusText'] as const) {
        if (candidate[key] !== undefined) console.log(`  ${key}: ${String(candidate[key])}`);
    }
    if (candidate.response !== undefined) {
        try {
            console.log(`  response: ${JSON.stringify(candidate.response, null, 2)}`);
        } catch {
            console.log(`  response: [unserializable] ${String(candidate.response)}`);
        }
    }
    if (candidate.cause !== undefined) console.log(`  cause: ${String(candidate.cause)}`);
    console.log('  --- raw error ---');
    console.log(error);
}

/** Lifecycle info isn't part of the SDK's `Model` type, so read it loosely. */
function lifecycle(model: unknown): string {
    const status = (model as { status?: { modelStage?: unknown; retirementTime?: unknown } }).status;
    const stage = status?.modelStage === undefined ? '' : ` stage=${String(status.modelStage)}`;
    const retires = status?.retirementTime === undefined ? '' : ` retires=${String(status.retirementTime)}`;
    return `${stage}${retires}`;
}

// ---------------------------------------------------------------------------
// Request variants
// ---------------------------------------------------------------------------

// If every variant fails, the model id or the credential is at fault. If only
// the richer ones fail, the API is rejecting a config field.
type VariantName = 'current' | 'no_response_schema' | 'bare';

const STRUCTURED_OUTPUT = {
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
};

function buildConfig(variant: VariantName, abortSignal: AbortSignal): GenerateContentConfig | undefined {
    switch (variant) {
        // Exactly what server/scoring.ts sends today.
        case 'current':
            return {
                abortSignal,
                systemInstruction: SYSTEM_PROMPT,
                maxOutputTokens: 1_024,
                ...STRUCTURED_OUTPUT,
            };
        case 'no_response_schema':
            return {
                abortSignal,
                systemInstruction: SYSTEM_PROMPT,
                maxOutputTokens: 1_024,
            };
        case 'bare':
            return undefined;
    }
}

interface AttemptResult {
    ok: boolean;
    text: string | null;
}

async function attempt(
    genai: GoogleGenAI,
    model: string,
    variant: VariantName
): Promise<AttemptResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DIAGNOSTIC_TIMEOUT_MS);
    console.log(`\n-- generateContent [${variant}] model=${model}`);
    try {
        const config = buildConfig(variant, controller.signal);
        const response = await genai.models.generateContent({
            model,
            contents: [
                {
                    role: 'user',
                    parts: [
                        { inlineData: { mimeType: 'image/png', data: TEST_IMAGE_BASE64 } },
                        { text: `Prompt: "${TEST_IMAGE_PROMPT}"` },
                    ],
                },
            ],
            // Omitted rather than passed as undefined: `config` is an optional
            // property, not a nullable one.
            ...(config ? { config } : {}),
        });

        const text = response.text ?? null;
        console.log(`  OK. finishReason=${String(response.candidates?.[0]?.finishReason)}`);
        console.log(`  usage=${JSON.stringify(response.usageMetadata ?? null)}`);
        console.log(`  text=${text === null ? '<none>' : text}`);
        return { ok: true, text };
    } catch (error) {
        console.log('  FAILED');
        reportError(error);
        return { ok: false, text: null };
    } finally {
        clearTimeout(timer);
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    section('1. Credential');
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.log('GEMINI_API_KEY: MISSING. Nothing else can be checked.');
        process.exitCode = 1;
        return;
    }
    // Enough to tell two keys apart, never enough to use.
    console.log(`GEMINI_API_KEY: present, length=${apiKey.length}, starts with "${apiKey.slice(0, 4)}"`);

    const genai = new GoogleGenAI({ apiKey });
    const scoringModel = process.env.SCORING_MODEL ?? 'gemini-3.5-flash-lite';

    section('2. Models visible to this credential');
    const modelIds: string[] = [];
    try {
        const pager = await genai.models.list({ config: { pageSize: 100, queryBase: true } });
        for await (const model of pager) {
            const name = model.name ?? '<unnamed>';
            const id = name.startsWith('models/') ? name.slice('models/'.length) : name;
            modelIds.push(id);
            console.log(`  ${id}${lifecycle(model)}`);
            console.log(`      actions: ${model.supportedActions?.join(', ') ?? '<not reported>'}`);
        }
        console.log(`\n  total: ${modelIds.length} model(s)`);
    } catch (error) {
        console.log('  models.list() FAILED');
        reportError(error);
    }

    section('3. Configured scoring model');
    console.log(`SCORING_MODEL (env or default): ${scoringModel}`);
    if (modelIds.length === 0) {
        console.log('Result: could not verify - the model list is unavailable.');
    } else if (modelIds.includes(scoringModel)) {
        console.log('Result: PRESENT in the list above.');
    } else {
        console.log('Result: NOT in the list above. A generateContent call will 404.');
    }

    section('4. Live generateContent');
    const first = await attempt(genai, scoringModel, 'current');

    if (!first.ok) {
        section('5. Reduced-config variants (isolating the trigger)');
        for (const variant of ['no_response_schema', 'bare'] as const) {
            await attempt(genai, scoringModel, variant);
        }
        console.log(
            '\nReading the results: every variant failing points at the model id or the' +
            ' credential; only the richer variants failing points at a config field.'
        );
        return;
    }

    if (first.text !== null) {
        try {
            console.log(`  parsed: ${JSON.stringify(JSON.parse(first.text.trim()))}`);
        } catch {
            console.log('  parsed: FAILED - the text above is not JSON.');
        }
    }
}

await main();
