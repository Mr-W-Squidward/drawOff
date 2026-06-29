import { Link, useNavigate } from "react-router-dom"
import React, { type JSX } from "react"

export default function Home(): JSX.Element {
    const navigate = useNavigate();

    return (
        <div className="min-h screen flex items-center justify-center">
            <div className="space-y-4 text-center">
                <h1 className="text-2xl font-bold rounded mt-15 animate-bobble">drawOff</h1>
                
                <div className="space-y-4 text-center flex flex-col mt-10">
                    {/* Play, Create Lobby, Join Lobby */}
                    <Link to="/game">
                        <button 
                            className="cursor-pointer border-4 border-double bg-blue-600 px-4 py-2 text-white rounded"
                            onClick={() => navigate(`/game`)}
                        >
                            Play
                        </button>
                    </Link>
                    
                    <Link to="/create">
                        <button className="cursor-pointer border-4 border-double bg-blue-600 px-4 py-2 text-white rounded">Create Lobby</button>
                    </Link>

                    <Link to="/join">
                        <button className="cursor-pointer border-4 border-double bg-blue-600 px-4 py-2 text-white rounded">Join Lobby</button>
                    </Link>
                    
                    <div className="flex items-center justify-center">
                        <div className="mx-5">
                            <p>HOW TO PLAY</p>
                        </div>
                            
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