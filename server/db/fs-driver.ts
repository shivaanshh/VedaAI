import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AssessmentRecord, AssessmentSummary, PageKind } from "@/lib/types";
import {
  BadRequestError,
  NotFoundError,
  summarise,
  type Repository,
  type StoredImage,
} from "./types";

/**
 * Filesystem storage. The default, so that `npm install && npm run dev` gives a
 * working product with history and no account to create anywhere.
 *
 * Layout is one directory per assessment:
 *
 *   .data/<id>/record.json
 *   .data/<id>/question-000.jpg
 *   .data/<id>/answer-000.jpg
 *
 * Page images stay as files rather than being inlined into the JSON. A record
 * is read and rewritten on every step of the job; carrying several megabytes of
 * base64 through each of those rewrites would be wasteful, and files can be
 * streamed straight back to the browser with a cache header.
 */

function root(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  // On a serverless host the bundle directory is read-only and /tmp is the only
  // writable path. It is per-instance and short-lived, which is exactly why
  // `durable` is false there and the UI warns about it.
  if (process.env.VERCEL) return path.join(os.tmpdir(), "veda-data");
  return path.join(process.cwd(), ".data");
}

/** Ids come from us, but this is user-reachable input by the time it is a URL. */
function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new BadRequestError("Malformed assessment id.");
  return id;
}

function dir(id: string): string {
  return path.join(root(), safeId(id));
}

function pageFile(id: string, kind: PageKind, index: number): string {
  return path.join(dir(id), `${kind}-${String(index).padStart(3, "0")}.jpg`);
}

/** Write to a sibling then rename, so a crash mid-write cannot truncate a record. */
async function writeAtomic(file: string, data: string | Buffer): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

export class FsRepository implements Repository {
  readonly name = "filesystem";
  readonly durable = !process.env.VERCEL;

  async init(): Promise<void> {
    await fs.mkdir(root(), { recursive: true });
  }

  async create(record: AssessmentRecord): Promise<AssessmentRecord> {
    await fs.mkdir(dir(record.id), { recursive: true });
    await writeAtomic(path.join(dir(record.id), "record.json"), JSON.stringify(record, null, 2));
    return record;
  }

  async get(id: string): Promise<AssessmentRecord | null> {
    try {
      const raw = await fs.readFile(path.join(dir(id), "record.json"), "utf8");
      return JSON.parse(raw) as AssessmentRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async update(id: string, patch: Partial<AssessmentRecord>): Promise<AssessmentRecord> {
    const current = await this.get(id);
    if (!current) throw new NotFoundError(id);

    const next: AssessmentRecord = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };

    await writeAtomic(path.join(dir(id), "record.json"), JSON.stringify(next, null, 2));
    return next;
  }

  async list(limit: number): Promise<AssessmentSummary[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(root());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }

    const records = await Promise.all(
      entries.map(async (id) => {
        try {
          return await this.get(id);
        } catch {
          // A half-written or hand-edited record should not take out the whole
          // history screen.
          return null;
        }
      })
    );

    return records
      .filter((r): r is AssessmentRecord => r !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(summarise);
  }

  async remove(id: string): Promise<void> {
    await fs.rm(dir(id), { recursive: true, force: true });
  }

  async putPage(id: string, kind: PageKind, index: number, image: StoredImage): Promise<void> {
    await fs.mkdir(dir(id), { recursive: true });
    await writeAtomic(pageFile(id, kind, index), image.bytes);
  }

  async getPage(id: string, kind: PageKind, index: number): Promise<StoredImage | null> {
    try {
      const bytes = await fs.readFile(pageFile(id, kind, index));
      return { mime: "image/jpeg", bytes };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}
