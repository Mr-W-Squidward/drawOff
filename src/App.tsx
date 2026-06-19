import React, { useRef, useEffect, useState } from "react";
import type { Tool, Stroke, CanvasState } from './types/canvas.types';
import { redrawCanvas } from './utils/canvasUtils'
import wordList, { chooseRandomWord } from './constants/constants'

export default function App() {
  const brushColourRef = useRef("black");
  const lineWidthRef = useRef(4);
  const canvasLeftRef = useRef<HTMLCanvasElement>(null);
  const canvasRightRef = useRef<HTMLCanvasElement>(null);
  const canvasStateLeftRef = useRef<CanvasState>({ history: [], historyIndex: -1, currentTool: 'brush' })
  const canvasStateRightRef = useRef<CanvasState>({ history: [], historyIndex: -1, currentTool: 'brush' })
  const [leftVotes, setLeftVotes] = useState(0);
  const [rightVotes, setRightVotes] = useState(0);
  const [showColourWheel, setShowColourWheel] = useState(false);
  const [eraserSelected, setEraserSelected] = useState(false)
  const [, forceUpdate] = useState({});

  function undoStroke(canvasRef: React.RefObject<HTMLCanvasElement | null>, stateRef: React.RefObject<CanvasState>) {
    if (!canvasRef.current) return;
    if (stateRef.current.historyIndex >= 0) {
        stateRef.current.historyIndex--;
        redrawCanvas(canvasRef.current, stateRef.current.history, stateRef.current.historyIndex)
        forceUpdate({});
    }
  }

  function redoStroke(canvasRef: React.RefObject<HTMLCanvasElement | null>, stateRef: React.RefObject<CanvasState>) {
    if (!canvasRef.current) return;
    if (stateRef.current.historyIndex + 1 < stateRef.current.history.length) {
      stateRef.current.historyIndex++;
      redrawCanvas(canvasRef.current, stateRef.current.history, stateRef.current.historyIndex)
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

  // Canvas drawing refs -> add line width / colour wheel / socket.io later
  const [selectedWord] = useState(() => chooseRandomWord(wordList));
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') {
          e.preventDefault()
          undoStroke(canvasLeftRef, canvasStateLeftRef);
          undoStroke(canvasRightRef, canvasStateRightRef);
        };

        if (e.key === 'y') {
          e.preventDefault()
          redoStroke(canvasLeftRef, canvasStateLeftRef);
          redoStroke(canvasRightRef, canvasStateRightRef);
        };
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, []);
  
  useEffect(() => {
    const setupCanvas = (canvas: HTMLCanvasElement | null, stateRef: React.RefObject<CanvasState>) => {
      if (!canvas) throw new Error('Could not load canvas')
      const ctx = canvas.getContext('2d');

      const resizeCanvas = () => {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
      };

      resizeCanvas();

      let rect = canvas.getBoundingClientRect();
      const isDrawing = { current: false }

      let currentStroke: Stroke | null = null;

      const onMouseDown = (event: MouseEvent) => {
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
          setEraserSelected(true);
        } else {
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = brushColourRef.current;
          setEraserSelected(false);
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

        // Remove any redo history (when drawn)
        stateRef.current.history = stateRef.current.history.slice(0, stateRef.current.historyIndex+1);

        // Add stroke to history
        stateRef.current.history.push(currentStroke);
        stateRef.current.historyIndex += 1;

        currentStroke = null;
        
        // Reset eraser on mouse release
        setEraserSelected(false);
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
                    defaultValue={brushColourRef.current} 
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
                defaultValue={lineWidthRef.current}
                onChange={(e) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  lineWidthRef.current = v;
                }}
                className="w-32"
              />
            </div>
          </div>
        </header>

        {/* Game Wrapper */}
        <div className="relative flex-1 flex overflow-hidden">

          {/* Drawing Prompt */}
          <h1 className="absolute inset-x-0 top-1/2 transform -translate-y-1/2 text-center z-10 select-none pointer-events-none">
            <span className="inline-block border border-black px-3 py-2 bg-[#345421] text-white text-3xl font-bold">
              {selectedWord}
            </span>
          </h1>

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