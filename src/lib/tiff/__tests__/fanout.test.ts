/**
 * @jest-environment node
 *
 * The bounded fan-out ingestion runs its API calls through.
 *
 * TWO PROPERTIES, AND THEY ARE THE WHOLE MODULE. Results come back in the
 * ITEMS' order however the network answered — a keyword row on the wrong chunk
 * sends a search to the wrong page — and no more than `limit` calls are ever in
 * flight, because the account's rate limit is what the cap exists to respect.
 *
 * Both are tested with hand-resolved promises rather than timers: "did this
 * overlap" is a question about scheduling, and a test that answers it by
 * sleeping answers it slowly and flakily instead.
 */

import { mapCapped } from "../fanout";

/** A task whose every call is resolved by the test, by hand. */
function deferredTask<T>() {
  const resolvers: Array<(value: string) => void> = [];
  let live = 0;
  let peak = 0;

  const task = (_item: T) =>
    new Promise<string>((resolve) => {
      live += 1;
      peak = Math.max(peak, live);
      resolvers.push((value) => {
        live -= 1;
        resolve(value);
      });
    });

  return {
    task,
    /** Calls started but not yet answered. */
    started: () => resolvers.length,
    peak: () => peak,
    answer: (at: number, value: string) => resolvers[at](value),
    /** Let every microtask queued by the resolutions above run. */
    settle: () => new Promise<void>((r) => setImmediate(r)),
  };
}

describe("order", () => {
  it("returns results in the items' order, not the order they finished", async () => {
    const d = deferredTask<number>();
    const run = mapCapped([0, 1, 2], 3, d.task);
    await d.settle();

    // answered backwards on purpose
    d.answer(2, "third");
    d.answer(0, "first");
    d.answer(1, "second");

    expect(await run).toEqual(["first", "second", "third"]);
  });

  it("hands the task each item with its own index", async () => {
    const seen: Array<[string, number]> = [];
    await mapCapped(["a", "b", "c"], 2, async (item, index) => {
      seen.push([item, index]);
      return item;
    });
    expect(seen.sort((x, y) => x[1] - y[1])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });

  it("answers an empty list without running anything", async () => {
    const task = jest.fn();
    expect(await mapCapped([], 4, task)).toEqual([]);
    expect(task).not.toHaveBeenCalled();
  });
});

describe("the cap", () => {
  it("never has more than `limit` in flight", async () => {
    const d = deferredTask<number>();
    const items = [0, 1, 2, 3, 4, 5];
    const run = mapCapped(items, 2, d.task);
    await d.settle();

    expect(d.started()).toBe(2);

    // a worker that finishes picks up the next item straight away, rather
    // than the whole wave waiting on its slowest member
    d.answer(0, "a");
    await d.settle();
    expect(d.started()).toBe(3);

    for (let i = 1; i < items.length; i++) {
      d.answer(i, String(i));
      await d.settle();
    }

    expect(await run).toHaveLength(items.length);
    expect(d.peak()).toBe(2);
  });

  it("never runs more workers than there are items", async () => {
    const d = deferredTask<number>();
    const run = mapCapped([0, 1], 10, d.task);
    await d.settle();

    expect(d.started()).toBe(2);
    d.answer(0, "a");
    d.answer(1, "b");
    expect(await run).toEqual(["a", "b"]);
  });

  /* A cap of zero is a caller's bug, and the honest reading of it is "one at a
     time" — never "nothing runs", which would hang ingestion on a typo. */
  it("treats a nonsense limit as one at a time", async () => {
    for (const limit of [0, -3, Number.NaN]) {
      const d = deferredTask<number>();
      const run = mapCapped([0, 1, 2], limit, d.task);
      await d.settle();
      expect(d.started()).toBe(1);

      for (let i = 0; i < 3; i++) {
        d.answer(i, String(i));
        await d.settle();
      }
      expect(await run).toEqual(["0", "1", "2"]);
    }
  });
});

describe("failure", () => {
  /* Ingestion's own failures are VALUES — `{ ok: false }` — so this path is
     about a genuine throw, and the only promise it may leave behind is one
     already in flight. It must not swallow it into a hung call. */
  it("rejects when a task throws", async () => {
    await expect(
      mapCapped([0, 1, 2], 2, async (item) => {
        if (item === 1) throw new Error("nope");
        return item;
      })
    ).rejects.toThrow("nope");
  });
});
