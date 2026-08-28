import { Pool } from "pg";
import type { AssessmentRecord, AssessmentSummary, PageKind } from "@/lib/types";
import { NotFoundError, summarise, type Repository, type StoredImage } from "./types";

/**
 * Postgres storage. Used whenever DATABASE_URL is set, which is how the
 * deployed build gets history that survives an instance being recycled.
 *
 * The whole record is kept as a single jsonb column rather than being spread
 * across a table per entity. The shapes are read and written whole, are never
 * queried by their internals, and change together as the schema evolves — a
 * relational decomposition here would buy joins nobody performs at the cost of
 * a migration every time a field moves.
 */

const DDL = `
create table if not exists assessments (
  id          text primary key,
  title       text        not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  record      jsonb       not null
);

create index if not exists assessments_created_at_idx
  on assessments (created_at desc);

create table if not exists assessment_pages (
  assessment_id text   not null references assessments(id) on delete cascade,
  kind          text   not null,
  page_index    int    not null,
  mime          text   not null,
  bytes         bytea  not null,
  primary key (assessment_id, kind, page_index)
);
`;

let pool: Pool | null = null;
let ready: Promise<void> | null = null;

function db(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set.");

    pool = new Pool({
      connectionString: url,
      // Hosted Postgres (Neon, Supabase, Railway) requires TLS and presents a
      // chain Node does not ship a root for. A local database needs none.
      ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export class PgRepository implements Repository {
  readonly name = "postgres";
  readonly durable = true;

  /** Idempotent, and memoised so concurrent requests run the DDL once. */
  init(): Promise<void> {
    if (!ready) {
      ready = db()
        .query(DDL)
        .then(() => undefined)
        .catch((err) => {
          // Let the next request retry rather than caching a failed connection.
          ready = null;
          throw err;
        });
    }
    return ready;
  }

  async create(record: AssessmentRecord): Promise<AssessmentRecord> {
    await this.init();
    await db().query(
      `insert into assessments (id, title, created_at, updated_at, record)
       values ($1, $2, $3, $4, $5)`,
      [record.id, record.title, record.createdAt, record.updatedAt, record]
    );
    return record;
  }

  async get(id: string): Promise<AssessmentRecord | null> {
    await this.init();
    const res = await db().query<{ record: AssessmentRecord }>(
      `select record from assessments where id = $1`,
      [id]
    );
    return res.rows[0]?.record ?? null;
  }

  async update(id: string, patch: Partial<AssessmentRecord>): Promise<AssessmentRecord> {
    await this.init();
    const current = await this.get(id);
    if (!current) throw new NotFoundError(id);

    const next: AssessmentRecord = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };

    await db().query(
      `update assessments set title = $2, updated_at = $3, record = $4 where id = $1`,
      [id, next.title, next.updatedAt, next]
    );
    return next;
  }

  async list(limit: number): Promise<AssessmentSummary[]> {
    await this.init();
    const res = await db().query<{ record: AssessmentRecord }>(
      `select record from assessments order by created_at desc limit $1`,
      [limit]
    );
    return res.rows.map((r) => summarise(r.record));
  }

  async remove(id: string): Promise<void> {
    await this.init();
    // assessment_pages cascades.
    await db().query(`delete from assessments where id = $1`, [id]);
  }

  async putPage(id: string, kind: PageKind, index: number, image: StoredImage): Promise<void> {
    await this.init();
    await db().query(
      `insert into assessment_pages (assessment_id, kind, page_index, mime, bytes)
       values ($1, $2, $3, $4, $5)
       on conflict (assessment_id, kind, page_index)
       do update set mime = excluded.mime, bytes = excluded.bytes`,
      [id, kind, index, image.mime, image.bytes]
    );
  }

  async getPage(id: string, kind: PageKind, index: number): Promise<StoredImage | null> {
    await this.init();
    const res = await db().query<{ mime: string; bytes: Buffer }>(
      `select mime, bytes from assessment_pages
       where assessment_id = $1 and kind = $2 and page_index = $3`,
      [id, kind, index]
    );
    const row = res.rows[0];
    return row ? { mime: row.mime, bytes: row.bytes } : null;
  }
}
