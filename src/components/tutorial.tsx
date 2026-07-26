import { useState } from "react";

const TUTORIAL = [
    {
        title: "HOW TO PLAY",
        description: "DrawOff is a multiplayer drawing game where you VERSE other players in real-time and compete to earn the votes of others."
    },
    {
        title: "1. Join A Lobby",
        description: "Hit 'Play' to join a match or make your own lobby and share the code to invite your friends directly!"
    },
    {
        title: "2. Compete",
        description: "Use your mouse or touch-screen to draw before time expires! Beat your opponent by drawing it better AND faster."
    },
    {
        title: "3. Cast Your Guess",
        description: "Judging? Type your guesses in as fast as possible! Vote on the best drawing w/ others!"
    },
    {
        title: "4. Climb The Leaderboard",
        description: "The player with the highest score at the end of all rounds wins!"
    }
]

export function HowToPlay() {
    const [current, setCurrent] = useState(0);

    const handlePrev = () => {
        setCurrent((prev: number) => (prev === 0 ? TUTORIAL.length-1 : prev - 1));
    }
    
    const handleNext = () => {
        setCurrent((next: number) => (next === TUTORIAL.length - 1 ? 0 : next + 1))
    }

    return (
        <div className="bg-[#2c2a3d] text-white rounded-lg border border-white/20 w-56 h-40 p-3 flex flex-col justify-between">
            <h4 className="text-sm font-bold">
                {TUTORIAL[current].title}
            </h4>
            <p className="text-xs overflow-y-auto flex-1 mt-1">
                {TUTORIAL[current].description}
            </p>

            <div className="flex items-center justify-between mt-2">
                <button className="cursor-pointer" onClick={handlePrev}>
                    <ChevronLeft size={16} />
                </button>

                <div className="flex gap-1">
                    {TUTORIAL.map((_, i) => (
                        <span 
                            key={i}
                            className={`w-1.5 h-1.5 rounded-full ${i === current ? "bg-white" : "bg-white/30"}`}
                        />
                    ))}
                </div>

                <button className="cursor-pointer" onClick={handleNext}>
                    <ChevronRight size={16} />
                </button>
            </div>
        </div>
    )
};