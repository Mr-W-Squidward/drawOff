import { Link, useNavigate } from "react-router-dom"
import React, { useState, type JSX } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

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
        description: "When it's your turn to draw, follow the prompt on-screen accordingly. Use your mouse or touch-screen to draw before time expires! Beat your opponent by drawing it better AND faster."
    },
    {
        title: "3. Cast Your Guess",
        description: "Judging? Watch every stroke come to life and type your guesses in as fast as possible! Determine WHO wins and WHO loses with the others."
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

export default function Home(): JSX.Element {
    const navigate = useNavigate();

    const makeRoomId = () => Math.floor(100000 + Math.random() * 900000).toString();

    const handleAutoJoin = () => {
        const room = makeRoomId();
        navigate(`/game/game_${room}`);
        console.log(`/game/game_${room}`)
    }

    return (
        <div className="relative min-h-screen justify-between flex flex-col items-center justify-center bg-[#232131]">
            {/* Floating Swords! */}
            <div className="absolute inset-0 max-w-5xl mx-auto h-full pointer-events-none flex items-center justify-between px-6 md:px-16">
                {/* Left Sword */}
                <div className="animate-bobble [animation-delay:1.5s] rotate-12 scale-200">
                    <img src="../../sword.png" alt="left-sword" className="w-20 h-auto md:w-32 opacity-80"/>
                </div>

                {/* Right Sword */}
                <div className="animate-bobble [animation-delay:1.5s] -rotate-12 scale-200">
                    <img src="../../sword.png" alt="right-sword" className="w-20 h-auto md:w-32 opacity-80"/>
                </div>
            </div>
            
            <div className="relative z-10 text-center mt-8">
                <h1 className="text-4xl font-bold rounded animate-bobble hover:text-gray-800 duration-300 ease-in">drawOff</h1>
            </div>

            {/* NAVIGATION */}
            <div className="space-y-4 text-center">
                <div className="space-y-4 text-center flex flex-col mt-10">
                    {/* Play, Create Lobby, Join Lobby */}
                    <div>
                        <button 
                            className="cursor-pointer border-4 border-double bg-blue-600 px-4 py-2 text-white rounded"
                            onClick={handleAutoJoin}
                        >
                            Play
                        </button>
                    </div>
                    
                    <Link to="/create">
                        <button className="cursor-pointer border-4 border-double bg-blue-600 px-4 py-2 text-white rounded">Create Lobby</button>
                    </Link>

                    <Link to="/join">
                        <button className="cursor-pointer border-4 border-double bg-blue-600 px-4 py-2 text-white rounded">Join Lobby</button>
                    </Link>
                    
                    <div className="flex items-center justify-center">
                        <HowToPlay />
                            
                        <div className="mx-5">
                            <p>NEWS</p>
                        </div>
                        
                        <div className="mx-5">
                            <p>STATS</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
};