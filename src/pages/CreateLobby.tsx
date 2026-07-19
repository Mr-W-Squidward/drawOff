import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const makeRoomId = () => `game_${Math.floor(Math.random() * 100000)}`

export default function CreateLobby() {
    const navigate = useNavigate();

    useEffect(() => {
        const roomId = makeRoomId();
        navigate(`/game/${roomId}`, { replace: true })
    }, [navigate])


    return (
        <div>
            <div className="rounded-xl border border-gray-700 bg-[#111] p-8 text-center">
                <p className="text-lg font-semibold">Creating room...</p>
                <p className="mt-3 text-sm text-gray 400">
                    Redirecting into new game automatically...
                </p>
            </div>
        </div>
    )
};
