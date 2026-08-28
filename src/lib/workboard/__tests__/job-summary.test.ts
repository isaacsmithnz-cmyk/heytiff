/* "Where it's up to" — the writer, and the rules that keep it honest.

   The two laws worth their tests: the model is handed ONLY derived figures
   and the story's own lines (never raw columns to do arithmetic on), and a
   stored summary whose stamp still matches the story costs NO model call —
   that comparison is the entire cost model. */

import type Anthropic from "@anthropic-ai/sdk";

/* refreshJobSummary reads the mirror and the summary table; every door is
   mocked so the test drives the decision, not the queries. */
const maybeSingle = jest.fn();
const upsert = jest.fn(async () => ({ error: null }));
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "job_summaries") {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ maybeSingle } ) }),
          }),
          upsert,
        };
      }
      /* job_picklist_items — a thenable chain with no rows */
      const chain = {
        select: () => chain,
        eq: () => chain,
        then: (res: (v: { data: unknown[] }) => void) => res({ data: [] }),
      };
      return chain;
    },
  },
}));

const resolveJobCard = jest.fn(async () => ({ parentRemoteId: "j-1", focusRemoteId: null }));
const readMirrorJobDetail = jest.fn();
const readJobNotes = jest.fn(async () => []);
const readJobLedger = jest.fn(async () => ({ materials: [], payments: [] }));
const readJobFamily = jest.fn(async () => null);
const familyMediaSources = jest.fn(async () => []);
jest.mock("../all-jobs-query", () => ({
  resolveJobCard: (...a: unknown[]) => resolveJobCard(...(a as [])),
  readMirrorJobDetail: (...a: unknown[]) => readMirrorJobDetail(...(a as [])),
  readJobNotes: (...a: unknown[]) => readJobNotes(...(a as [])),
  readJobLedger: (...a: unknown[]) => readJobLedger(...(a as [])),
  readJobFamily: (...a: unknown[]) => readJobFamily(...(a as [])),
  familyMediaSources: (...a: unknown[]) => familyMediaSources(...(a as [])),
}));
jest.mock("../job-media-query", () => ({
  readJobMedia: async () => ({ items: [], truncated: false }),
}));
jest.mock("../query", () => ({ getSm8Timezone: async () => "Australia/Sydney" }));

import {
  moneyFactsFor,
  refreshJobSummary,
  runSummaryWrite,
  summaryPrompt,
  type JobStoryServerRead,
} from "../job-summary";
import { buildJobStory, storyStamp } from "../job-story";
import { deriveFamilyMoney } from "../job-family";

const family = () =>
  deriveFamilyMoney({
    members: [
      {
        remoteId: "j-2380",
        jobNumber: "2380",
        totalCents: 626806,
        paidCents: 626806,
        lastPaidOn: "2026-08-22",
        lines: null,
        raisedOn: "2026-08-21",
      },
      {
        remoteId: "j-2380a",
        jobNumber: "2380A",
        totalCents: null,
        paidCents: 940211,
        lastPaidOn: "2026-04-02",
        lines: { cents: 854737, taxInclusive: false },
        raisedOn: "2026-03-27",
      },
      {
        remoteId: "j-2380b",
        jobNumber: "2380B",
        totalCents: null,
        paidCents: 1567018,
        lastPaidOn: "2026-04-10",
        lines: { cents: 1424562, taxInclusive: false },
        raisedOn: "2026-04-02",
      },
    ],
    today: "2026-08-26",
    termsDays: null,
  });

const serverRead = (over: Partial<JobStoryServerRead> = {}): JobStoryServerRead => {
  const entries = buildJobStory({
    detail: {
      date: "2026-01-12",
      quoteDate: null,
      workOrderDate: null,
      completionDate: "2026-08-21",
      visits: [{ day: "2026-08-13", minutes: 260, crew: ["David Hann"] }],
      checklist: [],
      designs: [],
    },
    notes: [
      {
        remoteId: "n-1",
        text: "Please make double detection",
        writtenOn: "2026-08-21",
        writtenAt: "2026-08-21 16:02:00",
        writtenBy: "Michael Diamond",
        actionRequired: false,
        fromClaim: null,
      },
    ],
    ledger: null,
    family: family(),
    invoicedOn: null,
    media: [],
    picklist: [],
    timezone: null,
  });
  return {
    cardId: "j-1",
    entries,
    stamp: storyStamp(entries),
    scope: "Supply and install a new 14kW system",
    workDone: null,
    status: "Completed",
    clientName: "Susie Peterson",
    family: family(),
    money: null,
    ledgerPaidCents: 0,
    ...over,
  };
};

describe("moneyFactsFor — the only figures the model may repeat", () => {
  it("spells the family's value, claims and settlement off the derivation", () => {
    const facts = moneyFactsFor({ family: family(), money: null, ledgerPaidCents: 0 });
    expect(facts).toContain("Job value $31,340.35 inc GST");
    expect(facts).toContain("Paid in full");
    expect(facts.some((f) => f.startsWith("Payment 1 — Deposit"))).toBe(true);
    expect(facts.some((f) => f.includes("$6,268.06"))).toBe(true);
  });

  it("gives a plain job its value and collection state", () => {
    const facts = moneyFactsFor({
      family: null,
      money: {
        valueCents: 279400,
        invoiced: null,
        invoicedOn: null,
        quoteSent: null,
        quoteSentOn: null,
        paid: false,
        paidOn: null,
      },
      ledgerPaidCents: 100000,
    });
    /* fmtAud drops the cents on whole dollars — the house style */
    expect(facts).toContain("Job value $2,794 inc GST");
    expect(facts).toContain("$1,000 paid so far");
  });

  it("says nothing at all when no money was on the table", () => {
    expect(moneyFactsFor({ family: null, money: null, ledgerPaidCents: 0 })).toEqual([]);
  });
});

