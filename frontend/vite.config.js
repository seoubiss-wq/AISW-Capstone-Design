import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SUPABASE_URL = String(
  (IS_PRODUCTION ? process.env.PROD_SUPABASE_URL : process.env.DEV_SUPABASE_URL) || "",
).trim();
const SUPABASE_PUBLISHABLE_KEY = String(
  (IS_PRODUCTION
    ? process.env.PROD_SUPABASE_PUBLISHABLE_KEY
    : process.env.DEV_SUPABASE_PUBLISHABLE_KEY) || "",
).trim();

export default defineConfig({
  base: "./",
  plugins: [react()],
  envPrefix: ["VITE_", "REACT_APP_", "DEV_", "PROD_"],
  define: {
    __SUPABASE_URL__: JSON.stringify(SUPABASE_URL),
    __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(SUPABASE_PUBLISHABLE_KEY),
  },
  server: {
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/auth": {
        target: "http://127.0.0.1:5500",
        changeOrigin: true,
      },
      "/user": {
        target: "http://127.0.0.1:5500",
        changeOrigin: true,
      },
      "/recommend": {
        target: "http://127.0.0.1:5500",
        changeOrigin: true,
      },
      "/place-details": {
        target: "http://127.0.0.1:5500",
        changeOrigin: true,
      },
      "/place-photo": {
        target: "http://127.0.0.1:5500",
        changeOrigin: true,
      },
    },
  },
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
