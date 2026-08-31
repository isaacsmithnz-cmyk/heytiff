/* "Where it's up to" — the writer, and the rules that keep it honest.

   The two laws worth their tests: the writer's prompt carries NO MONEY —
   the money-shaped story entries are excluded before serialisation, so
   nothing gated can leak into the ungated fields even by prose — and a
   stored summary whose stamp still matches the story costs NO model call:
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
      /* job_picklist_items and workboard_notes — a thenable chain with no
         rows, tolerant of order/limit so a reader that grew a clause here
         doesn't take the suite down. */
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
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
  readJobMediaGroups: async () => ({ photos: [], documents: [], elsewhere: [], truncated: false }),
}));
jest.mock("../query", () => ({ getSm8Timezone: async () => "Australia/Sydney" }));

import {
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
      visits: [{ day: "2026-08-13", minutes: 260, crew: [{ name: "David Hann", title: null }] }],
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
    ourNotes: [],
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
    ...over,
  };
};

describe("summaryPrompt — the writer never sees money", () => {
  it("carries the scope and the story's own lines, with every money entry excluded", () => {
    const read = serverRead();
    /* the fixture's story HAS money in it — three claims raised and
       settled — which is exactly what must not reach the writer */
    expect(read.entries.some((e) => e.kind === "claim")).toBe(true);

    const prompt = summaryPrompt(read);
    expect(prompt).toContain("Supply and install a new 14kW system");
    expect(prompt).toContain('note by Michael Diamond: "Please make double detection"');
    expect(prompt).toContain("site visit, 4h 20m (David Hann)");
    expect(prompt).toContain("Job completed");
    /* no claim lines, no payment lines, no dollars at all */
    expect(prompt).not.toContain("Payment 1 — Deposit");
    expect(prompt).not.toContain("settled");
    expect(prompt).not.toContain("$");
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
  it("returns the structured shape", async () => {
    const res = await runSummaryWrite(
      serverRead(),
      clientSaying({
        lead: "Installed and handed over.",
        points: ["Seven visits across the install", "One open note from Michael"],
      })
    );
    expect(res).toEqual({
      ok: true,
      lead: "Installed and handed over.",
      points: ["Seven visits across the install", "One open note from Michael"],
    });
  });

  it("keeps only real lines in points, and no more than five", async () => {
    const res = await runSummaryWrite(
      serverRead(),
      clientSaying({
        lead: "Mid-install.",
        points: ["one", "  ", 3, "two", "three", "four", "five", "six"],
      })
    );
    expect(res).toEqual({
      ok: true,
      lead: "Mid-install.",
      points: ["one", "two", "three", "four", "five"],
    });
  });

  it("treats an empty lead as a failure, not a blank block", async () => {
    const res = await runSummaryWrite(serverRead(), clientSaying({ lead: "  ", points: [] }));
    expect(res).toEqual({ ok: false, reason: "The writer returned nothing." });
  });

  it("treats a refusal as a content outcome", async () => {
    const res = await runSummaryWrite(
      serverRead(),
      clientSaying({ lead: "x", points: [] }, "refusal")
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
    visits: [{ day: "2026-08-13", minutes: 260, crew: [{ name: "David Hann", title: null }] }],
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
        work_points: ["Stored point"],
        story_stamp: read.stamp,
        event_on: "2026-08-22",
        event_label: "the final payment",
      },
    });
    const client = clientSaying({ lead: "should never be asked", points: [] });
    const res = await refreshJobSummary("org-1", "j-1", client);

    expect(res).toEqual({
      ok: true,
      wrote: false,
      summary: {
        lead: "Stored words.",
        points: ["Stored point"],
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
    const client = clientSaying({ lead: "Fresh words.", points: ["A point about the work"] });
    const res = await refreshJobSummary("org-1", "j-1", client);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.wrote).toBe(true);
    expect(res.summary).toMatchObject({
      lead: "Fresh words.",
      points: ["A point about the work"],
      /* the stamp still rides the money event — the claim settling on 22
         Aug moved the story even though the writer never read it */
      eventOn: "2026-08-22",
      eventLabel: "the final payment",
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    const rowWritten = (upsert.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(rowWritten.job_uuid).toBe("j-1");
    expect(rowWritten.work_summary).toBe("Fresh words.");
    expect(rowWritten.work_points).toEqual(["A point about the work"]);
    expect("money_summary" in rowWritten).toBe(false);
  });
});
