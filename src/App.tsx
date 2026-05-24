import { useRef, useState, useEffect } from "react";

const wordList = ["Bunny", "Sunflower", "Lavender Roses", "Glasses", "Sudoku",
    "Birthday Cake", "Bear", "Bird", "Sunset and Mountain Landscape", "Galaxy", "Cutie",
];

function chooseRandomWord(words: string[]): string {
  const randomNumber = Math.floor(Math.random() * words.length)
  return words[randomNumber];
}

export default function App() {
  const canvasLeftRef = useRef<HTMLCanvasElement>(null);
  const canvasRightRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
  const canvas = canvasLeftRef.current;
  if (!canvas) throw new Error('Could not load canvas')
  const ctx = canvas.getContext('2d');

  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;

  const rect = canvas.getBoundingClientRect();

  const isDrawing = { current: false };

  window.addEventListener('mousedown', (event: MouseEvent) => {
    isDrawing.current = true;
    ctx?.beginPath();
    ctx?.moveTo(event.clientX - rect.left, event.clientY - rect.top)
  });
  

  window.addEventListener('mousemove', (event: MouseEvent) => {
    if (!isDrawing.current) return;
    ctx?.lineTo(event.clientX - rect.left, event.clientY - rect.top)
    ctx?.stroke();
  });

  window.addEventListener('mouseup', (event: MouseEvent) => isDrawing.current = false );
  window.addEventListener('mouseleave', (event: MouseEvent) => isDrawing.current = false );
}, [])

  return (
    <>
      <div className="w-full h-screen bg-[#000000]">        
        {/* Game Wrapper */}
        <div className="relative w-full h-screen">

          {/* Toolbar -- Shared Spot */}
        <header className="absolute inset-x-0 top-4 z-20">
          {/* Saved Colours */}
          <div className="flex mx-auto items-center justify-center gap-2 select-none pointer-events-auto">
            <button className="w-10 h-10 bg-[#123412] border border-black"></button>
            <button className="w-10 h-10 bg-[#432234] border border-black"></button>
            <button className="w-10 h-10 bg-[#543543] border border-black"></button>
            <button className="w-10 h-10 bg-[#788456] border border-black"></button>
            <button className="w-10 h-10 bg-[#905673] border border-black"></button>
          </div>

          {/* Colour Wheel */}
          <div>
            
          </div>
        </header>

          {/* Drawing Prompt */}
          <h1 className="absolute inset-x-0 text-center top-1/2 z-10 select-none pointer-events-auto">
            <span className="inline-block border border-black px-3 py-2 bg-[#345421]">
              {chooseRandomWord(wordList)}
            </span>
          </h1>

          {/* Canvas Wrapper */}
          <div className="flex h-full">

            <canvas id="canvasLeft" className="w-1/2 bg-[#123123]" ref={canvasLeftRef}/>
            <canvas id="canvasRight" className="w-1/2 bg-[#521312]" ref={canvasRightRef}/>

          </div>
        </div>
      </div>
    </>
  )
}