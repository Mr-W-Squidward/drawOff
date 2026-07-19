import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import cors from 'cors';
import type { Stroke } from '../src/types/canvas.types.ts';
import { db, initDb } from './db.ts';

const PORT = Number(process.env.PORT ?? 5174);
const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: 'http://localhost:5173',
        methods: ["GET", "POST"]
    }
});

interface RoomState {
    players: Map<string, 'left' | 'right'>;
    historyLeft: Stroke[];
    historyRight: Stroke[];
    indexLeft: number;
    indexRight: number;
}

const rooms = new Map<string, RoomState>();

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`)

    socket.on('join_room', (roomString: string) => {
        socket.join(roomString);
        console.log(`User ${socket.id} joined: ROOM ${roomString}`)

        if (!rooms.has(roomString)) {
            rooms.set(roomString, {
                players: new Map(),
                historyLeft: [],
                historyRight: [],
                indexLeft: -1,
                indexRight: -1
            });
        }

        const roomState = rooms.get(roomString)!;

        const roomSockets = io.sockets.adapter.rooms.get(roomString) || new Set<string>();

        for (const playerId of Array.from(roomState.players.keys())) {
            if (!roomSockets.has(playerId)) {
                roomState.players.delete(playerId);
                console.log(`Removed player ${playerId} from ${roomString}`)
            }
        }

        if (!roomState.players.has(socket.id)) {
            if (roomState.players.size === 0) {
                roomState.players.set(socket.id, 'left');
                socket.emit('player_side_assigned', 'left');
                console.log(`ASSIGNED LEFT to ${socket.id}`);
            } else if (roomState.players.size === 1) {
                roomState.players.set(socket.id, 'right');
                socket.emit('player_side_assigned', 'right')
                console.log(`ASSIGNED RIGHT to ${socket.id}`);
            } else {
                console.log(`ROOM FULL: Acting as judge. (Implementing later...)`);
                socket.emit('judge_assigned');
            }
        } else {
            const side = roomState.players.get(socket.id)!;
            socket.emit('player_side_assigned', side);
            console.log(`RE-SENT side: ${side} to ${socket.id}`);
        };

        socket.emit('room_state', {
            left: { history: roomState.historyLeft, index: roomState.indexLeft },
            right: { history: roomState.historyRight, index: roomState.indexRight },
        })
    });

    socket.on('draw', (data: { room: string; drawStroke: Stroke; side: 'left' | 'right' }) => {
        const roomState = rooms.get(data.room);
        if (!roomState) return;

        if (data.side === 'left') {
            roomState.historyLeft = roomState.historyLeft.slice(0, roomState.indexLeft + 1);
            roomState.historyLeft.push(data.drawStroke);
            roomState.indexLeft = roomState.historyLeft.length - 1;
        } else {
            roomState.historyRight = roomState.historyRight.slice(0, roomState.indexRight + 1);
            roomState.historyRight.push(data.drawStroke);
            roomState.indexRight = roomState.historyRight.length - 1;
        }

        socket.to(data.room).emit('opponent_draw', {
            side: data.side,
            stroke: data.drawStroke,
        });

        io.to(data.room).emit('room_state', {
            left: { history: roomState.historyLeft, index: roomState.indexLeft },
            right: { history: roomState.historyRight, index: roomState.indexRight },
        });
    });

    socket.on('redo', (data: { room: string }) => {
        const roomState = rooms.get(data.room);
        if (!roomState) return;

        const side = roomState.players.get(socket.id);
        if (!side) return;

        if (side === 'left') {
            if (roomState.indexLeft + 1 < roomState.historyLeft.length) roomState.indexLeft += 1;
        } else {
            if (roomState.indexRight + 1 < roomState.historyRight.length) roomState.indexRight += 1;
        }

        socket.to(data.room).emit('redo', data);

        io.to(data.room).emit('room_state', {
            left: { history: roomState.historyLeft, index: roomState.indexLeft },
            right: { history: roomState.historyRight, index: roomState.indexRight },
        });
    });

    socket.on('undo', (data: { room: string }) => {
        const roomState = rooms.get(data.room);
        if (!roomState) return;

        const side = roomState.players.get(socket.id);
        if (!side) return;

        if (side === 'left') {
            if (roomState.indexLeft >= 0) roomState.indexLeft -= 1;
        } else {
            if (roomState.indexRight >= 0) roomState.indexRight -= 1;
        }

        socket.to(data.room).emit('undo', data);

        io.to(data.room).emit('room_state', {
            left: { history: roomState.historyLeft, index: roomState.indexLeft },
            right: { history: roomState.historyRight, index: roomState.indexRight },
        });
    });

    socket.on('disconnect', () => {
        console.log(`User ${socket.id} disconnected.`)

        rooms.forEach((roomState, roomId) => {
            if (roomState.players.has(socket.id)) {
                roomState.players.delete(socket.id);

                if (roomState.players.size === 0) {
                    rooms.delete(roomId);
                    console.log(`--- Room ${roomId} closed (empty)`)
                }
            }
        });
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

    await db.execute("BEGIN");
    try {
        if (totalAdd > 0) {
            await db.execute(
                `UPDATE stats SET total_playtime_seconds = total_playtime_seconds + ? WHERE id = ?`,
                [totalAdd, 1]
            );
        }
        await db.execute(`DELETE FROM sessions WHERE last_seen_at < ?`, [cutoff]);
        await db.execute("COMMIT");
    } catch (err) {
        await db.execute("ROLLBACK");
        throw err;
    }
}

router.post("/api/stats/visit", async (req, res) => {
    const sessionId = req.body?.sessionId ?? req.query?.sessionId;
    if (!sessionId) return res.status(400).json({ ok: false, error: "missing sessionId" });

    await pruneInactive();

    const existingRes = await db.execute(
        `SELECT 1 FROM sessions WHERE session_id = ?`,
        [sessionId]
    );
    if (existingRes.rows && existingRes.rows.length > 0) {
        return res.json({ ...(await getStats()), ok: true, recorded: false });
    }

    const now = Date.now();
    await db.execute("BEGIN");
    try {
        await db.execute(
            `INSERT INTO sessions (session_id, started_at, last_seen_at) VALUES (?, ?, ?)`,
            [sessionId, now, now]
        );
        await db.execute(
            `UPDATE stats SET visits = visits + 1 WHERE id = ?`,
            [1]
        );
        await db.execute("COMMIT");
    } catch {
        await db.execute("ROLLBACK");
        return res.status(500).json({ ok: false, error: "db error" });
    }

    return res.json({ ...(await getStats()), ok: true, recorded: true });
});

router.post("/api/stats/heartbeat", async (req, res) => {
    const sessionId = req.body?.sessionId ?? req.query?.sessionId;
    if (!sessionId) return res.status(400).json(await getStats());

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
        await db.execute("BEGIN");
        try {
            await db.execute(
                `UPDATE sessions SET last_seen_at = ? WHERE session_id = ?`,
                [now, sessionId]
            );
            await db.execute(
                `UPDATE stats SET total_playtime_seconds = total_playtime_seconds + ? WHERE id = ?`,
                [deltaSeconds, 1]
            );
            await db.execute("COMMIT");
        } catch {
            await db.execute("ROLLBACK");
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
    const sessionId = req.body?.sessionId ?? req.query?.sessionId;
    if (!sessionId) return res.status(400).json(await getStats());

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

    await db.execute("BEGIN");
    try {
        if (deltaSeconds > 0) {
            await db.execute(
                `UPDATE stats SET total_playtime_seconds = total_playtime_seconds + ? WHERE id = ?`,
                [deltaSeconds, 1]
            );
        }
        await db.execute(`DELETE FROM sessions WHERE session_id = ?`, [sessionId]);
        await db.execute("COMMIT");
    } catch {
        await db.execute("ROLLBACK");
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

(async () => {
    try {
        await initDb();
        server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    } catch (err) {
        console.error("Failed to initialize DB:", err);
        process.exit(1);
    }
})();
