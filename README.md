# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## Deployment

drawOff deploys as a **single always-on Node service**. The Express server in
`server/` serves three things from one origin: the built frontend (Vite's
`dist/`), the `/api/stats/*` routes, and the Socket.IO endpoint. Because
everything shares an origin, the frontend's relative `/api/...` fetches and its
same-origin socket connection work with no extra configuration.

### Commands

```bash
# install (root + server)
npm install && npm --prefix server install

# build both halves: frontend -> dist/, server -> server/dist/
npm run build:all

# start
npm --prefix server start        # node server/dist/server/index.js
```

Configure your host with build command `npm install && npm --prefix server install && npm run build:all`
and start command `npm --prefix server start`. Node 20 or newer is required
(`@google/genai`).

The server only serves static files when `dist/index.html` exists, so local
`npm run dev` (Vite on 5173 + server on 5174) is unaffected. The startup log
states whether static serving is active and from which path.

### Environment variables

Set these on the host. `server/.env` is for local development only and is not
read in production (`start` deliberately omits `--env-file`).

| Variable | Required | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | yes | AI scoring; rounds fall back to score 0 without it |
| `SCORING_MODEL` | no | Gemini model id override |
| `TURSO_DATABASE_URL` | yes | Turso/libSQL database for the stats tables |
| `TURSO_AUTH_TOKEN` | yes | Turso auth token |
| `DEBUG_SCORING` | no | Set to enable verbose scoring logs |
| `CORS_ORIGIN` | yes | Comma-separated allow-list; set to your deployed origin |
| `PORT` | no | Defaults to 5174; most hosts inject this |

### Two hard constraints

1. **Run exactly one instance. Disable autoscaling.** All game state (`rooms`,
   `socketRooms`, `socketClientIds`) lives in process memory and there is no
   Socket.IO Redis adapter. A second instance would hold its own separate,
   invisible set of rooms, so players could be routed into different copies of
   the same room code.
2. **Do not use a tier that sleeps when idle.** A cold start drops every
   WebSocket connection and wipes all in-progress rooms and rounds.
