const wordList = ["Bunny", "Sunflower", "Lavender Roses", "Glasses", "Sudoku",
    "Birthday Cake", "Bear", "Bird", "Sunset and Mountain Landscape", "Galaxy", "Cutie",
];

function chooseRandomWord(words: string[]): string {
  const randomNumber = Math.floor(Math.random() * words.length)
  return words[randomNumber];
}

function App() {
  return (
    <>
      <div className="w-full h-screen bg-[#000000]">        
        {/* Game Wrapper */}
        <div className="relative w-full h-screen">

          {/* Toolbar -- Shared Spot */}
        <header className="absolute inset-x-0 top-4 z-20">
          {/* Saved Colours */}
          <div className="flex mx-auto items-center justify-center gap-2">
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
          <h1 className="absolute inset-x-0 text-center top-1/2 z-10">
            <span className="inline-block border border-black px-3 py-2 bg-[#345421]">
              {chooseRandomWord(wordList)}
            </span>
          </h1>

          {/* Canvas Wrapper */}
          <div className="flex h-full">

            <canvas className="w-1/2 bg-[#123123]">

            </canvas>

            <canvas className="w-1/2 bg-[#321321]">

            </canvas>
          </div>
        </div>
      </div>
    </>
  )
}

export default App