describe("summaryPrompt", () => {
  it("carries the scope, the story's own lines and the derived figures — nothing else", () => {
    const read = serverRead();
    const prompt = summaryPrompt(read, moneyFactsFor(read));
    expect(prompt).toContain("Supply and install a new 14kW system");
    expect(prompt).toContain('note by Michael Diamond: "Please make double detection"');
    expect(prompt).toContain("site visit, 4h 20m (David Hann)");
    expect(prompt).toContain("Job value $31,340.35 inc GST");
    expect(prompt).toContain("Job completed");
  });
});

/* A fake client whose one job is to hand back what the "model" said. */
const clientSaying = (payload: unknown, stop = "end_turn") =>
  ({
    messages: {
      create: jest.fn(async () => ({
        stop_reason: stop,
        content: [{ type: "text", text: JSON.stringify(payload) }],
      })),
    },
  }) as unknown as Anthropic;

describe("runSummaryWrite", () => {
  it("returns both fields when the record had money facts", async () => {
    const res = await runSummaryWrite(
      serverRead(),
      clientSaying({ work: "Installed and handed over.", money: "Paid in full across three claims." })
    );
    expect(res).toEqual({
      ok: true,
      work: "Installed and handed over.",
      money: "Paid in full across three claims.",
    });
  });

  /* The model is TOLD not to write a money sentence without facts, but an
     instruction is not an enforced check — a sentence with no facts behind
     it is dropped at this door. */
  it("drops a money sentence the facts can't back", async () => {
    const res = await runSummaryWrite(
      serverRead({ family: null }),
      clientSaying({ work: "Quoted and waiting.", money: "About $99,999 collected." })
    );
    expect(res).toEqual({ ok: true, work: "Quoted and waiting.", money: null });
  });

  it("treats an empty work field as a failure, not a blank paragraph", async () => {
    const res = await runSummaryWrite(serverRead(), clientSaying({ work: "  ", money: null }));
    expect(res).toEqual({ ok: false, reason: "The writer returned nothing." });
  });

  it("treats a refusal as a content outcome", async () => {
    const res = await runSummaryWrite(
      serverRead(),
      clientSaying({ work: "x", money: null }, "refusal")
    );
    expect(res).toEqual({ ok: false, reason: "The writer declined this job." });
  });
});

describe("refreshJobSummary — the cost guard", () => {
  const detailFor = (read: JobStoryServerRead) => ({
    remoteId: "j-1",
    jobNumber: "2380",
    status: read.status,
    clientName: read.clientName,
    description: read.scope,
    workDone: null,
    address: null,
    suburb: null,
    geoLine: null,
    categoryName: null,
    categoryColour: null,
    purchaseOrder: null,
    date: "2026-01-12",
    quoteDate: null,
    workOrderDate: null,
    completionDate: "2026-08-21",
    nextBooking: null,
    timeOnSite: null,
    dateOn: "2026-08-21",
    dateLabel: "completed",
    visits: [{ day: "2026-08-13", minutes: 260, crew: ["David Hann"] }],
    queue: null,
    checklist: [],
    contacts: [],
    money: null,
    designs: [],
    timezone: "Australia/Sydney",
  });

  beforeEach(() => {
    maybeSingle.mockReset();
    upsert.mockClear();
    readJobNotes.mockResolvedValue([
      {
        remoteId: "n-1",
        text: "Please make double detection",
        writtenOn: "2026-08-21",
        writtenAt: "2026-08-21 16:02:00",
        writtenBy: "Michael Diamond",
        actionRequired: false,
        fromClaim: null,
      },
    ] as never);
    readJobFamily.mockResolvedValue(family() as never);
    readMirrorJobDetail.mockResolvedValue(detailFor(serverRead()) as never);
  });

  it("returns the stored summary without a model call when the stamp holds", async () => {
    const read = serverRead();
    maybeSingle.mockResolvedValue({
      data: {
        work_summary: "Stored words.",
        money_summary: "Stored money.",
        story_stamp: read.stamp,
        event_on: "2026-08-22",
        event_label: "the final payment",
      },
    });
    const client = clientSaying({ work: "should never be asked" });
    const res = await refreshJobSummary("org-1", "j-1", client);

    expect(res).toEqual({
      ok: true,
      wrote: false,
      summary: {
        work: "Stored words.",
        money: "Stored money.",
        stamp: read.stamp,
        eventOn: "2026-08-22",
        eventLabel: "the final payment",
      },
    });
    expect((client as unknown as { messages: { create: jest.Mock } }).messages.create).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("writes, stores and stamps when the story has moved", async () => {
    maybeSingle.mockResolvedValue({ data: null });
    const client = clientSaying({ work: "Fresh words.", money: "Paid in full." });
    const res = await refreshJobSummary("org-1", "j-1", client);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.wrote).toBe(true);
    expect(res.summary).toMatchObject({
      work: "Fresh words.",
      money: "Paid in full.",
      /* the newest event here is the claim settling on 22 Aug */
      eventOn: "2026-08-22",
      eventLabel: "the final payment",
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    const rowWritten = (upsert.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(rowWritten.job_uuid).toBe("j-1");
    expect(rowWritten.work_summary).toBe("Fresh words.");
  });
});
