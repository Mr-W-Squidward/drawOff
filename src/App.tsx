import { useRef, useEffect, useState } from "react";

const wordList = ["Bunny", "Sunflower", "Lavender Roses", "Glasses", "Sudoku",
    "Birthday Cake", "Bear", "Bird", "Sunset and Mountain Landscape", "Galaxy", "Cutie", "Tung Tung Tung Sahur"
];

function chooseRandomWord(words: string[]): string {
  const randomNumber = Math.floor(Math.random() * words.length)
  return words[randomNumber];
} 

export default function App() {
  const brushColourRef = useRef("black");
  const lineWidthRef = useRef(4);
  const canvasLeftRef = useRef<HTMLCanvasElement>(null);
  const canvasRightRef = useRef<HTMLCanvasElement>(null);

  function changeColour(brushColour: string) {
    brushColourRef.current = brushColour;
  }

  // Canvas drawing refs -> add line width / colour wheel / socket.io later
  const [selectedWord] = useState(() => chooseRandomWord(wordList));
  useEffect(() => {
    const setupCanvas = (canvas: HTMLCanvasElement | null) => {
      if (!canvas) throw new Error('Could not load canvas')
      const ctx = canvas.getContext('2d');

      const resizeCanvas = () => {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
      };

      resizeCanvas();

      let rect = canvas.getBoundingClientRect();
      const isDrawing = { current: false }

      const onMouseDown = (event: MouseEvent) => {
        rect = canvas.getBoundingClientRect();
        isDrawing.current = true;
        if (!ctx) return;
        ctx.strokeStyle = brushColourRef.current;
        ctx.lineWidth = lineWidthRef.current;
        ctx.beginPath();
        ctx.moveTo(event.clientX - rect.left, event.clientY - rect.top);
      };

      const onMouseMove = (event: MouseEvent) => {
        if (!isDrawing.current || !ctx) return;
        ctx.lineTo(event.clientX - rect.left, event.clientY - rect.top);
        ctx.stroke();
      }

      const stopDrawing = () => {
        isDrawing.current = false;
      }
      
      canvas.addEventListener("mousedown", onMouseDown);
      canvas.addEventListener("mousemove", onMouseMove);
      canvas.addEventListener('mouseup', stopDrawing);
      canvas.addEventListener('mouseleave', stopDrawing);
      window.addEventListener('resize', resizeCanvas);

      return () => {
        canvas.removeEventListener("mousedown", onMouseDown);
        canvas.removeEventListener("mousemove", onMouseMove);
        canvas.removeEventListener('mouseup', stopDrawing);
        canvas.removeEventListener('mouseleave', stopDrawing);
        window.removeEventListener('resize', resizeCanvas);
      }
    };

    const cleanupLeft = setupCanvas(canvasLeftRef.current);
    const cleanupRight = setupCanvas(canvasRightRef.current);

    return () => {
      cleanupLeft();
      cleanupRight();
    };
  }, []);

  return (
    <>
      <div className="w-full h-screen bg-[#000000]">        
        {/* Game Wrapper */}
        <div className="relative w-full h-screen">

          {/* Toolbar -- Shared Spot */}
          <header className="absolute inset-x-0 top-4 z-20">
            <div className="flex justify-center">
              {/* Saved Colours */}
              <div className="flex items-center justify-center gap-2 select-none pointer-events-auto">
                <button className="w-10 h-10 bg-[#000000] border border-black" onClick={() => changeColour("#000000")}/>
                <button className="w-10 h-10 bg-[#FF0000] border border-black" onClick={() => changeColour("#FF0000")}></button>
                <button className="w-10 h-10 bg-[#0000FF] border border-black" onClick={() => changeColour("#0000FF")}></button>
                <button className="w-10 h-10 bg-[#00FF00] border border-black" onClick={() => changeColour("#00FF00")}></button>
                <button className="w-10 h-10 bg-[#FFFF00] border border-black" onClick={() => changeColour("#FFFF00")}></button>
              </div>

              {/* Line Width Slider */}
              <input
                type="range"
                min="1"
                max="16"
                step="3"
                defaultValue={lineWidthRef.current}
                onChange={(e) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  lineWidthRef.current = v;
                }}
              />

              {/* Colour Wheel */}
              <div>
                
              </div>
            </div>
          </header>

          {/* Drawing Prompt */}
          <h1 className="absolute inset-x-0 text-center top-1/2 z-10 select-none pointer-events-none">
            <span className="inline-block border border-black px-3 py-2 bg-[#345421]">
              {selectedWord}
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