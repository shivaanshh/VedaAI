"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "./icons";
import type { AnswerBlock, PageRef, Region } from "@/lib/types";

/**
 * The student's script, with the located answer lit up.
 *
 * Every box arrives as a percentage of its page, so the overlay and the image
 * share one coordinate space no matter how wide the panel gets or what the
 * zoom is set to. That is the whole reason pages are rendered exactly once,
 * in the browser, and never re-rasterised for the model — see lib/pdf.ts.
 */

interface Props {
  pages: PageRef[];
  blocks: AnswerBlock[];
  /** The block the teacher is currently looking at, if any. */
  activeBlockId: string | null;
  orphanBlockIds: string[];
  /** blockId -> the tag shown on its highlight, e.g. "Q2". */
  blockLabels: Record<string, string>;
  /** Shown when a question is selected but nothing answers it. */
  emptyNotice: string | null;
}

const ZOOMS = [50, 75, 100, 125, 150, 200];
const BASE_WIDTH = 860;

export default function SheetViewer({
  pages,
  blocks,
  activeBlockId,
  orphanBlockIds,
  blockLabels,
  emptyNotice,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const regionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const [zoomIdx, setZoomIdx] = useState(2);
  const [currentPage, setCurrentPage] = useState(0);

  const zoom = ZOOMS[zoomIdx];
  const orphanSet = useMemo(() => new Set(orphanBlockIds), [orphanBlockIds]);

  /** Every region on every page, flattened once and grouped by page. */
  const regionsByPage = useMemo(() => {
    const map = new Map<number, Array<{ block: AnswerBlock; region: Region; key: string }>>();
    for (const block of blocks) {
      block.regions.forEach((region, i) => {
        const list = map.get(region.page) ?? [];
        list.push({ block, region, key: `${block.id}:${i}` });
        map.set(region.page, list);
      });
    }
    return map;
  }, [blocks]);

  // Bring the answer into view when the selection changes. Scrolling to the
  // FIRST region matters for multi-page answers: the teacher should land at the
  // start of the answer, then scroll on into its continuation naturally.
  useEffect(() => {
    if (!activeBlockId) return;
    const target = regionRefs.current.get(`${activeBlockId}:0`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeBlockId, zoomIdx]);

  // Which page the teacher is actually looking at, for the "Page 2 of 4"
  // readout. Derived from scroll rather than from clicks, so it stays honest
  // when they scroll the stack by hand.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const idx = Number((visible.target as HTMLElement).dataset.page);
        if (Number.isFinite(idx)) setCurrentPage(idx);
      },
      { root, threshold: [0.15, 0.4, 0.75] }
    );

    pageRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [pages.length]);

  const goToPage = useCallback((idx: number) => {
    const el = pageRefs.current.get(idx);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const activeBlock = blocks.find((b) => b.id === activeBlockId) ?? null;
  const spannedPages = activeBlock
    ? new Set(activeBlock.regions.map((r) => r.page)).size
    : 0;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5">
        <h2 className="text-[13px] font-bold text-ink">Answer Sheet</h2>

        {spannedPages > 1 ? (
          <span className="rounded-full bg-good-soft px-2 py-0.5 text-[10.5px] font-semibold text-good">
            spans {spannedPages} pages
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 rounded-lg border border-line px-0.5 py-0.5">
            <IconBtn
              label="Zoom out"
              disabled={zoomIdx === 0}
              onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
            >
              <Minus className="h-3.5 w-3.5" />
            </IconBtn>
            <span className="ref w-[42px] text-center text-[11px] font-semibold tabular-nums text-body">
              {zoom}%
            </span>
            <IconBtn
              label="Zoom in"
              disabled={zoomIdx === ZOOMS.length - 1}
              onClick={() => setZoomIdx((i) => Math.min(ZOOMS.length - 1, i + 1))}
            >
              <Plus className="h-3.5 w-3.5" />
            </IconBtn>
          </div>

          <div className="flex items-center gap-0.5 rounded-lg border border-line px-0.5 py-0.5">
            <IconBtn
              label="Previous page"
              disabled={currentPage === 0}
              onClick={() => goToPage(currentPage - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </IconBtn>
            <span className="w-[74px] text-center text-[11px] font-medium tabular-nums text-body">
              Page {currentPage + 1} of {pages.length}
            </span>
            <IconBtn
              label="Next page"
              disabled={currentPage >= pages.length - 1}
              onClick={() => goToPage(currentPage + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </IconBtn>
          </div>
        </div>
      </div>

      {emptyNotice ? (
        <div className="shrink-0 border-b border-bad/20 bg-bad-soft px-4 py-2 text-[12px] font-medium text-bad">
          {emptyNotice}
        </div>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-raised p-4">
        <div className="mx-auto space-y-4" style={{ maxWidth: `${(zoom / 100) * BASE_WIDTH}px` }}>
          {pages.map((page) => {
            const regions = regionsByPage.get(page.index) ?? [];

            return (
              <div
                key={page.index}
                data-page={page.index}
                ref={(el) => {
                  if (el) pageRefs.current.set(page.index, el);
                  else pageRefs.current.delete(page.index);
                }}
              >
                {/* The image and the overlay share this box, so a percentage
                    means the same thing to both however wide it gets. */}
                <div className="relative overflow-hidden rounded-lg border border-line bg-white shadow-card">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={page.url}
                    alt={`Answer sheet page ${page.index + 1}`}
                    className="block w-full select-none"
                    draggable={false}
                  />

                  {regions.map(({ block, region, key }) => {
                    const isActive = block.id === activeBlockId;
                    const isOrphan = orphanSet.has(block.id);
                    const tagBelow = region.box.y < 4;

                    return (
                      <div
                        key={key}
                        ref={(el) => {
                          if (el) regionRefs.current.set(key, el);
                          else regionRefs.current.delete(key);
                        }}
                        aria-hidden
                        className={`pointer-events-none absolute transition-opacity duration-200 ${
                          isActive
                            ? isOrphan
                              ? "region-orphan"
                              : "region-live"
                            : "region-idle opacity-0"
                        }`}
                        style={{
                          left: `${region.box.x}%`,
                          top: `${region.box.y}%`,
                          width: `${region.box.w}%`,
                          height: `${region.box.h}%`,
                        }}
                      >
                        {isActive ? (
                          <span
                            className={`region-tag absolute left-[-2px] animate-markIn ${
                              isOrphan ? "bg-bad" : "bg-good-ring"
                            }`}
                            style={
                              tagBelow
                                ? { top: "100%", borderRadius: "0 0 4px 4px" }
                                : { bottom: "100%" }
                            }
                          >
                            {blockLabels[block.id] ?? "?"}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-1 flex items-baseline gap-2 px-0.5">
                  <span className="ref text-[10.5px] text-faint">
                    p{String(page.index + 1).padStart(2, "0")}
                  </span>
                  <span className="truncate text-[10.5px] text-faint/80">{page.source}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1 text-body transition-colors enabled:hover:bg-raised enabled:hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  );
}
