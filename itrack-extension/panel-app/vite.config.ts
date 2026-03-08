import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../panel",
    emptyOutDir: true,
    rollupOptions: {
      input: "src/main.tsx",
      output: {
        format: "iife",
        name: "ItrackPanel",
        entryFileNames: "panel.js",
        assetFileNames: "panel.[ext]",
        inlineDynamicImports: true,
      },
    },
  },
});
