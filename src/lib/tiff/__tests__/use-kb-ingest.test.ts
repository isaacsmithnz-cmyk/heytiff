import {
  asProgress,
  driveDocument,
  postIngestBatch,
  runIngestQueue,
  type KbIngestProgress,
} from "../use-kb-ingest";

/* The client's ingest loop, without a browser.

   What these pin is the pair of invariants the money rides on: the loop stops
   the moment a document stops being `processing` (a paused document asked
   again would spend the next month's allowance the second it opened), and the
   queue is SEQUENTIAL (two documents in flight each read the allowance before
   either had spent it, so both would overshoot). */

const processing = (pagesDone: number, pageCount: number | null = 220): KbIngestProgress => ({
  status: "processing",
  pagesDone,
  pageCount,
  chunkCount: pagesDone,
});

/** A `post` that answers from a script, and records the order it was asked. */
function scripted(script: Record<string, KbIngestProgress[]>, log: string[] = []) {
  const left = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]));
  return {
    log,
    post: async (documentId: string) => {
      log.push(documentId);
      const next = left[documentId]?.shift();
      if (!next) throw new Error(`no script left for ${documentId}`);
      return next;
    },
  };
}

describe("driveDocument", () => {
  it("keeps asking until the document is ready", async () => {
    const seen: KbIngestProgress[] = [];
    const { post, log } = scripted({
      "d-1": [processing(20), processing(40), { status: "ready", pagesDone: 55, pageCount: 55, chunkCount: 90 }],
    });

    const last = await driveDocument("d-1", { post, onProgress: (_id, p) => seen.push(p) });

    expect(log).toHaveLength(3);
    expect(seen.map((p) => p.pagesDone)).toEqual([20, 40, 55]);
    expect(last?.status).toBe("ready");
  });

  it("stops the moment a document parks at the quota — and does not ask again", async () => {
    const { post, log } = scripted({
      "d-1": [processing(20), { status: "paused", pagesDone: 40, pageCount: 220, resetsOn: "2026-09-01" }],
    });

    const settled: KbIngestProgress[] = [];
    const last = await driveDocument("d-1", { post, onSettled: (_id, p) => settled.push(p) });

    expect(log).toEqual(["d-1", "d-1"]);
    expect(last).toMatchObject({ status: "paused", resetsOn: "2026-09-01" });
    expect(settled).toHaveLength(1);
  });

  it("stops on a failure and carries the reason out", async () => {
    const { post, log } = scripted({
      "d-1": [processing(20), { status: "failed", pagesDone: 20, pageCount: 220, error: "That PDF couldn't be opened." }],
    });

    const last = await driveDocument("d-1", { post });

    expect(log).toHaveLength(2);
    expect(last).toMatchObject({ status: "failed", error: "That PDF couldn't be opened." });
  });

  it("turns a thrown request into a failed row rather than an unhandled loop", async () => {
    const post = jest.fn(async () => {
      throw new Error("network");
    });

    const last = await driveDocument("d-1", { post });

    expect(post).toHaveBeenCalledTimes(1);
    expect(last?.status).toBe("failed");
    expect(last?.error).toBe("Couldn't reach the server.");
  });

  it("stops between batches once the caller has gone away", async () => {
    let gone = false;
    const { post, log } = scripted({ "d-1": [processing(20), processing(40), processing(60)] });

    const last = await driveDocument("d-1", {
      post: async (id) => {
        const p = await post(id);
        gone = true; // the page unmounts while the first batch is in flight
        return p;
      },
      stopped: () => gone,
    });

    // the batch already sent still counted — it is a bookmark, not a rollback
    expect(log).toEqual(["d-1"]);
    expect(last).toMatchObject({ status: "processing", pagesDone: 20 });
  });

  it("refuses to loop forever on a server that never finishes", async () => {
    const post = jest.fn(async () => processing(20));

    await driveDocument("d-1", { post, maxBatches: 5 });

    expect(post).toHaveBeenCalledTimes(5);
  });
});

