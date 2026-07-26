import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
