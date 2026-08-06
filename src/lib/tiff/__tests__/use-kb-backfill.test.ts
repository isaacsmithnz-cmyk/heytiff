/* The client's backfill loop, without a browser.

   What these pin is that the loop STOPS: on a reason the server gave, on
   nothing left to do, and on a batch that filled nothing in — the last one
   being the difference between a backlog and a bug, and the only thing between
   a 3 RPM account and four hundred pointless requests. */

import {
  asBackfillResult,
  postBackfillBatch,
  runBackfill,
  type BackfillDeps,
} from "../use-kb-backfill";

/** A `post` that answers from a script, and records how often it was asked. */
function scripted(script: Awaited<ReturnType<BackfillDeps["post"]>>[]) {
  const left = [...script];
  const log: number[] = [];
  return {
    log,
    post: async () => {
      log.push(log.length + 1);
      const next = left.shift();
      if (!next) throw new Error("the loop asked more times than the script allows");
      return next;
    },
  };
}

describe("runBackfill", () => {
  it("keeps asking until nothing is left", async () => {
    const { post, log } = scripted([
      { done: 64, remaining: 42 },
      { done: 42, remaining: 0 },
    ]);

    const result = await runBackfill({ post });

    expect(log).toHaveLength(2);
    expect(result).toEqual({ done: 106, remaining: 0 });
  });

  it("carries the running total out, batch by batch", async () => {
    const seen: number[] = [];
    const { post } = scripted([
      { done: 64, remaining: 42 },
      { done: 42, remaining: 0 },
    ]);

    await runBackfill({ post, onProgress: (r) => seen.push(r.done) });

    // the screen says "64 of 106", then "106 of 106"
    expect(seen).toEqual([64, 106]);
  });

  /* A capped account answers 429 to everything in the minute. Asking again is
     the behaviour that made this bug expensive in the first place. */
  it("stops the moment a batch says it was rate-limited", async () => {
    const { post, log } = scripted([
      { done: 64, remaining: 42 },
      { done: 0, remaining: 42, stopped: "rate-limited" },
    ]);

    const result = await runBackfill({ post });

    expect(log).toHaveLength(2);
    expect(result).toEqual({ done: 64, remaining: 42, stopped: "rate-limited" });
  });

  it("stops on a server that says there is work and then does none of it", async () => {
    const { post, log } = scripted([{ done: 0, remaining: 42 }]);

    expect(await runBackfill({ post })).toEqual({ done: 0, remaining: 42, stopped: "failed" });
    expect(log).toHaveLength(1);
  });

  it("turns a thrown request into a stopped run rather than an unhandled loop", async () => {
    const post = jest.fn(async () => {
      throw new Error("network");
    });

    expect(await runBackfill({ post })).toEqual({ done: 0, remaining: 0, stopped: "failed" });
    expect(post).toHaveBeenCalledTimes(1);
  });

  /* Aborting on unmount stops US asking; the batch in flight finishes on the
     server and keeps whatever vectors it wrote. */
  it("stops between batches once the caller has gone away", async () => {
    let gone = false;
    const { post, log } = scripted([
      { done: 64, remaining: 42 },
      { done: 42, remaining: 0 },
    ]);

    const result = await runBackfill({
      post: async () => {
        const r = await post();
        gone = true;
        return r;
      },
      stopped: () => gone,
    });

    expect(log).toHaveLength(1);
    expect(result).toEqual({ done: 64, remaining: 42 });
  });

  it("refuses to loop forever on a server that never finishes", async () => {
    const post = jest.fn(async () => ({ done: 1, remaining: 999 }));

    await runBackfill({ post, maxBatches: 5 });

    expect(post).toHaveBeenCalledTimes(5);
  });
});

describe("postBackfillBatch", () => {
  const fetchMock = jest.fn();
  const original = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = original;
  });

  it("posts to the route and reads the result back", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ done: 64, remaining: 42 }) });

    const result = await postBackfillBatch();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tiff/embed-backfill",
      expect.objectContaining({ method: "POST" })
    );
    expect(result).toEqual({ done: 64, remaining: 42 });
  });

  it("turns a refusal into a stopped result rather than a throw", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "no access" }) });
    expect(await postBackfillBatch()).toEqual({ done: 0, remaining: 0, stopped: "failed" });
  });

  it("reports an unreachable server rather than throwing into the loop", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await postBackfillBatch()).toEqual({ done: 0, remaining: 0, stopped: "failed" });
  });

  it("rethrows when the abort was ours, so the loop can tell the difference", async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValue(new Error("aborted"));

    await expect(postBackfillBatch(controller.signal)).rejects.toThrow("aborted");
  });
});

describe("asBackfillResult", () => {
  it("trusts the answer only for the shape it promised", () => {
    expect(asBackfillResult({ done: "64", remaining: 42 })).toEqual({ done: 64, remaining: 42 });
    expect(asBackfillResult(null)).toEqual({ done: 0, remaining: 0 });
    expect(asBackfillResult({ done: -3, remaining: "nope" })).toEqual({ done: 0, remaining: 0 });
  });

  it("keeps a stop only when it is one of ours", () => {
    expect(asBackfillResult({ done: 0, remaining: 9, stopped: "rate-limited" }).stopped).toBe(
      "rate-limited"
    );
    expect(asBackfillResult({ done: 0, remaining: 9, stopped: "whatever" })).not.toHaveProperty(
      "stopped"
    );
  });
});
