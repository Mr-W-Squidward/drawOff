import express from 'express';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import type { Stroke } from '../src/types/canvas.types.js';
import wordList, { chooseRandomWord } from '../src/constants/constants.js';
import { db, initDb } from './db.js';
import { logSecurityEvent } from './logger.js';
import { scoreDrawing, validateImage, type ScoreResult } from './scoring.js';
import {
    SocketRateLimiter,
    sanitizeClientId,
    sanitizeRoomId,
    sanitizeSessionId,
    sanitizeStroke,
} from './security.js';

const PORT = Number(process.env.PORT ?? 5174);

// Allow-list of origins permitted to call the API / connect over websockets.
// Override in production via CORS_ORIGIN (comma-separated).
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

const app = express();

// Trust the first proxy hop so rate limiting keys off the real client IP
// when running behind a reverse proxy / load balancer.
app.set('trust proxy', 1);

// Security headers (CSP, HSTS, no-sniff, frameguard, etc.).
app.use(helmet());

// Lock CORS down to the known frontend origin(s) instead of allowing all.
app.use(
    cors({
        origin: ALLOWED_ORIGINS,
        methods: ['GET', 'POST'],
    })
);

// Cap request body size to blunt memory-exhaustion / payload-flood attacks.
app.use(express.json({ limit: '16kb' }));

// Global HTTP rate limiter applied to every API route.
const apiLimiter = rateLimit({
    windowMs: 60_000, // 1 minute
    limit: 120, // 120 requests / minute / IP
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logSecurityEvent({
            event: 'http_rate_limit',
            severity: 'warn',
            source: req.ip,
            details: { method: req.method, path: req.originalUrl },
        });
        res.status(429).json({ ok: false, error: 'too many requests' });
    },
});
app.use('/api', apiLimiter);

const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: ALLOWED_ORIGINS,
        methods: ['GET', 'POST'],
    },
    // Raised from the 1 MB default so validateImage()'s 5 MB decoded-image
    // limit is actually reachable once base64 inflation is accounted for.
    maxHttpBufferSize: 6 * 1024 * 1024,
});

// Per-socket event rate limits (token bucket). "draw" is high-frequency during
// a round, so it gets a generous allowance; lobby/control events are strict.
const socketLimiter = new SocketRateLimiter({
    join_room: { ratePerSec: 2, burst: 5 },
    find_match: { ratePerSec: 2, burst: 5 },
    start_round: { ratePerSec: 1, burst: 3 },
    cast_vote: { ratePerSec: 5, burst: 10 },
    draw: { ratePerSec: 120, burst: 240 },
    // Same tier as `draw`. Cost is bounded by the handler's one-submission-
    // per-side guard, not by this bucket.
    submit_drawing: { ratePerSec: 120, burst: 240 },
    undo: { ratePerSec: 10, burst: 20 },
    redo: { ratePerSec: 10, burst: 20 },
    default: { ratePerSec: 20, burst: 40 },
});

/**
 * Guard a socket event: enforces the rate limit and logs abuse.
 * Returns true when the handler should proceed.
 */
function allowSocketEvent(socket: Socket, event: string): boolean {
    if (socketLimiter.allow(socket.id, event)) return true;
    logSecurityEvent({
        event: 'socket_rate_limit',
        severity: 'warn',
        source: socket.id,
        details: { socketEvent: event, address: socket.handshake.address },
    });
    return false;
}

const ROOM_CAPACITY = 5;
const ROUND_DURATION_MS = 60_000;
const RESULT_DISPLAY_MS = 5_000;
/**
 * Window for both snapshots to arrive and both scoring calls to resolve. The
 * round resolves early once both scores are in, and unconditionally when this
 * expires, so a missing submission or hung API call can't stall a room.
 */
const AI_SCORING_WINDOW_MS = 10_000;
/**
 * Voter key for the AI's single vote. The ':' is what makes it collision-proof:
 * clientIds (`sanitizeClientId`) and socket ids are `[A-Za-z0-9_-]` only.
 */
const AI_VOTER_KEY = '__ai__:system';
type RoomRole = 'left' | 'right' | 'judge';
type RoundPhase = 'lobby' | 'drawing' | 'results';
type Vote = 'left' | 'right';

