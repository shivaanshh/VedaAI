"use client";

import type { RenderedPage } from "./types";
import { PAGE_BATCH } from "./job";

/**
 * Renders uploads to page images in the browser.
 *
 * This is the most load-bearing file in the project. The image produced here is
 * BOTH what the model receives and what the teacher looks at. If those two ever
 * came from different renders — different scale, different cropping, a
 * server-side rasteriser with different DPI — every bounding box would land in
 * the wrong place and the highlighting requirement would quietly fail.
 *
 * One render. One coordinate space. Everything downstream is percentages.
 */

/**
 * Wide enough that handwriting stays legible to the model, small enough that a
 * batch of pages fits inside a serverless request body. Raising this improves
 * transcription slightly and costs request headroom quickly.
 */
const TARGET_WIDTH = 1600;
const JPEG_QUALITY = 0.82;

type ProgressFn = (done: number, total: number, label: string) => void;

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return lib;
    });
  }
  return pdfjsPromise;
}

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/**
 * Flattens a mixed set of PDFs and images into one ordered page list.
 * Files are processed in the order given, so a teacher uploading page1.jpg and
 * page2.jpg gets them in that order.
 */
export async function renderToPages(
  files: File[],
  onProgress?: ProgressFn,
  /** Page count if the caller already knows it, so the PDFs are parsed once. */
  knownTotal?: number
): Promise<RenderedPage[]> {
  const pages: RenderedPage[] = [];
  let index = 0;

  const totalEstimate = knownTotal ?? (await countPages(files));

  // Counted here rather than read off `pages.length` inside the callback: the
  // page a PDF has just finished is not pushed until the whole file returns, so
  // reading the array made a ten-page PDF sit at zero for its entire render and
  // then jump to ten.
  let done = 0;

  for (const file of files) {
    if (isPdf(file)) {
      const rendered = await renderPdf(file, index, () => {
        done += 1;
        onProgress?.(done, totalEstimate, file.name);
      });
      pages.push(...rendered);
      index += rendered.length;
    } else {
      const page = await renderImage(file, index);
      pages.push(page);
      index += 1;
      done += 1;
      onProgress?.(done, totalEstimate, file.name);
    }
  }

  onProgress?.(pages.length, pages.length, "done");
  return pages;
}

/**
 * Page count without rendering — used by the upload chips to show "2 Pages",
 * and by the render loop to size its progress bar.
 */
export async function countPages(files: File[]): Promise<number> {
  let count = 0;
  for (const file of files) {
    if (!isPdf(file)) {
      count += 1;
      continue;
    }
    try {
      const pdfjs = await getPdfjs();
      const buf = await file.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      count += doc.numPages;
      await doc.destroy();
    } catch {
      count += 1;
    }
  }
  return Math.max(count, 1);
}

async function renderPdf(
  file: File,
  startIndex: number,
  tick: () => void
): Promise<RenderedPage[]> {
  const pdfjs = await getPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;

  const out: RenderedPage[] = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);

    // Scale so the rendered width lands on TARGET_WIDTH regardless of the
    // page's native size — A4, Letter and phone-camera crops all normalise.
    const base = page.getViewport({ scale: 1 });
    const scale = TARGET_WIDTH / base.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser refused a 2D canvas, so pages cannot be rendered.");

    // Scans often carry a transparent background; without this, transparency
    // flattens to black in JPEG and the page arrives unreadable.
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    out.push({
      index: startIndex + n - 1,
      dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
      width: canvas.width,
      height: canvas.height,
      source: file.name,
    });

    page.cleanup();
    tick();
  }

  await doc.destroy();
  return out;
}

async function renderImage(file: File, index: number): Promise<RenderedPage> {
  const bitmap = await createImageBitmap(file);

  // Only ever scale down. Upscaling a low-resolution photo adds no detail for
  // the model and inflates the request body for nothing.
  const scale = Math.min(1, TARGET_WIDTH / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser refused a 2D canvas, so pages cannot be rendered.");

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return {
    index,
    dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
    width,
    height,
    source: file.name,
  };
}

/**
 * Splits pages into request-sized batches.
 *
 * Vercel caps a serverless request body at 4.5 MB. A 1600px JPEG page is
 * roughly 250–500 KB before base64, and base64 adds about a third, so three
 * pages per request stays comfortably clear of the ceiling while keeping the
 * number of round trips low.
 */
export function batchPages(pages: RenderedPage[], size = PAGE_BATCH): RenderedPage[][] {
  const batches: RenderedPage[][] = [];
  for (let i = 0; i < pages.length; i += size) {
    batches.push(pages.slice(i, i + size));
  }
  return batches;
}
