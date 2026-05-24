import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const app = express()
const server = createServer(app)
const io = new Server(server, {
    cors: { origin: 'http://localhost:1001'}
})

io.on('connection', (socket) => {
    console.log("Connected!!")
})

server.listen(1001, () => console.log('Sever running on port 3001'))