interface RoomState {
    members: Map<string, RoomRole>;
    historyLeft: Stroke[];
    historyRight: Stroke[];
    indexLeft: number;
    indexRight: number;
    phase: RoundPhase;
    roundEndsAt: number | null;
    /** Keyed by clientId, not socket.id, so a judge who reloads their tab is
     * still the same voter rather than getting a fresh vote slot. */
    votes: Map<string, Vote>;
    hasStarted: boolean;
    endTimer: NodeJS.Timeout | undefined;
    tickTimer: NodeJS.Timeout | undefined;
    /** Server-selected prompt for the current round; never client-supplied. */
    promptText: string | null;
    /** Final canvas exports (raw base64 PNG), one per drawing side. */
    drawingSnapshots: { left: string | null; right: string | null };
    /** AI score per side; null until that side's scoring call resolves. */
    scores: { left: ScoreResult | null; right: ScoreResult | null };
    /** True between `request_drawings` and round resolution. */
    scoringActive: boolean;
    scoringTimer: NodeJS.Timeout | undefined;
}

const rooms = new Map<string, RoomState>();
const socketRooms = new Map<string, string>();
// socket.id -> the clientId sent on join, so events on this connection can be
// attributed to an identity that survives a page reload.
const socketClientIds = new Map<string, string>();

// Socket.IO handlers may be async and adapters can make room operations async.
// Serialising admission keeps "find a room" and "reserve its final slot" atomic.
let admissionQueue = Promise.resolve();
function withAdmissionLock<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = admissionQueue.then(operation, operation);
    admissionQueue = result.then(() => undefined, () => undefined);
    return result;
}

function createRoom(roomId = `game_${randomUUID()}`): [string, RoomState] {
    const room: RoomState = {
        members: new Map(),
        historyLeft: [],
        historyRight: [],
        indexLeft: -1,
        indexRight: -1,
        phase: 'lobby',
        roundEndsAt: null,
        votes: new Map(),
        hasStarted: false,
        endTimer: undefined,
        tickTimer: undefined,
        promptText: null,
        drawingSnapshots: { left: null, right: null },
        scores: { left: null, right: null },
        scoringActive: false,
        scoringTimer: undefined,
    };
    rooms.set(roomId, room);
    return [roomId, room];
}

function roleForRoom(room: RoomState): RoomRole {
    if (![...room.members.values()].includes('left')) return 'left';
    if (![...room.members.values()].includes('right')) return 'right';
    return 'judge';
}

/**
 * Per-side tally of the human judges' votes, for the live in-round display.
 * `AI_VOTER_KEY` is skipped explicitly: today the AI vote is only written in
 * `finishRound` (after the voting window closes) so it can't be present here,
 * but excluding it means the live counters still can't leak the AI's pick if
 * the voting window is ever widened into the scoring phase.
 * `finishRound` does its own tally that intentionally *includes* the AI vote.
 */
function tallyJudgeVotes(room: RoomState): { leftVotes: number; rightVotes: number } {
    let leftVotes = 0;
    let rightVotes = 0;
    for (const [voterKey, vote] of room.votes) {
        if (voterKey === AI_VOTER_KEY) continue;
        if (vote === 'left') leftVotes += 1;
        else if (vote === 'right') rightVotes += 1;
    }
    return { leftVotes, rightVotes };
}

function clearRoundTimers(room: RoomState) {
    if (room.endTimer) clearTimeout(room.endTimer);
    if (room.tickTimer) clearInterval(room.tickTimer);
    if (room.scoringTimer) clearTimeout(room.scoringTimer);
    room.endTimer = undefined;
    room.tickTimer = undefined;
    room.scoringTimer = undefined;
}

function emitRoomState(roomId: string, room: RoomState) {
    io.to(roomId).emit('room_state', {
        left: { history: room.historyLeft, index: room.indexLeft },
        right: { history: room.historyRight, index: room.indexRight },
    });
}

/**
 * Runs when the drawing timer fires: closes drawing and voting, asks both
 * drawers for their final canvas export, and arms the deadline that resolves
 * the round even if nothing else arrives.
 */
