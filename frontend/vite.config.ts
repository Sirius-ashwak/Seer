import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Honor the PORT env when set (e.g. the Claude preview harness assigns one),
    // otherwise default to 5173. Lets the preview browser reach the dev server.
    port: Number(process.env.PORT) || 5173,
    host: true,
  },
});
