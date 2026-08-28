import {
  generateJSON,
  imagePart,
  padBox,
  textPart,
  toBox,
  type InlineImage,
} from "../ai/gemini";
import {
  ANSWER_SCHEMA,
  ANSWER_SYSTEM,
  QUESTION_SCHEMA,
  QUESTION_SYSTEM,
} from "../ai/prompts";
import type { Region } from "@/lib/types";

/**
 * Turning page images into structured questions and answer blocks.
 *
 * Everything the model returns is treated as a proposal, never as fact. The
 * validation below is not defensive padding — each rule corresponds to a way a
 * multimodal model actually fails, and letting any of them through would put a
 * highlight on the wrong ink.
 */

export interface PageInput {
  /** Index within the whole document, which is what the model is told. */
  index: number;
  image: InlineImage;
}

export interface RawQuestion {
  number: string;
  text: string;
  marks: number | null;
  page: number;
}

export interface RawBlock {
  writtenLabel: string | null;
  transcription: string;
  regions: Region[];
  /**
   * Set on the first block of a batch when the model judges it to be the tail
   * of an answer that began on a page in an earlier batch. Meaningless anywhere
   * but the head of the list, which is where the caller reads it.
   */
  continuesPrevious: boolean;
}

/**
 * Labelling each image with its page index before sending it is what makes the
 * returned `page` field trustworthy. Without the label the model has no name
 * for the sheet it is looking at and the index becomes a guess.
 */
function labelled(pages: PageInput[], caption: string) {
  return pages.flatMap((page) => [
    textPart(`--- ${caption}, page index ${page.index} ---`),
    imagePart(page.image),
  ]);
}

export async function extractQuestions(pages: PageInput[]): Promise<RawQuestion[]> {
  if (!pages.length) return [];

  const parts = labelled(pages, "Question paper");
  parts.push(
    textPart(
      `Return every question printed on the ${pages.length} page(s) above, in printed order. Use the stated page index for each.`
    )
  );

  const result = await generateJSON<{ questions: Array<Partial<RawQuestion>> }>({
    system: QUESTION_SYSTEM,
    parts,
    schema: QUESTION_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0,
  });

  return (result.questions ?? [])
    .filter((q) => q?.number && q?.text)
    .map((q) => ({
      number: String(q.number).trim(),
      text: String(q.text).trim(),
      marks: typeof q.marks === "number" ? q.marks : null,
      page: Number.isFinite(q.page) ? Number(q.page) : pages[0].index,
    }));
}

export async function extractAnswers(
  pages: PageInput[],
  /** True for every batch after the first, so a mid-answer start can be flagged. */
  continues: boolean
): Promise<RawBlock[]> {
  if (!pages.length) return [];

  const parts = labelled(pages, "Answer sheet");
  parts.push(
    textPart(
      [
        `Return the answer blocks on the ${pages.length} page(s) above, with a tight box for each region.`,
        continues
          ? "These pages continue an answer sheet whose earlier pages you have not seen. If the writing at the top of the first page here is clearly the tail of an answer begun earlier, return it as its own block with a null writtenLabel and continuesPrevious set to true."
          : "",
      ]
        .filter(Boolean)
        .join(" ")
    )
  );

  const result = await generateJSON<{
    blocks: Array<{
      writtenLabel?: string | null;
      continuesPrevious?: boolean | null;
      transcription?: string;
      regions?: Array<{ page: number; box: number[] }>;
    }>;
  }>({
    system: ANSWER_SYSTEM,
    parts,
    schema: ANSWER_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0,
  });

  const shown = new Set(pages.map((p) => p.index));

  return (result.blocks ?? [])
    .map((b) => {
      const regions: Region[] = (b.regions ?? [])
        .map((r) => {
          const box = toBox(r.box);
          // A region placed on a page the model was never shown is a
          // hallucinated index; drawing it would highlight the wrong sheet.
          if (!box || !shown.has(r.page)) return null;
          return { page: r.page, box: padBox(box) };
        })
        .filter((r): r is Region => r !== null);

      return {
        writtenLabel: b.writtenLabel ? String(b.writtenLabel).trim() : null,
        // Only meaningful when we actually told the model it was mid-sheet.
        // Trusting it on the first batch would let a confident model glue the
        // opening answer onto nothing.
        continuesPrevious: continues && b.continuesPrevious === true,
        transcription: String(b.transcription ?? "").trim(),
        regions,
      };
    })
    // A block with no locatable region cannot be highlighted, which is the one
    // thing this product exists to do. Omitting it beats showing a question as
    // answered with nowhere to point.
    .filter((b) => b.regions.length > 0 && b.transcription.length > 0);
}