function beginScoring(roomId: string, room: RoomState) {
    if (room.phase !== 'drawing' || room.scoringActive) return;
    clearRoundTimers(room);
    // Nulling roundEndsAt is what closes the draw and vote windows - both
    // handlers require a live one - while the phase stays 'drawing'.
    room.roundEndsAt = null;
    room.scoringActive = true;

    const deadline = Date.now() + AI_SCORING_WINDOW_MS;
    io.to(roomId).emit('request_drawings', { room: roomId, deadline });
    room.scoringTimer = setTimeout(() => finishRound(roomId, room), AI_SCORING_WINDOW_MS);
}

/** Scores one side as soon as its snapshot arrives, independently of the other. */
async function scoreSide(roomId: string, room: RoomState, side: Vote, imageBase64: string) {
    const result = await scoreDrawing({
        promptText: room.promptText ?? '',
        drawingBase64: imageBase64,
        playerId: `${roomId}:${side}`,
        roomId,
        side,
    });

    // The round may already have resolved (window expired) while we waited.
    if (rooms.get(roomId) !== room || !room.scoringActive) return;
    room.scores[side] = result;
    // Early resolution: both scores are in, no need to wait out the window.
    if (room.scores.left && room.scores.right) finishRound(roomId, room);
}

/** Short human-readable note of which side(s) fell back, or null if neither. */
function describeAiError(room: RoomState): string | null {
    const parts: string[] = [];
    for (const side of ['left', 'right'] as const) {
        const result = room.scores[side];
        if (result === null) {
            parts.push(`${side}: ${room.drawingSnapshots[side] === null ? 'no_submission' : 'not_scored'}`);
        } else if (result.error !== null) {
            parts.push(`${side}: ${result.error}`);
        }
    }
    return parts.length > 0 ? parts.join(', ') : null;
}

function finishRound(roomId: string, room: RoomState) {
    if (room.phase !== 'drawing') return;
    clearRoundTimers(room);
    room.scoringActive = false;
    room.phase = 'results';
    room.roundEndsAt = null;

    // A side with no snapshot, or whose scoring call failed, scores 0.
    const leftScore = room.scores.left?.score ?? 0;
    const rightScore = room.scores.right?.score ?? 0;

    // The AI casts one vote alongside the human judges, for the higher-scoring
    // side. On an exact score tie it abstains rather than picking arbitrarily.
    if (leftScore > rightScore) room.votes.set(AI_VOTER_KEY, 'left');
    else if (rightScore > leftScore) room.votes.set(AI_VOTER_KEY, 'right');

    let leftVotes = 0;
    let rightVotes = 0;
    for (const vote of room.votes.values()) {
        if (vote === 'left') leftVotes += 1;
        else rightVotes += 1;
    }

    // Tiebreak: the AI votes like a judge, so even splits are common (one judge
    // left, AI right). On an even tally the higher raw AI score decides; equal
    // there too is a genuine tie. Covers 0-0 as well (no judges, AI abstained).
    const winner: Vote | 'tie' =
        leftVotes === rightVotes
            ? leftScore === rightScore
                ? 'tie'
                : leftScore > rightScore
                    ? 'left'
                    : 'right'
            : leftVotes > rightVotes
                ? 'left'
                : 'right';

    const displayUntil = Date.now() + RESULT_DISPLAY_MS;
    io.to(roomId).emit('round_ended', {
        winner,
        leftVotes,
        rightVotes,
        displayUntil,
        leftScore,
        rightScore,
        leftReasoning: room.scores.left?.reasoning ?? null,
        rightReasoning: room.scores.right?.reasoning ?? null,
        aiError: describeAiError(room),
    });

    setTimeout(() => {
        if (rooms.get(roomId) !== room || room.phase !== 'results') return;
        room.phase = 'lobby';
        room.votes.clear();
        room.historyLeft = [];
        room.historyRight = [];
        room.indexLeft = -1;
        room.indexRight = -1;
        room.promptText = null;
        room.drawingSnapshots = { left: null, right: null };
        room.scores = { left: null, right: null };
        io.to(roomId).emit('round_reset', { phase: room.phase });
        emitRoomState(roomId, room);
    }, RESULT_DISPLAY_MS);
}

