import express from "express";
import cors from "cors";
import { endSession, getStats, heartbeatSession, recordVisit } from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/stats/visit", (req, res) => {
  const { sessionId } = req.body ?? {};

  if (!sessionId) {
    return res.status(400).json({ error: "SessionId required" });
  }

  const createdVisit = recordVisit(sessionId);
  res.json({
    ...getStats(),
    createdVisit,
  });
});

app.post("/api/stats/heartbeat", (req, res) => {
  const { sessionId } = req.body ?? {};

  if (!sessionId) {
    return res.status(400).json({ error: "SessionId required" });
  }

  res.json(heartbeatSession(sessionId));
});

app.post("/api/stats/session/end", (req, res) => {
  const { sessionId } = req.body ?? {};

  if (!sessionId) {
    return res.status(400).json({ error: "SessionId required" });
  }

  res.json(endSession(sessionId));
});

app.get("/api/stats", (_req, res) => {
  res.json(getStats());
});

const PORT = Number(process.env.PORT ?? 3001);

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Stats server running on http://127.0.0.1:${PORT}`);
});