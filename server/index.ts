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
            rooms.set(roomString, { players: new Map() });
        }

        const roomState = rooms.get(roomString);

        if (roomState?.players.size === 0) {
            roomState.players.set(socket.id, 'left');
            socket.emit('player_side_assigned', 'left');
        } else if (roomState?.players.size === 1) {
            roomState.players.set(socket.id, 'right');
            socket.emit('player_side_assigned', 'right')
        } else {
            console.log(`ROOM FULL: Acting as judge. (Implementing later...)`);
            socket.emit('judge_assigned');

            // implemenet more later
        }
    });

    // Listen for drawing
    socket.on('draw', (data: { room: string; drawStroke: Stroke }) => {
        // Forward stroke to the other player in the room
        socket.to(data.room).emit('opponent_draw', data.drawStroke)
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