describe("runIngestQueue", () => {
  it("finishes one document before starting the next", async () => {
    const log: string[] = [];
    const { post } = scripted(
      {
        "d-1": [processing(20), { status: "ready", pagesDone: 30, pageCount: 30 }],
        "d-2": [{ status: "ready", pagesDone: 10, pageCount: 10 }],
        "d-3": [processing(20), { status: "paused", pagesDone: 40, pageCount: 500 }],
      },
      log
    );

    await runIngestQueue(["d-1", "d-2", "d-3"], { post });

    // never interleaved: two batches at once double-spend the page allowance
    expect(log).toEqual(["d-1", "d-1", "d-2", "d-3", "d-3"]);
  });

  it("carries on to the next document after one fails", async () => {
    const log: string[] = [];
    const { post } = scripted(
      {
        "d-1": [{ status: "failed", pagesDone: 0, pageCount: null, error: "That file couldn't be read." }],
        "d-2": [{ status: "ready", pagesDone: 12, pageCount: 12 }],
      },
      log
    );

    const settled: string[] = [];
    await runIngestQueue(["d-1", "d-2"], { post, onSettled: (id, p) => settled.push(`${id}:${p.status}`) });

    expect(log).toEqual(["d-1", "d-2"]);
    expect(settled).toEqual(["d-1:failed", "d-2:ready"]);
  });

  it("abandons the rest of the queue once stopped", async () => {
    const log: string[] = [];
    const { post } = scripted(
      {
        "d-1": [{ status: "ready", pagesDone: 5, pageCount: 5 }],
        "d-2": [{ status: "ready", pagesDone: 5, pageCount: 5 }],
      },
      log
    );

    let done = 0;
    await runIngestQueue(["d-1", "d-2"], {
      post,
      onSettled: () => {
        done += 1;
      },
      stopped: () => done >= 1,
    });

    expect(log).toEqual(["d-1"]);
  });
});

describe("postIngestBatch", () => {
  const fetchMock = jest.fn();
  const original = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = original;
  });

  const ok = (body: unknown) => ({ ok: true, json: async () => body });

  it("posts the document id and reads the progress back", async () => {
    fetchMock.mockResolvedValue(ok({ status: "processing", pagesDone: 20, pageCount: 220, chunkCount: 31 }));

    const p = await postIngestBatch("d-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tiff/ingest",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ documentId: "d-1" }) })
    );
    expect(p).toMatchObject({ status: "processing", pagesDone: 20, pageCount: 220 });
  });

  it("drives a whole multi-batch run off the wire", async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ status: "processing", pagesDone: 20, pageCount: 45 }))
      .mockResolvedValueOnce(ok({ status: "processing", pagesDone: 40, pageCount: 45 }))
      .mockResolvedValueOnce(ok({ status: "ready", pagesDone: 45, pageCount: 45, chunkCount: 70 }));

    const last = await driveDocument("d-1", { post: (id) => postIngestBatch(id) });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(last).toMatchObject({ status: "ready", pagesDone: 45 });
  });

  it("turns a refusal into a failed progress carrying the server's sentence", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "You don't have access to manage the library." }),
    });

    const p = await postIngestBatch("d-1");

    expect(p.status).toBe("failed");
    expect(p.error).toBe("You don't have access to manage the library.");
  });

  it("survives a body that isn't JSON at all", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error("not json");
      },
    });

    expect(await postIngestBatch("d-1")).toMatchObject({
      status: "failed",
      error: "That document couldn't be processed.",
    });
  });

  it("reports an unreachable server rather than throwing into the loop", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    expect(await postIngestBatch("d-1")).toMatchObject({
      status: "failed",
      error: "Couldn't reach the server.",
    });
  });

  it("rethrows when the abort was ours, so the loop can tell the difference", async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValue(new Error("aborted"));

    await expect(postIngestBatch("d-1", controller.signal)).rejects.toThrow("aborted");
  });
});

describe("asProgress", () => {
  it("treats an unknown status as a failure rather than a fifth state", () => {
    expect(asProgress({ status: "weird", pagesDone: 3 }).status).toBe("failed");
    expect(asProgress(null).status).toBe("failed");
  });

  it("keeps an unopened document's page count null, not zero", () => {
    // "0 of 0 pages" would read as an empty document rather than an unread one
    expect(asProgress({ status: "processing", pagesDone: 0, pageCount: null }).pageCount).toBeNull();
  });

  it("carries resetsOn and error only when they were sent", () => {
    expect(asProgress({ status: "ready", pagesDone: 9, pageCount: 9 })).not.toHaveProperty("error");
    expect(asProgress({ status: "paused", pagesDone: 9, pageCount: 90, resetsOn: "2026-09-01" }).resetsOn).toBe(
      "2026-09-01"
    );
  });
});
