import { inChunks } from "../in-chunks";

/* The Jobs list's reads went chunk after chunk, eleven round trips in a row
   (Isaac, 25 October 2026). They go together now, a few at a time, in order. */

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

it("asks about every id once, in chunks of the size given, and answers in the order asked", async () => {
  const seen: string[][] = [];
  const got = await inChunks(ids(25), 10, async (chunk) => {
    seen.push(chunk);
    /* a later chunk can come back first */
    await new Promise((r) => setTimeout(r, chunk[0] === "id-0" ? 20 : 0));
    return chunk.map((c) => c.toUpperCase());
  });
  expect(seen.map((c) => c.length).sort()).toEqual([10, 10, 5]);
  expect(got).toEqual(ids(25).map((c) => c.toUpperCase()));
});

it("has the chunks out together, never more than it allows at once", async () => {
  let out = 0;
  let most = 0;
  await inChunks(
    ids(100),
    10,
    async (chunk) => {
      out += 1;
      most = Math.max(most, out);
      await new Promise((r) => setTimeout(r, 5));
      out -= 1;
      return chunk;
    },
    4,
  );
  expect(most).toBe(4);
});

it("asks nothing for nothing", async () => {
  const run = jest.fn(async () => []);
  expect(await inChunks([], 10, run)).toEqual([]);
  expect(run).not.toHaveBeenCalled();
});

it("by default has several out at once, never one after another", async () => {
  let out = 0;
  let most = 0;
  await inChunks(ids(120), 10, async (chunk) => {
    out += 1;
    most = Math.max(most, out);
    await new Promise((r) => setTimeout(r, 5));
    out -= 1;
    return chunk;
  });
  expect(most).toBe(6);
});
