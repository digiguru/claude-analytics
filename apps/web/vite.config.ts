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
    rolldownOptions: {
      output: {
        // Our own src/ is only ~25 kB built; the rest of the bundle is two
        // vendor libraries. Splitting them out doesn't cut cold-load bytes
        // (it costs ~1 kB gzip in chunk overhead) — it buys cache stability:
        // without it, editing any app file invalidates a 637 kB chunk for
        // everyone, instead of just the small one.
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 20 },
            // recharts plus the transitive deps it drags in (d3-*, a redux
            // stack, es-toolkit). Hand-listed from a sourcemap attribution of
            // the entry chunk, so a recharts upgrade that adds a new
            // dependency will drop it back into the app chunk — the 500 kB
            // build warning is deliberately left on as the tripwire for that.
            {
              name: "charts",
              test: /node_modules[\\/](recharts|d3-.*|decimal\.js-light|@reduxjs|redux|react-redux|reselect|immer|es-toolkit|eventemitter3)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
