import { useRef, useEffect, useState, type RefObject } from "react";
import { io, Socket } from 'socket.io-client';
import type { Stroke, CanvasState } from '../types/canvas.types';
import { redrawCanvas } from '../utils/canvasUtils'
import { useParams } from "react-router-dom";

/** The canvas backgrounds are CSS classes, so the export has to repaint them. */
const CANVAS_BACKGROUNDS = { left: '#123123', right: '#521312' } as const;

/**
 * Exports a canvas as a PNG data URL with `background` painted under the
 * strokes. A bare `toDataURL()` sends the judge strokes on transparency, and a
 * dark stroke on transparency-flattened-to-black is invisible.
 */
function exportCanvasWithBackground(canvas: HTMLCanvasElement, background: string): string {
  const flattened = document.createElement('canvas');
  flattened.width = canvas.width;
  flattened.height = canvas.height;
  const ctx = flattened.getContext('2d');
  if (!ctx) return canvas.toDataURL('image/png');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, flattened.width, flattened.height);
  ctx.drawImage(canvas, 0, 0);
  return flattened.toDataURL('image/png');
}

export default function Game() {
  const { roomId: routeRoomId } = useParams<{ roomId?: string }>()
  const brushColourRef = useRef("black");
  const lineWidthRef = useRef(4);
  const socketRef = useRef<Socket | null>(null);
  const playerSideRef = useRef<'left' | 'right' | null>(null);
  const canvasLeftRef = useRef<HTMLCanvasElement>(null);
  const canvasRightRef = useRef<HTMLCanvasElement>(null);
  const canvasStateLeftRef = useRef<CanvasState>({ history: [], historyIndex: -1, currentTool: 'brush' })
  const canvasStateRightRef = useRef<CanvasState>({ history: [], historyIndex: -1, currentTool: 'brush' })
  const phaseRef = useRef<'lobby' | 'drawing' | 'results'>('lobby');
  const [phase, setPhase] = useState<'lobby' | 'drawing' | 'results'>('lobby');
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(60);
  const [leftVotes, setLeftVotes] = useState(0);
  const [rightVotes, setRightVotes] = useState(0);
  const [winner, setWinner] = useState<'left' | 'right' | 'tie' | null>(null);
  const [leftScore, setLeftScore] = useState<number | null>(null);
  const [rightScore, setRightScore] = useState<number | null>(null);
  const [leftReasoning, setLeftReasoning] = useState<string | null>(null);
  const [rightReasoning, setRightReasoning] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [votesCast, setVotesCast] = useState(0);
  const [showColourWheel, setShowColourWheel] = useState(false);
  const [role, setRole] = useState<'left' | 'right' | 'judge' | null>(null);
  const [, forceUpdate] = useState({});
  const [roomId, setRoomId] = useState<string | null>(routeRoomId ?? null);

  function undoStroke(canvasRef: RefObject<HTMLCanvasElement | null>, stateRef: RefObject<CanvasState>) {
    if (!canvasRef.current) return;
    if (stateRef.current.historyIndex >= 0) {
        stateRef.current.historyIndex--;
        redrawCanvas(canvasRef.current, stateRef.current.history, stateRef.current.historyIndex)
        
        if (socketRef.current && roomIdRef.current) {
          socketRef.current.emit('undo', { room: roomIdRef.current });
        }

        forceUpdate({});
    }
  }

  function redoStroke(canvasRef: RefObject<HTMLCanvasElement | null>, stateRef: RefObject<CanvasState>) {
    if (!canvasRef.current) return;
    if (stateRef.current.historyIndex + 1 < stateRef.current.history.length) {
      stateRef.current.historyIndex++;
      redrawCanvas(canvasRef.current, stateRef.current.history, stateRef.current.historyIndex)
      
      if (socketRef.current && roomIdRef.current) {
        socketRef.current.emit('redo', { room: roomIdRef.current });
      }

      forceUpdate({});
    } 
  }

  function changeColour(brushColour: string) {
    brushColourRef.current = brushColour;
    setShowColourWheel(false);
  }

  function handleColourWheelChange(e: React.ChangeEvent<HTMLInputElement>) {
    const colour = e.target.value;
    brushColourRef.current = colour;
  }

  function startRound() {
    if ((role === 'left' || role === 'right') && roomIdRef.current) {
      socketRef.current?.emit('start_round', { room: roomIdRef.current });
    }
  }

  function castVote(vote: 'left' | 'right') {
    if (role === 'judge' && phaseRef.current === 'drawing' && roomIdRef.current) {
      socketRef.current?.emit('cast_vote', { room: roomIdRef.current, vote });
    }
  }
  
  
  // The prompt is chosen by the server and broadcast in round_started /
  // round_status, so both drawers (and the AI judge) share one authoritative
  // word instead of each client picking its own.
  const [promptText, setPromptText] = useState<string | null>(null);
  const roomIdRef = useRef<string | null>(null);

  // A clientId persisted in localStorage identifies this browser across a
  // socket reconnect (e.g. a page reload), so the server can recognise a
  // returning judge as the same voter instead of granting a fresh vote slot.
  const clientIdRef = useRef<string>((() => {
    const stored = localStorage.getItem('clientId');
    if (stored) return stored;
    const generated = crypto.randomUUID();
    localStorage.setItem('clientId', generated);
    return generated;
  })());

  useEffect(() => {
    if (phase !== 'drawing' || endsAt === null) return;
    const updateTimer = () => setSecondsRemaining(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    updateTimer();
    const timer = window.setInterval(updateTimer, 250);
    return () => window.clearInterval(timer);
  }, [phase, endsAt]);

  // Drawing with SOCKET.IO
  useEffect(() => {
    // In production the frontend is served by the same Express process that
    // hosts Socket.IO, so `io()` with no URL (same origin) is correct. In dev
    // the app runs on Vite's 5173 while the server listens on 5174, so an
    // explicit URL is required there. VITE_SERVER_URL overrides both.
    const serverUrl =
      import.meta.env.VITE_SERVER_URL ?? (import.meta.env.DEV ? 'http://localhost:5174' : undefined);
    const socket = serverUrl ? io(serverUrl) : io();
    socketRef.current = socket;

    socket.on('connect', () => {
      if (routeRoomId) {
        roomIdRef.current = routeRoomId;
        setRoomId(routeRoomId);
        socket.emit('join_room', { roomId: routeRoomId, clientId: clientIdRef.current });
      } else {
        socket.emit('find_match', { clientId: clientIdRef.current });
      }
    });

    socket.on('room_assigned', (assignment: { roomId: string; role: 'left' | 'right' | 'judge' }) => {
      roomIdRef.current = assignment.roomId;
      setRoomId(assignment.roomId);
      setRole(assignment.role);
      if (assignment.role === 'judge') {
        playerSideRef.current = null;
      } else {
        playerSideRef.current = assignment.role;
      }
    });

    socket.on('round_status', (status: { phase: 'lobby' | 'drawing' | 'results'; endsAt: number | null; promptText?: string | null }) => {
      phaseRef.current = status.phase;
      setPhase(status.phase);
      setEndsAt(status.endsAt);
      setPromptText(status.promptText ?? null);
    });

    socket.on('round_started', (round: { endsAt: number; promptText?: string | null }) => {
      phaseRef.current = 'drawing';
      setPhase('drawing');
      setEndsAt(round.endsAt);
      setSecondsRemaining(60);
      setWinner(null);
      setLeftVotes(0);
      setRightVotes(0);
      setVotesCast(0);
      setPromptText(round.promptText ?? null);
      setLeftScore(null);
      setRightScore(null);
      setLeftReasoning(null);
      setRightReasoning(null);
      setAiError(null);
    });

    // The server asks for final canvas exports when the drawing timer ends;
    // only the two drawers have anything to submit.
    socket.on('request_drawings', () => {
      const side = playerSideRef.current;
      if (side !== 'left' && side !== 'right') return;
      const canvas = side === 'left' ? canvasLeftRef.current : canvasRightRef.current;
      if (!canvas || !roomIdRef.current) return;
      try {
        const dataUrl = exportCanvasWithBackground(canvas, CANVAS_BACKGROUNDS[side]);
        const imageBase64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        socket.emit('submit_drawing', { room: roomIdRef.current, side, imageBase64 });
      } catch (error) {
        console.warn('Failed to export canvas for scoring', error);
      }
    });

    socket.on('round_timer', (timer: { remainingMs: number }) => {
      setSecondsRemaining(Math.max(0, Math.ceil(timer.remainingMs / 1000)));
    });

    // Broadcast on every accepted vote, so the per-canvas counters tick live
    // for everyone in the room (drawers included), not just at round end.
    socket.on('vote_status', (status: { votesCast: number; leftVotes: number; rightVotes: number }) => {
      setVotesCast(status.votesCast);
      setLeftVotes(status.leftVotes);
      setRightVotes(status.rightVotes);
    });

    socket.on('round_ended', (result: {
      winner: 'left' | 'right' | 'tie';
      leftVotes: number;
      rightVotes: number;
      leftScore?: number | null;
      rightScore?: number | null;
      leftReasoning?: string | null;
      rightReasoning?: string | null;
      aiError?: string | null;
    }) => {
      phaseRef.current = 'results';
      setPhase('results');
      setEndsAt(null);
      setSecondsRemaining(0);
      setWinner(result.winner);
      setLeftVotes(result.leftVotes);
      setRightVotes(result.rightVotes);
      setLeftScore(result.leftScore ?? null);
      setRightScore(result.rightScore ?? null);
      setLeftReasoning(result.leftReasoning ?? null);
      setRightReasoning(result.rightReasoning ?? null);
      setAiError(result.aiError ?? null);
    });

    socket.on('round_reset', () => {
      phaseRef.current = 'lobby';
      setPhase('lobby');
      setEndsAt(null);
      setSecondsRemaining(60);
      setWinner(null);
      setLeftVotes(0);
      setRightVotes(0);
      setVotesCast(0);
      setPromptText(null);
      setLeftScore(null);
      setRightScore(null);
      setLeftReasoning(null);
      setRightReasoning(null);
      setAiError(null);
    });

    socket.on('player_side_assigned', (side: 'left' | 'right') => {
      console.log('🎯 player_side_assigned received:', side);
      playerSideRef.current = side;
      setRole(side);
      forceUpdate({});
    });

    socket.on('opponent_draw', (data: {side: 'left' | 'right'; stroke: Stroke }) => {
      console.log('🎨 opponent_draw received, player side:', playerSideRef.current);
      const stateRef = data.side === 'left' ? canvasStateLeftRef : canvasStateRightRef;
      const canvasRef = data.side === 'left' ? canvasLeftRef : canvasRightRef;

      // STROKE goes to OPPONENT'S history
      stateRef.current.history = stateRef.current.history.slice(0, stateRef.current.historyIndex+1);
      stateRef.current.history.push(data.stroke);
      stateRef.current.historyIndex += 1;
      
      if (canvasRef.current) {
        redrawCanvas(canvasRef.current, stateRef.current.history, stateRef.current.historyIndex);
      }
    });

    socket.on('room_state', (data: { 
      left: { history: Stroke[], index: number };
      right: { history: Stroke[], index: number };
    }) => {
      
      canvasStateLeftRef.current.history = data.left.history;
      canvasStateLeftRef.current.historyIndex = data.left.index;

      canvasStateRightRef.current.history = data.right.history;
      canvasStateRightRef.current.historyIndex = data.right.index;

      if (canvasLeftRef.current) {
        redrawCanvas(canvasLeftRef.current, data.left.history, data.left.index);
      };

      if (canvasRightRef.current) {
        redrawCanvas(canvasRightRef.current, data.right.history, data.right.index);
      }
    });

    socket.on('disconnect', () => {
      console.log('❌ Disconnected from server');
    });

    socket.on('connect_error', (error) => {
      console.error('❌ Connection error:', error);
    });

    return () => {
      // Reload persistence
      localStorage.setItem('canvasStateLeft', JSON.stringify(canvasStateLeftRef.current));
      localStorage.setItem('canvasStateRight', JSON.stringify(canvasStateRightRef.current));
      socket.disconnect();
    };
  }, [routeRoomId]);
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (phaseRef.current !== 'drawing') return;
        if (e.key === 'z') {
          e.preventDefault()
          
          if (playerSideRef.current === 'left') {
            undoStroke(canvasLeftRef, canvasStateLeftRef);
          } else {
            undoStroke(canvasRightRef, canvasStateRightRef);
          }
        };

        if (e.key === 'y') {
          e.preventDefault()
          if (playerSideRef.current === 'left') {
            redoStroke(canvasLeftRef, canvasStateLeftRef);
          } else {
            redoStroke(canvasRightRef, canvasStateRightRef);
          }
        };
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, []);
  
  useEffect(() => {
    const loadSavedState = (
      key: string,
      stateRef: RefObject<CanvasState>,
      canvasRef: RefObject<HTMLCanvasElement | null>
    ) => {
      const stored = localStorage.getItem(key);
      if (!stored) return;
      try {
        stateRef.current = JSON.parse(stored);
        if (canvasRef.current) {
          redrawCanvas(canvasRef.current, stateRef.current.history, stateRef.current.historyIndex)
        }
      } catch (error) {
        console.warn('Failed to parse saved canvas state', key, error);
      }
    };

    loadSavedState('canvasStateLeft', canvasStateLeftRef, canvasLeftRef);
    loadSavedState('canvasStateRight', canvasStateRightRef, canvasRightRef);

    const setupCanvas = (canvas: HTMLCanvasElement | null, stateRef: RefObject<CanvasState>) => {
      if (!canvas) return () => {}
      const ctx = canvas.getContext('2d');

      const resizeCanvas = () => {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;

        if (ctx) {
          redrawCanvas(canvas, stateRef.current.history, stateRef.current.historyIndex)
        }
      };

      resizeCanvas();

      let rect = canvas.getBoundingClientRect();
      const isDrawing = { current: false }
      let currentStroke: Stroke | null = null;

      const onMouseDown = (event: MouseEvent) => {
        const isLeftCanvas = canvas.id === 'canvasLeft';
        if (phaseRef.current !== 'drawing' || playerSideRef.current !== (isLeftCanvas ? 'left' : 'right')) {
          return;
        }

        // Determine tool based on mouse button
        const isRightClick = event.button === 2;
        const toolToUse = isRightClick ? 'eraser' : 'brush';
        
        rect = canvas.getBoundingClientRect();
        isDrawing.current = true;
        if (!ctx) return;
        
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        currentStroke = {
          type: toolToUse,
          colour: brushColourRef.current,
          width: lineWidthRef.current,
          points: [{ x, y }]
        };
        
        if (toolToUse === 'eraser') {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.strokeStyle = canvas.id === 'canvasLeft' ? '#123123' : '#521312';
        } else {
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = brushColourRef.current;
        }
        
        ctx.lineWidth = lineWidthRef.current;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
      };

      const onContextMenu = (event: MouseEvent) => {
        event.preventDefault()
      }

      const onMouseMove = (event: MouseEvent) => {
        if (!isDrawing.current || !ctx || !currentStroke) return;
        
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        currentStroke.points.push({ x, y });
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      const stopDrawing = () => {
        if (!isDrawing.current || !currentStroke) {
          isDrawing.current = false;
          return;
        }
        
        isDrawing.current = false;

        // Determine which canvas this is
        const isLeftCanvas = canvas.id === 'canvasLeft';
        const stateRef = isLeftCanvas ? canvasStateLeftRef : canvasStateRightRef;

        // Remove any redo history (when drawn)
        stateRef.current.history = stateRef.current.history.slice(0, stateRef.current.historyIndex+1);

        // Add stroke to history
        stateRef.current.history.push(currentStroke);
        stateRef.current.historyIndex += 1;

        localStorage.setItem(isLeftCanvas ? 'canvasStateLeft' : 'canvasStateRight', JSON.stringify(stateRef.current));

        // Emit stroke to server only if this is the player's assigned canvas
          if (playerSideRef.current === (isLeftCanvas ? 'left' : 'right') && socketRef.current && roomIdRef.current) {          
            socketRef.current.emit('draw', {
              room: roomIdRef.current,
              drawStroke: currentStroke,
              side: isLeftCanvas ? 'left' : 'right',
          });
        }

        currentStroke = null;
        
      }
      
      canvas.addEventListener("mousedown", onMouseDown);
      canvas.addEventListener("mousemove", onMouseMove);
      canvas.addEventListener('mouseup', stopDrawing);
      canvas.addEventListener('mouseleave', stopDrawing);
      canvas.addEventListener('contextmenu', onContextMenu)
      window.addEventListener('resize', resizeCanvas);

      return () => {
        canvas.removeEventListener("mousedown", onMouseDown);
        canvas.removeEventListener("mousemove", onMouseMove);
        canvas.removeEventListener('mouseup', stopDrawing);
        canvas.removeEventListener('mouseleave', stopDrawing);
        canvas.removeEventListener('contextmenu', onContextMenu)
        window.removeEventListener('resize', resizeCanvas);
      }
    };

    const cleanupLeft = setupCanvas(canvasLeftRef.current, canvasStateLeftRef);
    const cleanupRight = setupCanvas(canvasRightRef.current, canvasStateRightRef);

    return () => {
      cleanupLeft();
      cleanupRight();
    };
  }, []);

  return (
    <>
      <div className="w-full h-screen bg-[#000000] flex flex-col">
        {/* Fixed Toolbar at Top */}
        <header className="flex-shrink-0 bg-[#1a1a1a] border-b border-gray-700 p-4 z-30">
          <div className="flex justify-between items-center">
            {/* Player Info */}
            <div className="text-white text-sm">
              <div>Room: <span className="font-mono text-yellow-400">{roomId || 'Connecting...'}</span></div>
              <div>Role: <span className={`font-bold ${role === 'left' ? 'text-blue-400' : role === 'right' ? 'text-red-400' : 'text-gray-400'}`}>
                {role ? role.toUpperCase() : 'Waiting...'}
              </span>
              </div>
            </div>

            <div className="text-center text-white">
              <div className="text-xs uppercase text-gray-400">{phase}</div>
              <div className="font-mono text-2xl">{phase === 'drawing' ? `0:${secondsRemaining.toString().padStart(2, '0')}` : phase === 'results' ? 'Round complete' : 'Lobby'}</div>
              {role === 'judge' && phase === 'drawing' && <div className="text-xs text-gray-400">Votes cast: {votesCast}</div>}
            </div>

            <div className="flex justify-center items-center gap-6">
              {/* Saved Colours */}
              <div className="flex items-center justify-center gap-2 select-none pointer-events-auto">
                <button className="w-8 h-8 bg-[#000000] border border-gray-500 hover:border-white transition" onClick={() => changeColour("#000000")} title="Black"/>
                <button className="w-8 h-8 bg-[#FF0000] border border-gray-500 hover:border-white transition" onClick={() => changeColour("#FF0000")} title="Red"></button>
                <button className="w-8 h-8 bg-[#0000FF] border border-gray-500 hover:border-white transition" onClick={() => changeColour("#0000FF")} title="Blue"></button>
                <button className="w-8 h-8 bg-[#00FF00] border border-gray-500 hover:border-white transition" onClick={() => changeColour("#00FF00")} title="Green"></button>
                <button className="w-8 h-8 bg-[#FFFF00] border border-gray-500 hover:border-white transition" onClick={() => changeColour("#FFFF00")} title="Yellow"></button>
              </div>

            {/* Colour Wheel Picker */}
            <div className="relative">
              <button 
                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 border border-gray-500 text-white text-sm transition"
                onClick={() => setShowColourWheel(!showColourWheel)}
              >
                Colour Wheel
              </button>
              {showColourWheel && (
                <div className="absolute top-full mt-2 left-0 bg-[#2a2a2a] border border-gray-500 p-3 rounded z-40">
                  <input 
                    type="color" 
                    defaultValue="black"
                    onChange={handleColourWheelChange}
                    className="w-16 h-16 cursor-pointer"
                  />
                </div>
              )}
            </div>

            {/* Line Width Slider */}
            <div className="flex items-center gap-2">
              <label className="text-white text-sm">Line Width:</label>
              <input
                type="range"
                min="1"
                max="16"
                step="1"
                defaultValue={4}
                onChange={(e) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  lineWidthRef.current = v;
                }}
                className="w-32"
              />
              </div>
            </div>
          </div>
        </header>

        {/* Game Wrapper */}
        <div className="relative flex-1 flex overflow-hidden">

          {/* Drawing Prompt */}
          <h1 className="absolute inset-x-0 top-1/2 transform -translate-y-1/2 text-center z-10 select-none pointer-events-none">
            <span className="inline-block border border-black px-3 py-2 bg-[#345421] text-white text-3xl font-bold">
              {promptText ?? 'Waiting for prompt…'}
            </span>
          </h1>

          {phase === 'lobby' && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50">
              {(role === 'left' || role === 'right') ? (
                <button className="rounded bg-blue-600 px-6 py-3 font-bold text-white hover:bg-blue-500" onClick={startRound}>Start Round</button>
              ) : <p className="rounded bg-[#1a1a1a] p-4 text-white">Waiting for the drawers to start the round…</p>}
            </div>
          )}

          {phase === 'results' && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 text-center text-white">
              <div className="max-w-3xl rounded border border-gray-500 bg-[#1a1a1a] p-8">
                <p className="text-sm uppercase text-gray-400">Round winner</p>
                <p className="mt-2 text-3xl font-bold">{winner === 'tie' ? 'It’s a tie!' : `${winner?.toUpperCase()} wins!`}</p>

                {/* AI judging is shown to everyone in the room, drawers included. */}
                <div className="mt-6 grid grid-cols-2 gap-4 text-left">
                  <div className="rounded border border-blue-700 p-3">
                    <p className="text-xs uppercase text-gray-400">Left · AI score</p>
                    <p className="text-2xl font-bold text-blue-300">{leftScore ?? '—'}</p>
                    <p className="mt-2 text-sm text-gray-200">{leftReasoning ?? 'No AI reasoning available.'}</p>
                  </div>
                  <div className="rounded border border-red-700 p-3">
                    <p className="text-xs uppercase text-gray-400">Right · AI score</p>
                    <p className="text-2xl font-bold text-red-300">{rightScore ?? '—'}</p>
                    <p className="mt-2 text-sm text-gray-200">{rightReasoning ?? 'No AI reasoning available.'}</p>
                  </div>
                </div>

                {aiError && <p className="mt-4 text-xs text-yellow-400">AI judging issue — {aiError}</p>}
              </div>
            </div>
          )}

          {role === 'judge' && phase === 'drawing' && (
            <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 gap-3 rounded bg-[#1a1a1a] p-3 text-white">
              <button className="rounded bg-blue-700 px-4 py-2 hover:bg-blue-500" onClick={() => castVote('left')}>Vote Left</button>
              <button className="rounded bg-red-700 px-4 py-2 hover:bg-red-500" onClick={() => castVote('right')}>Vote Right</button>
            </div>
          )}

          {/* Canvas Wrapper */}
          <div className="flex flex-1 relative">

            <div className="relative w-1/2">
              <canvas id="canvasLeft" className="w-full h-full bg-[#123123]" ref={canvasLeftRef}/>
              {/* Left Vote Counter */}
              <div className="absolute bottom-4 left-4 bg-[#1a1a1a] border-2 border-gray-500 px-3 py-2 text-white font-bold text-lg z-20">
                <div className="text-xs text-gray-400">Votes</div>
                <div className="text-2xl">{leftVotes}</div>
              </div>
            </div>

            <div className="relative w-1/2">
              <canvas id="canvasRight" className="w-full h-full bg-[#521312]" ref={canvasRightRef}/>
              {/* Right Vote Counter */}
              <div className="absolute bottom-4 right-4 bg-[#1a1a1a] border-2 border-gray-500 px-3 py-2 text-white font-bold text-lg z-20">
                <div className="text-xs text-gray-400">Votes</div>
                <div className="text-2xl">{rightVotes}</div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  )
}
