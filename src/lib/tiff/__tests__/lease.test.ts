/**
 * @jest-environment node
 *
 * Who owns a document while it is being read, and the loop that reads it.
 *
 * THE CLAIM IS ONE STATEMENT OR IT IS NOTHING. Checking whether a document is
 * free and then taking it are two round trips with a race between them, so the
 * check has to live in the UPDATE's own filter — that is what these pin, and
 * what stops the duplicate chunks that two open tabs already made in prod.
 *
 * The drive loop takes its batch, read, renew and clock, so "did it stop at the
 * right moment" is answerable without a PDF, a database or a real clock.
 */

type Update = { patch: Record<string, unknown>; eq: [string, unknown][]; or: string | null };

let updates: Update[] = [];
/** Rows the next conditional update will claim to have matched. */
let claimed: { id: string }[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        const rec: Update = { patch, eq: [], or: null };
        updates.push(rec);
        const chain: Record<string, unknown> = {};
        chain.eq = (col: string, val: unknown) => {
          rec.eq.push([col, val]);
          return chain;
        };
        chain.or = (expr: string) => {
          rec.or = expr;
          return chain;
        };
        chain.select = async () => ({ data: claimed });
        // an update with no .select() is awaited directly
        chain.then = (res: (v: { error: null }) => unknown) =>
          Promise.resolve({ error: null }).then(res);
        return chain;
      },
    }),
  },
}));

import { claimDocument, LEASE_SECONDS, releaseLease, renewLease } from "../lease";
import { driveDocument, hasBudget, DRIVE_BUDGET_MS, type IngestProgress } from "../ingest";

const NOW = new Date("2026-08-11T09:00:00.000Z");

beforeEach(() => {
  updates = [];
  claimed = [{ id: "d-1" }];
});

describe("claiming a document", () => {
  it("takes it when the update matched a row", async () => {
    expect(await claimDocument("d-1", "org-1", NOW)).toBe(true);
  });

  /* Nothing came back means somebody else's claim is still live. A normal
     answer, not an error — the caller renders the row and moves on. */
  it("does not take it when the update matched nothing", async () => {
    claimed = [];
    expect(await claimDocument("d-1", "org-1", NOW)).toBe(false);
  });

  /* THE WHOLE RACE, IN ONE STATEMENT. If the freshness test were a separate
     read, two tabs could both pass it before either wrote. */
  it("puts the freshness test in the update's own filter", async () => {
    await claimDocument("d-1", "org-1", NOW);

    expect(updates).toHaveLength(1);
    expect(updates[0].or).toBe(`lease_until.is.null,lease_until.lt.${NOW.toISOString()}`);
  });

  it("scopes the claim to the org as well as the document", async () => {
    await claimDocument("d-1", "org-1", NOW);
    expect(updates[0].eq).toEqual([
      ["org_id", "org-1"],
      ["id", "d-1"],
    ]);
  });

  /* The lease has to outlive the slowest single batch, or a worker loses its
     own document mid-read and a second one starts the same pages. */
  it("claims for longer than a batch takes", async () => {
    await claimDocument("d-1", "org-1", NOW);
    const until = Date.parse(String(updates[0].patch.lease_until));
    expect(until - NOW.getTime()).toBe(LEASE_SECONDS * 1000);
    expect(LEASE_SECONDS).toBeGreaterThan(30);
  });
});

describe("holding and handing back", () => {
  it("renews without re-testing freshness — the caller already owns it", async () => {
    await renewLease("d-1", "org-1", NOW);
    expect(updates[0].or).toBeNull();
    expect(updates[0].patch.lease_until).toBe(
      new Date(NOW.getTime() + LEASE_SECONDS * 1000).toISOString()
    );
  });

  /* Handed back rather than left to expire: the next caller starts now
     instead of waiting out the clock. */
  it("releases by clearing the lease outright", async () => {
    await releaseLease("d-1", "org-1");
    expect(updates[0].patch).toEqual({ lease_until: null });
  });
});

