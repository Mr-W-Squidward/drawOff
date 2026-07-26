const NEWS_UPDATES = [
    {
        date: "Jul 26",
        title: "Rate Limiting + Validation/Sanitization",
        text: "Made our website safer to use! Will double check all routes + safeguards too before release :)"
    },
    {
        date: "Jul 25",
        title: "Judging",
        text: "Auto-join now routes to the correct servers! The database keeps track of stats :*)"
    },
    {
        date: "Jul 19",
        title: "Database",
        text: "The cards on the home screen, styling and stats menu have been restyled/updated to work properly again"
    },
    {
        date: "Jul 14",
        title: "Homepage Polish",
        text: "The cards on the home screen, styling and stats menu have been readded/updated to work!"
    },
    {
        date: "Jul 7",
        title: "Revamp + Animations + Assets",
        text: "Adjusted the look and styling for consistency!"
    },
    {
        date: "Jun 19",
        title: "Eraser Tool",
        text: "Fixed bugs + functionality with states, made eraser tool work."
    },
    {
        date: "Jun 5",
        title: "Revamp + Clearing + State/History Functionality (Undo, Redo, etc)",
        text: "Made some adjustments so the game was gamer friendly and playable!"
    },
    {
        date: "May 24",
        title: "Canvas Refs + Research Done",
        text: "Colour changing, sides, brush strokes on canvasses, etc."
    },
    {
        date: "May 11",
        title: "Init",
        text: "First time making drawOff (incomplete idea, just a 1v1 game though)."
    }
]

export function News() {
    return (
        <>
            <style>
                {`
                    .news-scroll {
                        scrollbar-width: thin;
                        scrollbar-color: #4b5563 #2c2a3d;
                    }

                    .news-scroll::-webkit-scrollbar {
                        width: 8px;
                    }

                    .news-scroll::-webkit-scrollbar-track {
                        background: #2c2a3d;
                        border-radius: 999px;
                    }

                    .news-scroll::-webkit-scrollbar-thumb {
                        background: #4b5563;
                        border-radius: 999px;
                        border: 1px solid #2c2a3d;
                    }

                    .news-scroll::-webkit-scrollbar-thumb:hover {
                        background: #374151;
                    }
                `}
            </style>

            <div className="mx-5 w-48 h-40 rounded-lg border border-white/20 bg-[#2c2a3d] text-left text-white">
                <div className="news-scroll h-[calc(100%-1.5rem)] overflow-y-auto">
                    <h4 className="text-center my-2 text-sm font-bold">News</h4>
                    <div className="mt-1 space-y-2">
                        {NEWS_UPDATES.map((item, index) => (
                            <div key={index} className="rounded border border-white/10 bg-black/10 p-2">
                                <div className="text-[10px] uppercase tracking-wide text-gray-300"> 
                                    {item.date}
                                </div>
                                <div className="text-xs font-semibold">{item.title}</div>
                                <p className="mt-1 text-[11px] leading-4 text-gray-200">
                                    {item.text}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </>
    )
}