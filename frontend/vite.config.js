import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  envPrefix: ["VITE_", "REACT_APP_"],
  build: {
    outDir: "build",
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/setupTests.js",
    css: true,
  },
});
