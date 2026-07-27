import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const TUTORIAL = [
    {
        title: "HOW TO PLAY",
        description: "DrawOff is a multiplayer drawing game where you VERSE other players in real-time and compete to earn the votes of others.",
    },
    {
        title: "1. Join A Lobby",
        description: "Hit 'Play' to join a match or make your own lobby and share the code to invite your friends directly!",
    },
    {
        title: "2. Compete",
        description: "Use your mouse or touch-screen to draw before time expires! Beat your opponent by drawing it better AND faster.",
    },
    {
        title: "3. Cast Your Guess",
        description: "Judging? Type your guesses in as fast as possible! Vote on the best drawing w/ others!",
    },
    {
        title: "4. Climb The Leaderboard",
        description: "The player with the highest score at the end of all rounds wins!",
    },
] as const;

export function HowToPlay() {
    const [current, setCurrent] = useState(0);
    const tutorial = TUTORIAL[current] ?? TUTORIAL[0];

    const handlePrev = () => {
        setCurrent((previous) => (previous === 0 ? TUTORIAL.length - 1 : previous - 1));
    };

    const handleNext = () => {
        setCurrent((next) => (next === TUTORIAL.length - 1 ? 0 : next + 1));
    };

    return (
        <div className="flex h-40 w-56 flex-col justify-between rounded-lg border border-white/20 bg-[#2c2a3d] p-3 text-white">
            <h4 className="text-sm font-bold">{tutorial.title}</h4>
            <p className="mt-1 flex-1 overflow-y-auto text-xs">{tutorial.description}</p>

            <div className="mt-2 flex items-center justify-between">
                <button aria-label="Previous tutorial slide" className="cursor-pointer" onClick={handlePrev} type="button">
                    <ChevronLeft size={16} />
                </button>

                <div className="flex gap-1">
                    {TUTORIAL.map((_, index) => (
                        <span
                            key={index}
                            className={`h-1.5 w-1.5 rounded-full ${index === current ? "bg-white" : "bg-white/30"}`}
                        />
                    ))}
                </div>

                <button aria-label="Next tutorial slide" className="cursor-pointer" onClick={handleNext} type="button">
                    <ChevronRight size={16} />
                </button>
            </div>
        </div>
    );
}