import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import type { Stroke, Tool } from '../types/canvas.types';
import { canvasPoint, redrawCanvas } from '../utils/canvasUtils';

type Side = 'left' | 'right';
type Phase = 'lobby' | 'drawing' | 'voting' | 'results';
type Result = { winner: Side | 'tie'; leftVotes: number; rightVotes: number };
type Status = { phase: Phase; endsAt: number | null; prompt: string | null; result: Result | null; vote?: Side | null };
type History = { history: Stroke[]; index: number };
const empty = (): History => ({ history: [], index: -1 });

export default function Game() {
  const { roomId: routeRoom } = useParams();
  const [room, setRoom] = useState(routeRoom ?? '');
  const roomRef = useRef(routeRoom ?? sessionStorage.getItem('drawoff-room') ?? '');
  const [role, setRole] = useState<Side | 'judge' | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<Status>({ phase: 'lobby', endsAt: null, prompt: null, result: null });
  const [seconds, setSeconds] = useState(0);
  const [vote, setVote] = useState<Side | null>(null);
  const [votes, setVotes] = useState(0);
  const [colour, setColour] = useState('#172033');
  const [width, setWidth] = useState(6);
  const [tool, setTool] = useState<Tool>('brush');
  const socket = useRef<Socket | null>(null);
  const canvases = useRef<Record<Side, HTMLCanvasElement | null>>({ left: null, right: null });
  const histories = useRef<Record<Side, History>>({ left: empty(), right: empty() });
  const active = useRef<{ side: Side; pointer: number; stroke: Stroke } | null>(null);
  const canDraw = connected && status.phase === 'drawing' && (role === 'left' || role === 'right');

  function paint(side: Side) {
    const canvas = canvases.current[side];
    const h = histories.current[side];
    if (canvas) {
      const strokes = h.history.slice(0, h.index + 1);
      if (active.current?.side === side) strokes.push(active.current.stroke);
      redrawCanvas(canvas, strokes, strokes.length - 1);
    }
  }

  useEffect(() => {
    let sessionId = sessionStorage.getItem('drawoff-session');
    if (!sessionId) {
      sessionId = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem('drawoff-session', sessionId);
    }
    const client = io({ auth: { sessionId } });
    socket.current = client;
    client.on('connect', () => {
      setError('');
      if (roomRef.current) client.emit('join_room', roomRef.current);
      else client.emit('find_match');
    });
    client.on('room_assigned', (data: { roomId: string; role: Side | 'judge' }) => {
      roomRef.current = data.roomId;
      sessionStorage.setItem('drawoff-room', data.roomId);
      setRoom(data.roomId);
      setRole(data.role);
      setConnected(true);
    });
    client.on('room_join_error', (data: { code: string }) => {
      setConnected(false);
      setError(data.code === 'room_full' ? 'This room is full. Try another room.' : data.code === 'session_in_use' ? 'This seat is open in another tab. Open a fresh tab from the home page to join as another player.' : 'That room code is invalid.');
    });
    client.on('round_status', (data: Status) => {
      active.current = null;
      setStatus(data);
      setVote(data.vote ?? null);
      paint('left'); paint('right');
    });
    client.on('round_started', (data: { endsAt: number; prompt: string }) => {
      active.current = null;
      setStatus({ phase: 'drawing', endsAt: data.endsAt, prompt: data.prompt, result: null });
      setVote(null); setVotes(0);
    });
    client.on('round_ended', (data: Result & { displayUntil: number }) => {
      active.current = null;
      setStatus(old => ({ ...old, phase: 'results', endsAt: data.displayUntil, result: data }));
    });
    client.on('round_reset', () => {
      active.current = null;
      setStatus({ phase: 'lobby', endsAt: null, prompt: null, result: null });
      setVote(null); setVotes(0);
    });
    client.on('vote_status', (data: { votesCast: number }) => setVotes(data.votesCast));
    client.on('room_state', (data: Record<Side, History>) => {
      histories.current = data;
      paint('left'); paint('right');
    });
    const offline = () => {
      active.current = null;
      setConnected(false);
      paint('left'); paint('right');
    };
    client.on('disconnect', offline);
    client.on('connect_error', offline);
    return () => { client.disconnect(); };
  }, []);

  useEffect(() => {
    const tick = () => setSeconds(status.endsAt ? Math.max(0, Math.ceil((status.endsAt - Date.now()) / 1000)) : 0);
    tick();
    const timer = window.setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [status.endsAt]);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      for (const side of ['left', 'right'] as const) {
        const canvas = canvases.current[side];
        if (!canvas) continue;
        const rect = canvas.getBoundingClientRect();
        canvas.width = Math.round(rect.width * window.devicePixelRatio);
        canvas.height = Math.round(rect.height * window.devicePixelRatio);
        paint(side);
      }
    });
    for (const canvas of Object.values(canvases.current)) if (canvas) observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  function finish(cancel = false) {
    const drawing = active.current;
    active.current = null;
    if (!drawing) return;
    if (!cancel && canDraw && socket.current?.connected && seconds > 0) {
      socket.current.emit('draw', { room: roomRef.current, side: drawing.side, drawStroke: drawing.stroke });
    }
    paint(drawing.side);
  }

  return <main className="game-shell">
    <header className="game-header">
      <div><Link to="/">← drawOff</Link><p className="room-code">Room: {room.replace(/^game_/, '') || 'Finding a room…'}</p></div>
      <div className="game-prompt"><span>{status.phase}</span><h1>{status.prompt ?? 'Ready for a drawOff?'}</h1></div>
      <div className="game-clock">{status.endsAt ? `${seconds}s` : 'Lobby'}<small>{role ? `You: ${role}` : 'Joining…'}</small></div>
    </header>
    <div className="game-notice" role="status">
      {error || (!connected ? 'Connecting… Your seat is held for 60 seconds after a disconnect.' : status.phase === 'lobby' ? 'Invite a friend using the room code. Two drawers are needed to start.' : status.phase === 'drawing' ? role === 'judge' ? 'Watch the drawings. Voting opens when the timer ends.' : 'Draw the prompt! Your work appears for everyone when you lift your finger.' : status.phase === 'voting' ? 'Time to judge! Choose your favourite drawing.' : `${status.result?.winner === 'tie' ? 'It’s a tie!' : `${status.result?.winner ?? ''} wins!`} · ${status.result?.leftVotes ?? 0}–${status.result?.rightVotes ?? 0}`)}
      {connected && status.phase === 'lobby' && role !== 'judge' && <button onClick={() => socket.current?.emit('start_round', { room })}>Start round</button>}
    </div>
    {role !== 'judge' && <div className="drawing-tools">
      <button aria-pressed={tool === 'brush'} onClick={() => setTool('brush')}>Brush</button>
      <button aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')}>Eraser</button>
      <label>Colour <input aria-label="Brush colour" type="color" value={colour} onChange={e => setColour(e.target.value)} /></label>
      <label>Size <input aria-label="Brush size" type="range" min="2" max="40" value={width} onChange={e => setWidth(Number(e.target.value))} /></label>
      <button disabled={!canDraw} onClick={() => socket.current?.emit('undo', { room })}>Undo</button>
      <button disabled={!canDraw} onClick={() => socket.current?.emit('redo', { room })}>Redo</button>
    </div>}
    <section className="drawing-grid">
      {(['left', 'right'] as const).map(side => <article key={side} className={`drawing-card ${role === side ? 'my-canvas' : ''}`}>
        <div className="canvas-heading"><h2>{side === 'left' ? 'Left' : 'Right'} artist {role === side && '· You'}</h2>
          {role === 'judge' && status.phase === 'voting' && <button disabled={!connected || seconds === 0} aria-pressed={vote === side} onClick={() => { if (socket.current?.connected) { socket.current.emit('cast_vote', { room, vote: side }); setVote(side); } }}>{vote === side ? '✓ Selected' : 'Vote'}</button>}
        </div>
        <canvas ref={el => { canvases.current[side] = el; }} aria-label={`${side} drawing canvas`} style={{ touchAction: role === side ? 'none' : 'pan-y' }}
          onContextMenu={e => e.preventDefault()}
          onPointerDown={e => {
            if (!canDraw || role !== side || active.current || seconds === 0 || (e.button !== 0 && e.button !== 2)) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            active.current = { side, pointer: e.pointerId, stroke: { type: e.button === 2 ? 'eraser' : tool, colour, width, points: [canvasPoint(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect())] } };
            paint(side);
          }}
          onPointerMove={e => {
            const drawing = active.current;
            if (!drawing || drawing.pointer !== e.pointerId || drawing.side !== side) return;
            if (drawing.stroke.points.length < 5000) drawing.stroke.points.push(canvasPoint(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect()));
            paint(side);
          }}
          onPointerUp={e => { if (active.current?.pointer === e.pointerId) finish(); }}
          onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)} />
      </article>)}
    </section>
    {status.phase === 'voting' && <p className="game-footer">{votes} judge vote{votes === 1 ? '' : 's'} cast. {role !== 'judge' && 'Drawers cannot vote.'}</p>}
  </main>;
}
