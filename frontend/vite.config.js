import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const useProdSupabaseConfig = mode === "production" && env.REACT_APP_FORCE_SAME_ORIGIN !== "true";
  const supabaseUrl = useProdSupabaseConfig ? env.PROD_SUPABASE_URL : env.DEV_SUPABASE_URL;
  const supabasePublishableKey = useProdSupabaseConfig
    ? env.PROD_SUPABASE_PUBLISHABLE_KEY
    : env.DEV_SUPABASE_PUBLISHABLE_KEY;

  return {
    base: "./",
    plugins: [react()],
    envPrefix: ["VITE_", "REACT_APP_"],
    define: {
      __SUPABASE_URL__: JSON.stringify(supabaseUrl || ""),
      __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(supabasePublishableKey || ""),
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
  };
});
