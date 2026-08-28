import { FsRepository } from "./fs-driver";
import { PgRepository } from "./pg-driver";
import type { Repository } from "./types";

/**
 * Driver selection, decided once per process.
 *
 * Set DATABASE_URL and history is durable; leave it unset and the app still
 * works end to end against the filesystem. That fallback is not a toy — it is
 * what lets the project be cloned and run without provisioning anything, and
 * it is the same code path the Postgres driver has to satisfy.
 */

let instance: Repository | null = null;

export function repo(): Repository {
  if (!instance) {
    instance = process.env.DATABASE_URL ? new PgRepository() : new FsRepository();
  }
  return instance;
}

export { NotFoundError, BadRequestError } from "./types";
export type { Repository, StoredImage } from "./types";
