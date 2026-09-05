import type { Stroke } from '../src/types/canvas.types.js';

/**
 * Input validation / sanitization helpers and a small in-memory rate limiter
 * for Socket.IO events (express-rate-limit only covers HTTP).
 *
 * All validators are defensive: they assume input is hostile, cap sizes to
 * prevent memory-exhaustion, and never trust client-supplied types.
 */

// ---------------------------------------------------------------------------
// Scalar validation / sanitization
// ---------------------------------------------------------------------------

/** Session ids are opaque tokens; restrict to a safe charset and length. */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Validate + sanitize a client-supplied session id.
 * Returns the trimmed id when valid, otherwise null.
 */
export function sanitizeSessionId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!SESSION_ID_RE.test(trimmed)) return null;
    return trimmed;
}

/** Room ids are server-generated UUIDs or short user codes; keep them tight. */
const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function sanitizeRoomId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!ROOM_ID_RE.test(trimmed)) return null;
    return trimmed;
}

// ---------------------------------------------------------------------------
// Drawing payload validation
// ---------------------------------------------------------------------------

// Bound the shape of a stroke so a malicious client cannot exhaust memory.
const MAX_POINTS_PER_STROKE = 5_000;
const MAX_STROKE_WIDTH = 200;
const COLOUR_RE = /^#?[0-9A-Za-z(),.\s%]{1,32}$/; // hex / rgb() / named colours

function isFiniteNumber(n: unknown): n is number {
    return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Validate a client-supplied stroke. Returns a normalized Stroke or null.
 * Coordinates are clamped to finite numbers; the object is rebuilt so no
 * extra/prototype-polluting keys survive.
 */
export function sanitizeStroke(value: unknown): Stroke | null {
    if (typeof value !== 'object' || value === null) return null;
    const s = value as Record<string, unknown>;

    if (s.type !== 'brush' && s.type !== 'eraser') return null;
    if (typeof s.colour !== 'string' || !COLOUR_RE.test(s.colour)) return null;
    if (!isFiniteNumber(s.width) || s.width <= 0 || s.width > MAX_STROKE_WIDTH) return null;
    if (!Array.isArray(s.points) || s.points.length === 0 || s.points.length > MAX_POINTS_PER_STROKE) return null;

    const points: Array<{ x: number; y: number }> = [];
    for (const p of s.points) {
        if (typeof p !== 'object' || p === null) return null;
        const pt = p as Record<string, unknown>;
        if (!isFiniteNumber(pt.x) || !isFiniteNumber(pt.y)) return null;
        if (pt.x < 0 || pt.x > 1000 || pt.y < 0 || pt.y > 750) return null;
        points.push({ x: pt.x, y: pt.y });
    }

    return { type: s.type, colour: s.colour, width: s.width, points };
}

// ---------------------------------------------------------------------------
// In-memory Socket.IO rate limiter (token bucket per socket + event)
// ---------------------------------------------------------------------------

interface Bucket {
    tokens: number;
    updatedAt: number;
}

export interface RateLimitRule {
    /** Sustained requests allowed per second. */
    ratePerSec: number;
    /** Maximum burst (bucket capacity). */
    burst: number;
}

export class SocketRateLimiter {
    private buckets = new Map<string, Bucket>();

    constructor(private readonly rules: Record<string, RateLimitRule>) {}

    /**
     * Returns true if the event is allowed, false if it should be dropped.
     * Unknown events fall back to a conservative default rule.
     */
    allow(socketId: string, event: string): boolean {
        const rule = this.rules[event] ?? this.rules.default;
        if (!rule) return true;

        const key = `${socketId}:${event}`;
        const now = Date.now();
        const bucket = this.buckets.get(key) ?? { tokens: rule.burst, updatedAt: now };

        // Refill based on elapsed time.
        const elapsedSec = (now - bucket.updatedAt) / 1000;
        bucket.tokens = Math.min(rule.burst, bucket.tokens + elapsedSec * rule.ratePerSec);
        bucket.updatedAt = now;

        if (bucket.tokens < 1) {
            this.buckets.set(key, bucket);
            return false;
        }

        bucket.tokens -= 1;
        this.buckets.set(key, bucket);
        return true;
    }

    /** Drop all buckets for a disconnected socket to avoid unbounded growth. */
    clear(socketId: string): void {
        for (const key of this.buckets.keys()) {
            if (key.startsWith(`${socketId}:`)) this.buckets.delete(key);
        }
    }
}
