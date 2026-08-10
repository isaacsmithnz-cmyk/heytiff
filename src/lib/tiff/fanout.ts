/* Several calls in flight, answered in the order they were asked.

   INGESTION IS ALL WAITING. Reading a batch of pages is milliseconds of work
   wrapped around minutes of somebody else's API, and the calls in a batch never
   look at each other's answers — so doing them one after another spent the SUM
   of the waits when the LONGEST was available for the same money.

   ORDER IS THE CONTRACT, NOT THE SCHEDULE. Every list this fans out over is
   positional: keyword row i belongs to chunk i, page text i belongs to page i.
   So a result is seated at the index it was asked for rather than pushed as it
   lands, and the answer is identical whatever order the network chose. That is
   the property worth testing, and it is why this is a module rather than four
   lines of `Promise.all` inlined at each call site.

   BOUNDED, because the ceiling is never our patience — it is a shared account's
   rate limit, and the batch that trips it loses everything in flight. The cap
   is the caller's to pick; nothing here fans out unboundedly. */

/** Run `task` over every item, at most `limit` at a time, and return the
    results in the ITEMS' order. Never reorders, never drops. A task that
    rejects rejects the whole call, so callers whose failures are values —
    which is most of ingestion — should return them rather than throw. */
export async function mapCapped<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  if (items.length === 0) return out;

  /* A shared cursor rather than a chunked `Promise.all` per wave: with waves,
     one slow call holds the whole wave's slots idle until it lands. Here a
     worker that finishes takes the next item immediately, so `limit` calls are
     in flight for as much of the run as there is work left. */
  let next = 0;
  const worker = async () => {
    for (let at = next++; at < items.length; at = next++) {
      out[at] = await task(items[at], at);
    }
  };

  const workers = Math.max(1, Math.min(Math.trunc(limit) || 1, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return out;
}
