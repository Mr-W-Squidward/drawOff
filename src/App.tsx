import { useRef, useEffect } from "react";

const wordList = ["Bunny", "Sunflower", "Lavender Roses", "Glasses", "Sudoku",
    "Birthday Cake", "Bear", "Bird", "Sunset and Mountain Landscape", "Galaxy", "Cutie",
];

function chooseRandomWord(words: string[]): string {
  const randomNumber = Math.floor(Math.random() * words.length)
  return words[randomNumber];
} 


export default function App() {
  const brushColourRef = useRef("black");
  const canvasLeftRef = useRef<HTMLCanvasElement>(null);
  const canvasRightRef = useRef<HTMLCanvasElement>(null);

  function changeColour(brushColour: string) {
    brushColourRef.current = brushColour;
  }


  useEffect(() => {
    const canvas = canvasLeftRef.current;
    if (!canvas) throw new Error('Could not load canvas')
    const ctx = canvas.getContext('2d');

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const updateRect = () => canvas.getBoundingClientRect();
    let rect = updateRect();
    const isDrawing = { current: false };

    const onMouseDown = (event: MouseEvent) => {
      rect = updateRect();
      isDrawing.current = true;
      if (ctx) ctx.strokeStyle = brushColourRef.current;
      ctx?.beginPath();
      ctx?.moveTo(event.clientX - rect.left, event.clientY - rect.top);
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!isDrawing.current) return;
      ctx?.lineTo(event.clientX - rect.left, event.clientY - rect.top);
      ctx?.stroke();
    }
    
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener('mouseup', () => isDrawing.current = false );
    canvas.addEventListener('mouseleave', () => isDrawing.current = false );

    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mousemove", onMouseMove);
    }}, []);

  return (
    <>
      <div className="w-full h-screen bg-[#000000]">        
        {/* Game Wrapper */}
        <div className="relative w-full h-screen">

          {/* Toolbar -- Shared Spot */}
        <header className="absolute inset-x-0 top-4 z-20">
          {/* Saved Colours */}
          <div className="flex mx-auto items-center justify-center gap-2 select-none pointer-events-auto">
            <button className="w-10 h-10 bg-[#000000] border border-black" onClick={() => changeColour("#000000")}/>
            <button className="w-10 h-10 bg-[#FF0000] border border-black" onClick={() => changeColour("#FF0000")}></button>
            <button className="w-10 h-10 bg-[#0000FF] border border-black" onClick={() => changeColour("#0000FF")}></button>
            <button className="w-10 h-10 bg-[#00FF00] border border-black" onClick={() => changeColour("#00FF00")}></button>
            <button className="w-10 h-10 bg-[#FFFF00] border border-black" onClick={() => changeColour("#FFFF00")}></button>
          </div>

          {/* Colour Wheel */}
          <div>
            
          </div>
        </header>

          {/* Drawing Prompt */}
          <h1 className="absolute inset-x-0 text-center top-1/2 z-10 select-none pointer-events-none">
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