function startRound(roomId: string, room: RoomState) {
    const roles = new Set(room.members.values());
    if (room.phase !== 'lobby' || !roles.has('left') || !roles.has('right')) return false;

    clearRoundTimers(room);
    room.phase = 'drawing';
    room.hasStarted = true;
    room.votes.clear();
    room.historyLeft = [];
    room.historyRight = [];
    room.indexLeft = -1;
    room.indexRight = -1;
    room.scoringActive = false;
    room.drawingSnapshots = { left: null, right: null };
    room.scores = { left: null, right: null };
    // Chosen here and broadcast, so both drawers see the same word and the AI
    // judge scores against one authoritative prompt.
    room.promptText = chooseRandomWord(wordList);
    room.roundEndsAt = Date.now() + ROUND_DURATION_MS;
    io.to(roomId).emit('round_started', {
        endsAt: room.roundEndsAt,
        durationMs: ROUND_DURATION_MS,
        promptText: room.promptText,
    });
    emitRoomState(roomId, room);
    room.tickTimer = setInterval(() => {
        if (room.phase !== 'drawing' || room.roundEndsAt === null) return;
        io.to(roomId).emit('round_timer', { endsAt: room.roundEndsAt, remainingMs: Math.max(0, room.roundEndsAt - Date.now()) });
    }, 1_000);
    room.endTimer = setTimeout(() => beginScoring(roomId, room), ROUND_DURATION_MS);
    return true;
}

async function removeSocketFromRoom(socket: Socket) {
    const roomId = socketRooms.get(socket.id);
    socketClientIds.delete(socket.id);
    if (!roomId) return;

    socketRooms.delete(socket.id);
    await socket.leave(roomId);
    const room = rooms.get(roomId);
    if (!room) return;

    room.members.delete(socket.id);
    if (room.members.size === 0) {
        clearRoundTimers(room);
        rooms.delete(roomId);
    }
}

async function admit(socket: Socket, roomId: string, clientId: string | null) {
    const room = rooms.get(roomId) ?? createRoom(roomId)[1];
    const existingRole = room.members.get(socket.id);
    if (existingRole) return { ok: true as const, roomId, role: existingRole, room };
    if (room.members.size >= ROOM_CAPACITY) return { ok: false as const };

    await removeSocketFromRoom(socket);
    const role = roleForRoom(room);
    room.members.set(socket.id, role); // Reserve before yielding to the adapter.
    socketRooms.set(socket.id, roomId);
    if (clientId) socketClientIds.set(socket.id, clientId);
    try {
        await socket.join(roomId);
    } catch (error) {
        room.members.delete(socket.id);
        socketRooms.delete(socket.id);
        socketClientIds.delete(socket.id);
        if (room.members.size === 0) {
            clearRoundTimers(room);
            rooms.delete(roomId);
        }
        throw error;
    }
    return { ok: true as const, roomId, role, room };
}

