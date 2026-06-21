import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import cors from 'cors';
import type { Stroke } from '../src/types/canvas.types.ts';

const PORT = 5174;
const app = express();
app.use(cors());

const server = createServer(app);
const io = new Server(server, {
    cors: { 
        origin: 'http://localhost:5173', // React local port
        methods: ["GET", "POST"]
    }
});

// Rooms: What players are LEFT canvas and RIGHT canvas
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

    // Join lobbies
    socket.on('join_room', (roomString: string) => {
        socket.join(roomString);
        console.log(`User ${socket.id} joined: ROOM ${roomString}`)

        // Create new room if not made
        if (!rooms.has(roomString)) {
            rooms.set(roomString, { 
                players: new Map(),
                historyLeft: [],
                historyRight: [],
                indexLeft: -1,
                indexRight: -1
            });
        }

        const roomState = rooms.get(roomString);

        // REMOVE Old socketIDs (leaving)
        const roomSockets = io.sockets.adapter.rooms.get(roomString) || new Set<string>();
        
        for (const playerId of Array.from(roomState.players.keys())) {
            if (!roomSockets.has(playerId)) {
                roomState.players.delete(playerId);
                console.log(`Removed player ${playerId} from ${roomString}`)
            }
        }
    
        if (!roomState?.players.has(socket.id)) {
            if (roomState?.players.size === 0) {
                roomState.players.set(socket.id, 'left');
                socket.emit('player_side_assigned', 'left');
                console.log(`ASSIGNED LEFT to ${socket.id}`);
            } else if (roomState?.players.size === 1) {
                roomState.players.set(socket.id, 'right');
                socket.emit('player_side_assigned', 'right')
                console.log(`ASSIGNED RIGHT to ${socket.id}`);
            } else {
                console.log(`ROOM FULL: Acting as judge. (Implementing later...)`);
                socket.emit('judge_assigned');
            }
        } else {
            // QUICK reconnect event 
            const side = roomState.players.get(socket.id)!;
            socket.emit('player_side_assigned', side);
            console.log(`RE-SENT side: ${side} to ${socket.id}`);
        };

        // send room state so clients sync (w/ reload)
        socket.emit('room_state', {
            left: { history: roomState?.historyLeft, index: roomState?.indexLeft },
            right: { history: roomState?.historyRight, index: roomState?.indexRight },
        })
    });

    // Listen for drawing
    socket.on('draw', (data: { room: string; drawStroke: Stroke; side: 'left' | 'right' }) => {
        const roomState = rooms.get(data.room);
        if (!roomState) return;

        if (data.side === 'left') {
            roomState.historyLeft = roomState.historyLeft.slice(0, roomState.indexLeft+1);
            roomState.historyLeft.push(data.drawStroke);
            roomState.indexLeft = roomState.historyLeft.length - 1;
        } else {
            roomState.historyRight = roomState.historyRight.slice(0, roomState.indexRight+1);
            roomState.historyRight.push(data.drawStroke);
            roomState.indexRight = roomState.historyRight.length - 1;
        }
        
        // Forward stroke to the other player in the room
        socket.to(data.room).emit('opponent_draw', {
            side: data.side,
            stroke: data.drawStroke,
        });

        io.to(data.room).emit('room_state', {
            left: { history: roomState.historyLeft, index: roomState.indexLeft },
            right: { history: roomState.historyRight, index: roomState.indexRight },
        });
    });

    // Listen for redo
    socket.on('redo', (data: {room: string }) => {
        const roomState = rooms.get(data.room);
        if (!roomState) return;

        const side = roomState.players.get(socket.id);
        if (!side) return;

        if (side === 'left') {
            if (roomState.indexLeft + 1 < roomState.historyLeft.length) roomState.indexLeft+=1;
        } else {
            if (roomState.indexRight + 1 < roomState.historyRight.length) roomState.indexRight+=1;
        }
        
        socket.to(data.room).emit('redo', data);

        io.to(data.room).emit('room_state', {
            left: { history: roomState.historyLeft, index: roomState.indexLeft },
            right: { history: roomState.historyRight, index: roomState.indexRight },
        });
    });

    // Listen for undo
    socket.on('undo', (data: {room: string }) => {
        const roomState = rooms.get(data.room);
        if (!roomState) return;

        const side = roomState.players.get(socket.id);
        if (!side) return;

        if (side === 'left') {
            if (roomState.indexLeft >= 0) roomState.indexLeft-=1;
        } else {
            if (roomState.indexRight >= 0) roomState.indexRight-=1;
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

                // remove if empty
                if (roomState.players.size === 0) {
                    rooms.delete(roomId);
                    console.log(`--- Room ${roomId} closed (empty)`)
                }
            }
        });
    });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`))