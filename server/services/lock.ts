/**
 * A per-assessment mutex, scoped to this process.
 *
 * Two things call advance() at once in practice: React's development double-
 * effect, and a teacher with the same run open in two tabs. Without a guard
 * both would read the same cursor, process the same batch, and append the
 * results twice.
 *
 * This handles the same-instance case exactly. The cross-instance case is
 * covered by the lease in job.ts, which narrows the window from the length of a
 * model call to the length of a single write.
 */

const chains = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();

  // Queue behind whatever holds the key, and swallow its failure — one caller's
  // error must not reject the next caller's turn.
  const run = previous.then(work, work);

  // Held by identity so the cleanup below can tell "the queue drained" from
  // "someone queued behind me". Comparing against undefined instead, as this
  // once did, is never true for a key we just wrote, so nothing was ever
  // released and the map grew by one entry per assessment for the life of the
  // process.
  const settled = run.catch(() => undefined);
  chains.set(key, settled);

  void settled.finally(() => {
    if (chains.get(key) === settled) chains.delete(key);
  });

  return run;
}
