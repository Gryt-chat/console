import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],

  /* Relative asset URLs, so the built app works wherever it is mounted. The
     tunnel serves it at /console today and the server injects a <base> to
     match; anything absolute here would break that. */
  base: "./",

  server: {
    proxy: { "/api": "http://127.0.0.1:3002" },
  },
});
