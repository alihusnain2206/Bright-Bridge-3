import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

/**
 * Mirrors the esbuild `loader: { ".pdf": "base64" }` setting used in build.mjs.
 * Without this, `import f8655Base64 from "../assets/f8655.pdf"` resolves to the
 * file path string instead of base64-encoded bytes, causing PDFDocument.load to
 * throw inside buildForm8655Pdf during tests.
 */
const pdfBase64Plugin: Plugin = {
  name: "pdf-base64",
  transform(_code: string, id: string) {
    if (id.endsWith(".pdf")) {
      const bytes = readFileSync(id);
      const base64 = bytes.toString("base64");
      return { code: `export default "${base64}";`, map: null };
    }
  },
};

export default defineConfig({
  plugins: [pdfBase64Plugin],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
