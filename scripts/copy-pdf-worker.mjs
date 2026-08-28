/**
 * pdf.js runs its parser in a Web Worker. Rather than rely on bundler-specific
 * worker resolution (which differs between `next dev`, `next build` and the
 * Vercel runtime), the worker is copied into /public at install time and
 * loaded from a stable URL.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const candidates = [
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "node_modules/pdfjs-dist/build/pdf.worker.mjs",
];

const source = candidates.map((c) => resolve(root, c)).find((p) => existsSync(p));

if (!source) {
  console.warn("[pdf-worker] pdfjs-dist worker not found — run npm install first.");
  process.exit(0);
}

const target = resolve(root, "public/pdf.worker.min.mjs");
await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
console.log("[pdf-worker] copied worker to public/pdf.worker.min.mjs");
