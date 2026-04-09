import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const useProdSupabaseConfig =
    mode === "production" && env.REACT_APP_FORCE_SAME_ORIGIN !== "true";
  const supabaseUrl = useProdSupabaseConfig
    ? env.PROD_SUPABASE_URL
    : env.DEV_SUPABASE_URL;
  const supabasePublishableKey = useProdSupabaseConfig
    ? env.PROD_SUPABASE_PUBLISHABLE_KEY
    : env.DEV_SUPABASE_PUBLISHABLE_KEY;

  return {
    base: "./",
    plugins: [react()],
    envPrefix: ["VITE_", "REACT_APP_", "DEV_", "PROD_"],
    define: {
      __SUPABASE_URL__: JSON.stringify(supabaseUrl || ""),
      __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(supabasePublishableKey || ""),
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
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = String(id || "").replace(/\\/g, "/");

            if (normalizedId.includes("/src/GoogleRouteMap.jsx") ||
              normalizedId.includes("/src/MapDirectionsPage.jsx") ||
              normalizedId.includes("/src/googleMapsLoader.js")) {
              return "maps";
            }

            if (normalizedId.includes("/node_modules/")) {
              if (
                normalizedId.includes("/react/") ||
                normalizedId.includes("/react-dom/") ||
                normalizedId.includes("/scheduler/")
              ) {
                return "react-vendor";
              }

              if (normalizedId.includes("/@tanstack/react-query/")) {
                return "query-vendor";
              }

              if (normalizedId.includes("/@supabase/supabase-js/")) {
                return "supabase-vendor";
              }

              return "vendor";
            }

            return undefined;
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/setupTests.js",
      css: true,
    },
  };
});
