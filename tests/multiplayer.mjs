import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { once } from 'node:events';

const port = 15174;
const server = spawn(process.execPath, ['--loader', 'ts-node/esm', 'index.ts'], {
  cwd: new URL('../server/', import.meta.url),
  env: { ...process.env, PORT: String(port), NODE_ENV: 'test', TURSO_DATABASE_URL: 'file::memory:', TURSO_AUTH_TOKEN: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
server.stderr.on('data', chunk => { logs += chunk; });
const clients = [];
function event(socket, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, handler); reject(new Error(`Timeout: ${name}\n${logs}`)); }, 6000);
    function handler(data) { clearTimeout(timer); resolve(data); }
    socket.once(name, handler);
  });
}
async function join(token) {
  const socket = io(`http://localhost:${port}`, { auth: { sessionId: token }, autoConnect: false, reconnection: false });
  clients.push(socket);
  const connected = event(socket, 'connect'); socket.connect(); await connected;
  const assigned = event(socket, 'room_assigned');
  const status = event(socket, 'round_status');
  const state = event(socket, 'room_state');
  socket.emit('join_room', 'game_test');
  return { socket, assignment: await assigned, status: await status, state: await state };
}
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(logs || 'Server startup timed out')), 10000);
    server.stdout.on('data', chunk => { if (String(chunk).includes('Server running')) { clearTimeout(timer); resolve(); } });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${logs}`)); });
  });
  const left = await join('left-token');
  const started = event(left.socket, 'round_started');
  const right = await join('right-token');
  const round = await started;
  const judge = await join('judge-token');
  assert.equal(left.assignment.role, 'left'); assert.equal(right.assignment.role, 'right'); assert.equal(judge.assignment.role, 'judge');
  assert.equal(judge.status.prompt, round.prompt); assert.equal(judge.status.endsAt, round.endsAt);
  const stroke = { type: 'brush', colour: '#000000', width: 6, points: [{ x: 500, y: 375 }] };
  judge.socket.emit('draw', { room: 'game_test', side: 'left', drawStroke: stroke });
  const state = event(judge.socket, 'room_state');
  left.socket.emit('draw', { room: 'game_test', side: 'left', drawStroke: stroke });
  assert.equal((await state).left.history.length, 1);
  const undone = event(judge.socket, 'room_state');
  left.socket.emit('undo', { room: 'game_test' });
  assert.equal((await undone).left.index, -1);
  const redone = event(judge.socket, 'room_state');
  left.socket.emit('redo', { room: 'game_test' });
  assert.equal((await redone).left.index, 0);
  left.socket.disconnect();
  const restored = await join('left-token');
  assert.equal(restored.assignment.role, 'left'); assert.deepEqual(restored.state.left.history, [stroke]);
  assert.equal(restored.status.prompt, round.prompt);
  judge.socket.emit('cast_vote', { room: 'game_test', vote: 'right' }); // Too early.
  const voting = await event(judge.socket, 'round_status'); assert.equal(voting.phase, 'voting');
  restored.socket.emit('draw', { room: 'game_test', side: 'left', drawStroke: stroke }); // Too late.
  const voteStatus = event(judge.socket, 'vote_status');
  judge.socket.emit('cast_vote', { room: 'game_test', vote: 'left' });
  assert.equal((await voteStatus).votesCast, 1);
  judge.socket.disconnect();
  const restoredJudge = await join('judge-token');
  assert.equal(restoredJudge.status.vote, 'left'); assert.equal(restoredJudge.state.left.history.length, 1);
  const result = await event(restoredJudge.socket, 'round_ended');
  assert.equal(result.winner, 'left'); assert.equal(result.leftVotes, 1); assert.equal(result.rightVotes, 0);
  restored.socket.disconnect();
  const resultReconnect = await join('left-token');
  assert.equal(resultReconnect.status.result.winner, 'left');
  await event(restoredJudge.socket, 'round_reset');
  const next = event(restoredJudge.socket, 'round_started');
  resultReconnect.socket.emit('start_round', { room: 'game_test' });
  assert.ok((await next).prompt);
  console.log('PASS: shared prompt/deadline, role enforcement, drawing, reconnect snapshots, voting, results, replay');
} finally {
  clients.forEach(socket => socket.disconnect());
  if (server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
}
