import { Link, useNavigate } from "react-router-dom"
import { useEffect, type JSX } from "react"
import { StatsPanel } from "../components/statsPanel";
import { HowToPlay } from "../components/tutorial"
import { News } from "../components/news";
import { audioManager } from "../utils/audioManager";

export default function Home(): JSX.Element {
    const navigate = useNavigate();

    useEffect(() => {
        audioManager.preload();
        audioManager.startHomeBgm();
        const unlockBgm = () => audioManager.startHomeBgm();
        window.addEventListener('pointerdown', unlockBgm, { once: true });
        window.addEventListener('keydown', unlockBgm, { once: true });
        return () => {
            window.removeEventListener('pointerdown', unlockBgm);
            window.removeEventListener('keydown', unlockBgm);
            audioManager.stopHomeBgm();
        };
    }, []);

    const handleAutoJoin = () => {
        // The server selects the fullest room that still has capacity.
        audioManager.play('navigate');
        navigate('/game');
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
                    
                    <Link to="/create" onClick={() => audioManager.play('navigate')}>
                        <button className="cursor-pointer border-4 border-double bg-blue-600 px-4 py-2 text-white rounded">Create Lobby</button>
                    </Link>

                    <Link to="/join" onClick={() => audioManager.play('navigate')}>
                        <button className="cursor-pointer border-4 border-double bg-blue-600 px-4 py-2 text-white rounded">Join Lobby</button>
                    </Link>
                    
                    <div className="flex items-center justify-center mt-10">
                        <HowToPlay />
                            
                        <News />
                        
                        <StatsPanel />
                    </div>
                </div>
            </div>
        </div>
    )
};
