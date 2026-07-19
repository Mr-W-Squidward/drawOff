import { useState, type JSX } from "react";
import { useNavigate } from "react-router-dom";

export default function JoinLobby(): JSX.Element {
    const navigate = useNavigate()
    const [roomCode, setRoomCode] = useState("");

    const joinRoom = (room: string) => {
        if (!room) return;
        navigate(`/game/game_${room.trim()}`);
    }
    
    return (
        <div className="min-h-screen flex items-center justify-center bg-[#050505] text-white">
            <div className="w-full max-w-md rounded-xl border border-gray-700 bg-[#111] p-8">
                <h1 className="mb-6 text-2xl font-bold">Join a game</h1>

                <div className="space-y-3">
                    <input 
                        value={roomCode}
                        onChange={(e) => setRoomCode(e.target.value)}
                        placeholder="ex) 123123"
                        className="w-full rounded border border-blue-600 bg-[#0f0f0f] px-3 py-2 text-white outline-none"
                    />
                    <button
                        className="w-full rounded bg-blue-700 px-4 py-3 text-white transition fade hover:bg-blue-500"
                        onClick={(() => joinRoom(roomCode))}
                    >
                        Join Room
                    </button>
                </div>
            </div>
        </div>
    )
};
