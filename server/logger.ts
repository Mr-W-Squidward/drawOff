import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Type-only, so it erases at compile time and creates no import cycle.
import type { ScoreResult } from './scoring.js';

/**
 * Lightweight security / audit logger.
 *
 * Writes structured JSON lines to both stdout and an on-disk log file so that
 * suspicious activity (rate-limit trips, malformed payloads, rejected input,
 * etc.) is retained for later inspection if the app is being attacked.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, 'logs');
const SECURITY_LOG = join(LOG_DIR, 'security.log');
const SCORING_LOG = join(LOG_DIR, 'scoring.log');

export type SecuritySeverity = 'info' | 'warn' | 'alert';

export interface SecurityEvent {
    /** Machine-readable event category, e.g. "rate_limit", "invalid_input". */
    event: string;
    severity?: SecuritySeverity | undefined;
    /** Best-effort client identifier (IP address or socket id). */
    source?: string | undefined;
    /** Any extra structured context. Never log secrets here. */
    details?: Record<string, unknown> | undefined;
}

let logDirReady: Promise<void> | null = null;

function ensureLogDir(): Promise<void> {
    if (!logDirReady) {
        logDirReady = mkdir(LOG_DIR, { recursive: true }).then(() => undefined);
    }
    return logDirReady;
}

/**
 * Record a security-relevant event. Fire-and-forget: logging failures must
 * never take down a request or socket handler.
 */
export function logSecurityEvent(evt: SecurityEvent): void {
    const record = {
        ts: new Date().toISOString(),
        severity: evt.severity ?? 'warn',
        event: evt.event,
        source: evt.source ?? 'unknown',
        ...(evt.details ? { details: evt.details } : {}),
    };

    const line = JSON.stringify(record);

    // Surface to the process console immediately.
    if (record.severity === 'alert') console.error(`[SECURITY] ${line}`);
    else console.warn(`[SECURITY] ${line}`);

    // Persist to disk without blocking the caller.
    void ensureLogDir()
        .then(() => appendFile(SECURITY_LOG, line + '\n', 'utf8'))
        .catch((err) => console.error('[SECURITY] failed to write log file:', err));
}

export interface ScoringDebugEvent {
    roomId: string;
    /** Omitted when the caller has no side context. */
    side?: 'left' | 'right' | undefined;
    promptText: string;
    /** Request metadata only (e.g. model, image size/format) - never the full base64 image. */
    requestPayloadSummary: Record<string, unknown>;
    rawResponse: string | null;
    parsedResult: ScoreResult;
}

/**
 * Record raw AI scoring request/response data for prompt tuning. High-volume
 * and debug-only, so it no-ops unless `DEBUG_SCORING=true` and writes to its
 * own `scoring.log`. Fire-and-forget, same as `logSecurityEvent`.
 *
 * Never write base64 image data here - `requestPayloadSummary` should carry a
 * size/format summary at most.
 */
export function logScoringDebug(evt: ScoringDebugEvent): void {
    if (process.env.DEBUG_SCORING !== 'true') return;

    const record = {
        ts: new Date().toISOString(),
        roomId: evt.roomId,
        side: evt.side,
        promptText: evt.promptText,
        requestPayloadSummary: evt.requestPayloadSummary,
        rawResponse: evt.rawResponse,
        parsedResult: evt.parsedResult,
    };

    const line = JSON.stringify(record);

    // Persist to disk without blocking the caller.
    void ensureLogDir()
        .then(() => appendFile(SCORING_LOG, line + '\n', 'utf8'))
        .catch((err) => console.error('[SCORING] failed to write log file:', err));
}