function emitAssignment(socket: Socket, roomId: string, role: RoomRole, room: RoomState) {
    socket.emit('room_assigned', { roomId, role, capacity: ROOM_CAPACITY, memberCount: room.members.size });
    if (role === 'judge') socket.emit('judge_assigned');
    else socket.emit('player_side_assigned', role);
    socket.emit('room_state', {
        left: { history: room.historyLeft, index: room.indexLeft },
        right: { history: room.historyRight, index: room.indexRight },
    });
    socket.emit('round_status', {
        phase: room.phase,
        endsAt: room.roundEndsAt,
        hasStarted: room.hasStarted,
        promptText: room.promptText,
    });
    socket.emit('vote_status', {
        votesCast: room.votes.size,
        eligibleVoters: [...room.members.values()].filter((memberRole) => memberRole === 'judge').length,
        ...tallyJudgeVotes(room),
    });
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`)

    socket.on('join_room', async (data: unknown) => {
        if (!allowSocketEvent(socket, 'join_room')) return;
        // Accept either the legacy bare-roomId payload or { roomId, clientId }.
        const isObjectPayload = typeof data === 'object' && data !== null;
        const rawRoomId = isObjectPayload ? (data as { roomId?: unknown }).roomId : data;
        const rawClientId = isObjectPayload ? (data as { clientId?: unknown }).clientId : undefined;
        const cleanRoomId = sanitizeRoomId(rawRoomId);
        const clientId = sanitizeClientId(rawClientId);
        if (!cleanRoomId) {
            logSecurityEvent({
                event: 'invalid_input',
                source: socket.id,
                details: { socketEvent: 'join_room', reason: 'invalid_room_id' },
            });
            socket.emit('room_join_error', { code: 'invalid_room' });
            return;
        }
        await withAdmissionLock(async () => {
            const result = await admit(socket, cleanRoomId, clientId);
            if (!result.ok) {
                socket.emit('room_join_error', { code: 'room_full', roomId: cleanRoomId });
                return;
            }
            emitAssignment(socket, result.roomId, result.role, result.room);
            if (!result.room.hasStarted) startRound(result.roomId, result.room);
        });
    });

    socket.on('find_match', async (data?: unknown) => {
        if (!allowSocketEvent(socket, 'find_match')) return;
        const clientId = sanitizeClientId(
            typeof data === 'object' && data !== null ? (data as { clientId?: unknown }).clientId : undefined
        );
        await withAdmissionLock(async () => {
            // Fullest room first, so 4/5 fills before 3/5.
            const candidate = [...rooms.entries()]
                .filter(([, room]) => room.members.size < ROOM_CAPACITY)
                .sort(([, a], [, b]) => b.members.size - a.members.size)[0];
            const roomId = candidate?.[0] ?? createRoom()[0];
            const result = await admit(socket, roomId, clientId);
            if (result.ok) {
                emitAssignment(socket, result.roomId, result.role, result.room);
                if (!result.room.hasStarted) startRound(result.roomId, result.room);
            }
        });
    });

    socket.on('start_round', async (data: { room: string }) => {
        if (!allowSocketEvent(socket, 'start_round')) return;
        const cleanRoomId = sanitizeRoomId(data?.room);
        if (!cleanRoomId) return;
        await withAdmissionLock(() => {
            const room = rooms.get(cleanRoomId);
            const role = room?.members.get(socket.id);
            if (!room || (role !== 'left' && role !== 'right')) return;
            startRound(cleanRoomId, room);
        });
    });

    socket.on('cast_vote', (data: { room: string; vote: Vote }) => {
        if (!allowSocketEvent(socket, 'cast_vote')) return;
        const cleanRoomId = sanitizeRoomId(data?.room);
        if (!cleanRoomId) return;
        const room = rooms.get(cleanRoomId);
        if (!room || room.phase !== 'drawing' || room.roundEndsAt === null || Date.now() >= room.roundEndsAt) return;
        if (room.members.get(socket.id) !== 'judge') return;
        if (data.vote !== 'left' && data.vote !== 'right') return;

        // Key by clientId (falling back to socket.id for clients that never
        // sent one) so reloading and rejoining doesn't buy a second vote.
        const voterKey = socketClientIds.get(socket.id) ?? socket.id;
        room.votes.set(voterKey, data.vote); // One current vote per judge; subsequent votes replace it.
        const votesCast = room.votes.size;
        io.to(cleanRoomId).emit('vote_status', {
            votesCast,
            eligibleVoters: [...room.members.values()].filter((role) => role === 'judge').length,
            ...tallyJudgeVotes(room),
        });
    });

    socket.on('draw', (data: { room: string; drawStroke: Stroke; side: 'left' | 'right' }) => {
        if (!allowSocketEvent(socket, 'draw')) return;
        const cleanRoomId = sanitizeRoomId(data?.room);
        if (!cleanRoomId) return;
        if (data?.side !== 'left' && data?.side !== 'right') return;
        const stroke = sanitizeStroke(data?.drawStroke);
        if (!stroke) {
            logSecurityEvent({
                event: 'invalid_input',
                source: socket.id,
                details: { socketEvent: 'draw', reason: 'invalid_stroke' },
            });
            return;
        }

        const roomState = rooms.get(cleanRoomId);
        if (!roomState) return;
        if (roomState.phase !== 'drawing' || roomState.roundEndsAt === null || Date.now() >= roomState.roundEndsAt) return;
        const role = roomState.members.get(socket.id);
        if (role !== data.side) return;

        if (data.side === 'left') {
            roomState.historyLeft = roomState.historyLeft.slice(0, roomState.indexLeft + 1);
            roomState.historyLeft.push(stroke);
            roomState.indexLeft = roomState.historyLeft.length - 1;
        } else {
            roomState.historyRight = roomState.historyRight.slice(0, roomState.indexRight + 1);
            roomState.historyRight.push(stroke);
            roomState.indexRight = roomState.historyRight.length - 1;
        }

        socket.to(cleanRoomId).emit('opponent_draw', {
            side: data.side,
            stroke,
        });

        io.to(cleanRoomId).emit('room_state', {
            left: { history: roomState.historyLeft, index: roomState.indexLeft },
            right: { history: roomState.historyRight, index: roomState.indexRight },
        });
    });

    socket.on('submit_drawing', (data: { room: string; side: 'left' | 'right'; imageBase64: string }) => {
        if (!allowSocketEvent(socket, 'submit_drawing')) return;
        const cleanRoomId = sanitizeRoomId(data?.room);
        if (!cleanRoomId) return;
        if (data?.side !== 'left' && data?.side !== 'right') return;

        const room = rooms.get(cleanRoomId);
        if (!room || !room.scoringActive) return;
        // A drawer may only submit for their own side.
        if (room.members.get(socket.id) !== data.side) return;
        // First submission per side wins; later ones can't force extra AI calls.
        if (room.drawingSnapshots[data.side] !== null) return;

        const imageBase64 = typeof data.imageBase64 === 'string' ? data.imageBase64 : '';
        const validation = validateImage(imageBase64);
        if (!validation.ok) {
            // Treated exactly like a missing submission: that side scores 0.
            logSecurityEvent({
                event: 'invalid_input',
                source: socket.id,
                details: { socketEvent: 'submit_drawing', reason: validation.reason, side: data.side },
            });
            return;
        }

        room.drawingSnapshots[data.side] = imageBase64;
        void scoreSide(cleanRoomId, room, data.side, imageBase64);
    });

    socket.on('redo', (data: { room: string }) => {
        if (!allowSocketEvent(socket, 'redo')) return;
        const cleanRoomId = sanitizeRoomId(data?.room);
        if (!cleanRoomId) return;
        const roomState = rooms.get(cleanRoomId);
        if (!roomState) return;
        if (roomState.phase !== 'drawing') return;

        const side = roomState.members.get(socket.id);
        if (side !== 'left' && side !== 'right') return;

        if (side === 'left') {
            if (roomState.indexLeft + 1 < roomState.historyLeft.length) roomState.indexLeft += 1;
        } else {
            if (roomState.indexRight + 1 < roomState.historyRight.length) roomState.indexRight += 1;
        }

        socket.to(cleanRoomId).emit('redo', { room: cleanRoomId });

        io.to(cleanRoomId).emit('room_state', {
            left: { history: roomState.historyLeft, index: roomState.indexLeft },
            right: { history: roomState.historyRight, index: roomState.indexRight },
        });
    });

    socket.on('undo', (data: { room: string }) => {
        if (!allowSocketEvent(socket, 'undo')) return;
        const cleanRoomId = sanitizeRoomId(data?.room);
        if (!cleanRoomId) return;
        const roomState = rooms.get(cleanRoomId);
        if (!roomState) return;
        if (roomState.phase !== 'drawing') return;

        const side = roomState.members.get(socket.id);
        if (side !== 'left' && side !== 'right') return;

        if (side === 'left') {
            if (roomState.indexLeft >= 0) roomState.indexLeft -= 1;
        } else {
            if (roomState.indexRight >= 0) roomState.indexRight -= 1;
        }

        socket.to(cleanRoomId).emit('undo', { room: cleanRoomId });

        io.to(cleanRoomId).emit('room_state', {
            left: { history: roomState.historyLeft, index: roomState.indexLeft },
            right: { history: roomState.historyRight, index: roomState.indexRight },
        });
    });

    socket.on('disconnect', () => {
        console.log(`User ${socket.id} disconnected.`)
        socketLimiter.clear(socket.id);
        void withAdmissionLock(() => removeSocketFromRoom(socket));
    });
});


const router = express.Router();
const INACTIVE_MS = 2 * 60_000;

async function getStats() {
    const statRes = await db.execute(
        `SELECT visits, total_playtime_seconds FROM stats WHERE id = ?`,
        [1]
    );
    const statRow = statRes.rows?.[0] ?? { visits: 0, total_playtime_seconds: 0 };

    const now = Date.now();
    const activeThreshold = now - INACTIVE_MS;
    const activeRes = await db.execute(
        `SELECT COUNT(*) AS count FROM sessions WHERE last_seen_at >= ?`,
        [activeThreshold]
    );
    const activeCount = Number(activeRes.rows?.[0]?.count ?? 0);

    return {
        visits: Number(statRow.visits ?? 0),
        totalPlaytimeSeconds: Number(statRow.total_playtime_seconds ?? 0),
        activeUsers: activeCount,
    };
}

async function pruneInactive() {
    const now = Date.now();
    const cutoff = now - INACTIVE_MS;

    const toPruneRes = await db.execute(
        `SELECT session_id, last_seen_at FROM sessions WHERE last_seen_at < ?`,
        [cutoff]
    );
    const rows = toPruneRes.rows ?? [];
    if (rows.length === 0) return;

    let totalAdd = 0;
    for (const r of rows) {
        const lastSeen = Number(r.last_seen_at ?? 0);
        const deltaSec = Math.max(0, Math.floor((now - lastSeen) / 1000));
        totalAdd += deltaSec;
    }

    const batch: { sql: string; args?: any[] }[] = [];

    if (totalAdd > 0) {
        batch.push({
            sql: `UPDATE stats SET total_playtime_seconds = total_playtime_seconds + ? WHERE id = ?`,
            args: [totalAdd, 1],
        });
    }

    batch.push({
        sql: `DELETE FROM sessions WHERE last_seen_at < ?`,
        args: [cutoff],
    });

    await db.batch(batch); // atomic, no manual rollback needed
}

router.post("/api/stats/visit", async (req, res) => {
    const sessionId = sanitizeSessionId(req.body?.sessionId ?? req.query?.sessionId);
    if (!sessionId) {
        logSecurityEvent({
            event: 'invalid_input',
            source: req.ip,
            details: { path: '/api/stats/visit', reason: 'invalid_session_id' },
        });
        return res.status(400).json({ ok: false, error: "missing or invalid sessionId" });
    }

    await pruneInactive();

    const existingRes = await db.execute(
        `SELECT 1 FROM sessions WHERE session_id = ?`,
        [sessionId]
    );
    if (existingRes.rows && existingRes.rows.length > 0) {
        return res.json({ ...(await getStats()), ok: true, recorded: false });
    }

    const now = Date.now();
    try {
        await db.batch([
            {
                sql: `INSERT INTO sessions (session_id, started_at, last_seen_at) VALUES (?, ?, ?)`,
                args: [sessionId, now, now],
            },
            {
                sql: `UPDATE stats SET visits = visits + 1 WHERE id = ?`,
                args: [1],
            },
        ]);
    } catch {
        return res.status(500).json({ ok: false, error: "db error" });
    }

    return res.json({ ...(await getStats()), ok: true, recorded: true });
});

router.post("/api/stats/heartbeat", async (req, res) => {
    const sessionId = sanitizeSessionId(req.body?.sessionId ?? req.query?.sessionId);
    if (!sessionId) {
        logSecurityEvent({
            event: 'invalid_input',
            source: req.ip,
            details: { path: '/api/stats/heartbeat', reason: 'invalid_session_id' },
        });
        return res.status(400).json(await getStats());
    }

    const now = Date.now();
    const rowRes = await db.execute(
        `SELECT started_at, last_seen_at FROM sessions WHERE session_id = ?`,
        [sessionId]
    );
    const row = rowRes.rows?.[0];

    if (!row) {
        await db.execute(
            `INSERT INTO sessions (session_id, started_at, last_seen_at) VALUES (?, ?, ?)`,
            [sessionId, now, now]
        );
        await pruneInactive();
        return res.json(await getStats());
    }

    const lastSeen = Number(row.last_seen_at ?? 0);
    const deltaSeconds = Math.max(0, Math.floor((now - lastSeen) / 1000));

    if (deltaSeconds > 0) {
        try {
            await db.batch([
                {
                    sql: `UPDATE sessions SET last_seen_at = ? WHERE session_id = ?`,
                    args: [now, sessionId],
                },
                {
                    sql: `UPDATE stats SET total_playtime_seconds = total_playtime_seconds + ? WHERE id = ?`,
                    args: [deltaSeconds, 1],
                },
            ]);
        } catch {
            return res.status(500).json({ ok: false, error: "db error" });
        }
    } else {
        await db.execute(
            `UPDATE sessions SET last_seen_at = ? WHERE session_id = ?`,
            [now, sessionId]
        );
    }

    await pruneInactive();
    return res.json(await getStats());
});

router.post("/api/stats/session/end", async (req, res) => {
    const sessionId = sanitizeSessionId(req.body?.sessionId ?? req.query?.sessionId);
    if (!sessionId) {
        logSecurityEvent({
            event: 'invalid_input',
            source: req.ip,
            details: { path: '/api/stats/session/end', reason: 'invalid_session_id' },
        });
        return res.status(400).json(await getStats());
    }

    const now = Date.now();
    const rowRes = await db.execute(
        `SELECT last_seen_at FROM sessions WHERE session_id = ?`,
        [sessionId]
    );
    const row = rowRes.rows?.[0];

    if (!row) {
        await pruneInactive();
        return res.json(await getStats());
    }

    const lastSeen = Number(row.last_seen_at ?? 0);
    const deltaSeconds = Math.max(0, Math.floor((now - lastSeen) / 1000));

    try {
        const batch: { sql: string; args: any[] }[] = [];
        if (deltaSeconds > 0) {
            batch.push({
                sql: `UPDATE stats SET total_playtime_seconds = total_playtime_seconds + ? WHERE id = ?`,
                args: [deltaSeconds, 1],
            });
        }
        batch.push({
            sql: `DELETE FROM sessions WHERE session_id = ?`,
            args: [sessionId],
        });
        await db.batch(batch);
    } catch {
        return res.status(500).json({ ok: false, error: "db error" });
    }

    await pruneInactive();
    return res.json(await getStats());
});

router.get("/api/stats", async (req, res) => {
    await pruneInactive();
    return res.json(await getStats());
});

app.use(router);

// ---------------------------------------------------------------------------
// Static frontend (single-origin deployment)
//
// In production this process also serves Vite's build output, so the app, the
// stats API and Socket.IO all share one origin. Mounted after the API router
// and before the catch-all 404 so unknown /api routes keep returning JSON.
// The path is derived from this module's own location rather than
// process.cwd(), which is not guaranteed at deploy time.
// ---------------------------------------------------------------------------
const moduleDir = dirname(fileURLToPath(import.meta.url));
// `rootDir` is ".." (server code imports shared modules from ../src), so the
// compiled entry is <repo>/server/dist/server/index.js - three levels below the
// repo root, where Vite writes <repo>/dist. Running the TypeScript directly in
// dev puts this module at <repo>/server, so the same relative walk lands
// outside the repo and the existsSync guard below leaves static serving off -
// which is what we want, since Vite serves the frontend itself in dev.
const clientDir = resolve(moduleDir, '../../../dist');
const clientIndexHtml = join(clientDir, 'index.html');
const staticFrontendEnabled = existsSync(clientIndexHtml);

if (staticFrontendEnabled) {
    app.use(express.static(clientDir));
    // SPA fallback: client-side routes (/game/:roomId, ...) must return the
    // shell. GET-only and never /api/*, so unknown API routes and non-GET
    // requests still fall through to the JSON 404 below. /socket.io/* never
    // reaches Express - Socket.IO intercepts it on the shared HTTP server.
    app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
        res.sendFile(clientIndexHtml);
    });
}

// Unknown routes: log and return a generic 404 (no route enumeration hints).
app.use((req, res) => {
    logSecurityEvent({
        event: 'not_found',
        severity: 'info',
        source: req.ip,
        details: { method: req.method, path: req.originalUrl },
    });
    res.status(404).json({ ok: false, error: 'not found' });
});

// Central error handler: log the real error server-side, return a generic
// message to the client so stack traces / internals are never leaked.
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logSecurityEvent({
        event: 'unhandled_error',
        severity: 'alert',
        source: req.ip,
        details: { path: req.originalUrl, message: err instanceof Error ? err.message : String(err) },
    });
    res.status(500).json({ ok: false, error: 'internal server error' });
});

(async () => {
    try {
        await initDb();
        server.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            // First thing to check if a deploy serves a blank page.
            console.log(
                staticFrontendEnabled
                    ? `Serving static frontend from ${clientDir}`
                    : `Static frontend disabled (no index.html at ${clientIndexHtml}); API and websockets only`
            );
        });
    } catch (err) {
        console.error("Failed to initialize DB:", err);
        process.exit(1);
    }
})();