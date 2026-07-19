import { useEffect, useRef, useState } from "react";

export function StatsPanel() {
    const [stats, setStats] = useState({
        visits: 0,
        activeUsers: 0,
        totalPlaytimeSeconds: 0
    });

    const initializedRef = useRef(false);
    const sessionIdRef = useRef<string | null>(null);
    const endedRef = useRef(false);

    useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;

        const existingSessionId = sessionStorage.getItem("drawoff-stats-session-id");
        const sessionId = existingSessionId ?? crypto.randomUUID();
        sessionStorage.setItem("drawoff-stats-session-id", sessionId);
        sessionIdRef.current = sessionId;

        const loadStats = async () => {
            try {
                const res = await fetch("/api/stats");
                const data = await res.json();
                setStats({
                    visits: data.visits ?? 0,
                    activeUsers: data.activeUsers ?? 0,
                    totalPlaytimeSeconds: data.totalPlaytimeSeconds ?? 0
                });
            } catch (err) {
                console.error("Stats fetch failed:", err);
            }
        };

        const recordVisit = async () => {
            try {
                const res = await fetch("/api/stats/visit", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sessionId })
                });

                const data = await res.json();
                setStats({
                    visits: data.visits ?? 0,
                    activeUsers: data.activeUsers ?? 0,
                    totalPlaytimeSeconds: data.totalPlaytimeSeconds ?? 0
                });
            } catch (err) {
                console.error("Visit record failed:", err);
            }
        };

        const heartbeat = window.setInterval(async () => {
            if (!sessionIdRef.current) return;

            try {
                const res = await fetch("/api/stats/heartbeat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sessionId: sessionIdRef.current })
                });

                const data = await res.json();
                setStats({
                    visits: data.visits ?? 0,
                    activeUsers: data.activeUsers ?? 0,
                    totalPlaytimeSeconds: data.totalPlaytimeSeconds ?? 0
                });
            } catch (err) {
                console.error("Heartbeat failed:", err);
            }
        }, 60000);

        const endSession = () => {
            if (endedRef.current || !sessionIdRef.current) return;
            endedRef.current = true;

            fetch("/api/stats/session/end", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId: sessionIdRef.current })
            }).catch(() => {});
        };

        loadStats();
        recordVisit();

        window.addEventListener("pagehide", endSession);
        window.addEventListener("beforeunload", endSession);

        return () => {
            clearInterval(heartbeat);
            window.removeEventListener("pagehide", endSession);
            window.removeEventListener("beforeunload", endSession);
            endSession();
        };
    }, []);

    return (
        <div>
            <p>Visits: {stats.visits}</p>
            <p>Active Users: {stats.activeUsers}</p>
            <p>Total Playtime: {stats.totalPlaytimeSeconds}s</p>
        </div>
    );
}