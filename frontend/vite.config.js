import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { canonicalBundleGuard } from './scripts/canonical-bundle.js';

export default defineConfig({
  plugins: [react(), canonicalBundleGuard()],
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_BACKEND_URL || "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
