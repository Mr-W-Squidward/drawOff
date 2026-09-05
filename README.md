# drawOff

A small multiplayer drawing game: two artists get the same prompt, draw for 60 seconds, then up to three judges have 15 seconds to vote. Results show for five seconds before another round can start. With two players and no judges, the result is a tie.

## Run locally

Use Node.js 24 or newer.

```sh
npm install
npm --prefix server install
npm run dev
```

Open http://localhost:5173. Statistics use a local SQLite file by default; Turso credentials in `server/.env` are optional. Create a room and share its code or URL. Use separate browser tabs or devices for players and judges. The first round starts when both drawers arrive; subsequent rounds start with the Start round button.

For phones on the same Wi-Fi, open `http://YOUR_COMPUTER_LAN_IP:5173`. Vite proxies HTTP and Socket.IO to the game server, so phones never connect to their own localhost. Allow port 5173 through your local firewall if needed. For remote friends, host the frontend and proxy `/socket.io` (including WebSocket upgrades) and `/api` to the server; configure `CORS_ORIGIN` for that origin. This repository does not deploy hosting automatically.

## Controls and reconnects

Use a mouse, pen, or finger. Brush, eraser, colour, width, undo, and redo are available in the toolbar; right-click also erases. Each completed stroke is sent to the server. Both canvases use a 1000 × 750 coordinate space and a fixed 4:3 aspect ratio, independent of screen size or pixel density. Mobile layouts place your canvas first.

Refresh or reconnect within 60 seconds to recover your seat, drawing history, phase, prompt, deadline, vote, and results. Identity and the last room are stored per browser tab. Drawing is disabled while disconnected, and unfinished strokes are discarded. After the grace period the seat can be reused. Rooms are in memory and are lost when the server restarts; run one server instance for this milestone.

## Checks

```sh
npm run build
npm --prefix server run typecheck
npm run lint
npm test
```

The multiplayer test starts an isolated server on port 15174 with an in-memory statistics database and shortened test-only timers. It checks prompt/deadline consistency, role enforcement, round transitions, reconnects during drawing/voting/results, and replay. Canvas checks cover coordinate scaling, clipping, single-point strokes, and eraser reset.

Manual device check: join the same room on a phone and desktop, draw and erase near all four corners, rotate the phone, refresh mid-round, and verify both canvases agree. Add a third client to vote, then start another round.
