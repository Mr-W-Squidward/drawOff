import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiPort = Number(process.env.API_PORT ?? 5174);

export default defineConfig({
  server: {
    host: true,
    proxy: {
      "/socket.io": { target: `http://127.0.0.1:${apiPort}`, ws: true, changeOrigin: true },
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },

  plugins: [react(), tailwindcss()],
});
