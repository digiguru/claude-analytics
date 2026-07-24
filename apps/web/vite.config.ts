import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api to the Fastify backend so the browser never holds the key.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
  build: {
    outDir: "dist",
  },
});
