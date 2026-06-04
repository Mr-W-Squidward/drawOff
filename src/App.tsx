import { useRef, useEffect, useState } from "react";

const wordList = ["Bunny", "Sunflower", "Lavender Roses", "Glasses", "Sudoku",
    "Birthday Cake", "Bear", "Bird", "Sunset and Mountain Landscape", "Galaxy", "Cutie", "Tung Tung Tung Sahur", "Tuff signature"
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
  const [leftVotes, setLeftVotes] = useState(0);
  const [rightVotes, setRightVotes] = useState(0);
  const [showColourWheel, setShowColourWheel] = useState(false);

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