describe("the budget", () => {
  it("leaves room for the batch already running when the deadline lands", () => {
    // a batch is ~20s and maxDuration is 300s, so the loop must stop well short
    expect(DRIVE_BUDGET_MS).toBeLessThanOrEqual(300_000 - 40_000);
  });

  it("is spent when the elapsed time reaches it", () => {
    expect(hasBudget(0, 1000)).toBe(true);
    expect(hasBudget(999, 1000)).toBe(true);
    expect(hasBudget(1000, 1000)).toBe(false);
    expect(hasBudget(5000, 1000)).toBe(false);
  });
});

describe("driving a document without a browser", () => {
  const progress = (over: Partial<IngestProgress> = {}): IngestProgress => ({
    status: "processing",
    pagesDone: 20,
    pageCount: 100,
    chunkCount: 30,
    ...over,
  });

  it("keeps reading batches until the document is ready", async () => {
    const batch = jest
      .fn<Promise<IngestProgress>, unknown[]>()
      .mockResolvedValueOnce(progress())
      .mockResolvedValueOnce(progress())
      .mockResolvedValueOnce(progress({ status: "ready" }));

    const out = await driveDocument("d-1", "org-1", DRIVE_BUDGET_MS, {
      batch,
      read: async () => progress(),
      renew: async () => {},
      clock: () => 0,
    });

    expect(batch).toHaveBeenCalledTimes(3);
    expect(out.status).toBe("ready");
  });

  it("stops the moment a document fails, rather than hammering it", async () => {
    const batch = jest
      .fn<Promise<IngestProgress>, unknown[]>()
      .mockResolvedValue(progress({ status: "failed", error: "That PDF couldn't be opened." }));

    const out = await driveDocument("d-1", "org-1", DRIVE_BUDGET_MS, {
      batch,
      read: async () => progress(),
      renew: async () => {},
      clock: () => 0,
    });

    expect(batch).toHaveBeenCalledTimes(1);
    expect(out.error).toBe("That PDF couldn't be opened.");
  });

  it("stops on paused, so a spent allowance isn't retried in a loop", async () => {
    const batch = jest
      .fn<Promise<IngestProgress>, unknown[]>()
      .mockResolvedValue(progress({ status: "paused", resetsOn: "2026-09-01" }));

    await driveDocument("d-1", "org-1", DRIVE_BUDGET_MS, {
      batch,
      read: async () => progress(),
      renew: async () => {},
      clock: () => 0,
    });
    expect(batch).toHaveBeenCalledTimes(1);
  });

  /* The invocation has a ceiling and overrunning it kills the batch in flight.
     Whatever is left resumes from the bookmark next time anybody asks. */
  it("stops starting batches once the budget is spent", async () => {
    let t = 0;
    const batch = jest.fn(async () => {
      t += 60_000; // each batch eats a minute
      return progress();
    });

    const out = await driveDocument("d-1", "org-1", 150_000, {
      batch,
      read: async () => progress(),
      renew: async () => {},
      clock: () => t,
    });

    // 0s → batch, 60s → batch, 120s → batch, 180s → over budget, stop
    expect(batch).toHaveBeenCalledTimes(3);
    expect(out.status).toBe("processing");
  });

  /* A long document must not outrun its own claim, and renewing after the
     batch restarts the clock from the work actually being done. */
  it("renews the claim between batches, and not after the last one", async () => {
    const renew = jest.fn(async () => {});
    const batch = jest
      .fn<Promise<IngestProgress>, unknown[]>()
      .mockResolvedValueOnce(progress())
      .mockResolvedValueOnce(progress({ status: "ready" }));

    await driveDocument("d-1", "org-1", DRIVE_BUDGET_MS, {
      batch,
      read: async () => progress(),
      renew,
      clock: () => 0,
    });

    expect(renew).toHaveBeenCalledTimes(1);
  });

  /* The row may have settled between the response going out and this starting
     — another worker, or the batch the route already ran finishing it. */
  it("does no work at all when the row has already settled", async () => {
    const batch = jest.fn();
    const out = await driveDocument("d-1", "org-1", DRIVE_BUDGET_MS, {
      batch: batch as never,
      read: async () => progress({ status: "ready" }),
      renew: async () => {},
      clock: () => 0,
    });

    expect(batch).not.toHaveBeenCalled();
    expect(out.status).toBe("ready");
  });
});
