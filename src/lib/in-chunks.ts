/* A READ TOO WIDE FOR ONE ASK, IN PIECES, THE PIECES AT ONCE.

   Supabase caps a URL's length, and `.in()` rides in the query string, so a
   list of ids that could be thousands wide is asked about in chunks. The
   chunks used to go one after another: the Jobs list's bookings were eleven
   round trips to Singapore in a row, its whole read two to three seconds
   (Isaac, 25 October 2026: "it takes a little while to load"). They go
   together now, at most `at` out at once so a very wide read never opens a
   hundred connections, and come back in the order they were asked, so a
   read ordered within each chunk stays ordered for every id in it. */
export async function inChunks<T>(
  values: readonly string[],
  size: number,
  run: (chunk: string[]) => Promise<T[]>,
  at = 6,
): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  const got: T[][] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      got[i] = await run(chunks[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(at, chunks.length) }, worker));
  return got.flat();
}
