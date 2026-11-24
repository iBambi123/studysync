import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the client runs on :5173 and talks to the server on :3001.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/socket.io": { target: "http://localhost:3001", ws: true },
      "/health": "http://localhost:3001",
    },
  },
});
