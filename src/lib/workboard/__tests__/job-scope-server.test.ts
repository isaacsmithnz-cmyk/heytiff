/* A job's scope, written and kept: Tiff reads only when the job's story has
   moved past the stored brief, only on a job being quoted or worked, and
   never sees a money-shaped entry. */

import type Anthropic from "@anthropic-ai/sdk";

const maybeSingle = jest.fn();
const upsert = jest.fn(async () => ({ error: null }));
const update = jest.fn();
const guarded = jest.fn();
const whereUpdate = { eq: (...a: unknown[]) => (guarded(...a), whereUpdate), select: async () => updated() };
const updated = jest.fn();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle, limit: () => ({ maybeSingle: hasLines }) }) }) }),
      upsert,
      update: (change: unknown) => (update(change), whereUpdate),
    }),
  },
}));
const hasLines = jest.fn(async () => ({ data: { id: "l-1" } }));
jest.mock("@/lib/quotes/lines-job-server", () => ({ readByHand: async () => ({ proposal: null }) }));
const readJobStoryForSummary = jest.fn();
jest.mock("../all-jobs-query", () => ({ resolveJobCard: async (_o: string, id: string) => ({ parentRemoteId: id }) }));
jest.mock("../query", () => ({ getSm8Timezone: async () => "Australia/Sydney" }));
jest.mock("../job-summary", () => ({ readJobStoryForSummary: (...a: unknown[]) => readJobStoryForSummary(...a) }));
/* what the job was supplied with (supplied-scope-server.ts): none unless a test says */
const suppliedNow = jest.fn();
jest.mock("@/lib/jobs/supplied-scope-server", () => ({ suppliedNow: (...a: unknown[]) => suppliedNow(...a) }));

import { refreshJobScope, takeOffQuoteRail, undoJobScope } from "../job-scope-server";
import { scopeStamp } from "@/lib/jobs/job-scope";
import type { StoryEntry } from "../job-story";

const BRIEF = { lede: "Four systems.", systems: [{ area: "Studio", kind: "split system", text: "Living and bedroom.", from: ["A201"] }], added: [], notOurs: [], clarify: [], updates: [] };

const story = (over: Record<string, unknown> = {}) => ({
  cardId: "j-1",
  stamp: "2026-10-28 14:40:00|3",
  status: "Quote",
  createdOn: "2026-10-08 00:00:00",
  clientName: "Tandem Projects",
  scope: "Fw: Quote 6 Bishops avenue",
  workDone: null,
  entries: [
    { kind: "note", day: "2026-10-28", at: "2026-10-28 14:40:00", author: "Isaac Smith", text: "Builder rang: exhaust fans too", actionRequired: false },
    { kind: "payment", day: "2026-10-20", at: null, amountCents: 500000, isDeposit: true, method: null },
  ],
  ...over,
});

const STAMP = scopeStamp(story().entries as unknown as StoryEntry[]) as string;
const row = (over: Record<string, unknown> = {}) => ({ brief: BRIEF, previous_brief: null, set_aside: [], story_stamp: "older", written_at: "2026-10-28T04:00:00Z", ...over });

const client = () => {
  const create = jest.fn(async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(BRIEF) }] }));
  return { create, client: { messages: { create } } as unknown as Anthropic };
};

beforeEach(() => {
  maybeSingle.mockReset().mockResolvedValue({ data: null });
  upsert.mockClear();
  update.mockClear();
  guarded.mockClear();
  updated.mockReset().mockResolvedValue({ data: [{ job_uuid: "j-1" }], error: null });
  readJobStoryForSummary.mockReset().mockResolvedValue(story());
  suppliedNow.mockReset().mockResolvedValue({ scope: null, stamp: null, fresh: false });
});

it("writes the scope when the job has none, from its story without the money", async () => {
  const { create, client: c } = client();
  const res = await refreshJobScope("org", "j-1", c);
  expect(res).toMatchObject({ ok: true, wrote: true, scope: { lede: "Four systems.", stamp: STAMP } });
  const prompt = (create.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content;
  expect(prompt).toContain("Builder rang: exhaust fans too");
  expect(prompt).not.toMatch(/deposit|5,000|\$/);
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ org_id: "org", job_uuid: "j-1", story_stamp: STAMP }), { onConflict: "org_id,job_uuid" });
});

it("costs no read while the stored scope is as new as the story", async () => {
  maybeSingle.mockResolvedValue({ data: row({ story_stamp: STAMP }) });
  const { create, client: c } = client();
  expect(await refreshJobScope("org", "j-1", c)).toMatchObject({ ok: true, wrote: false, scope: { lede: "Four systems." } });
  expect(create).not.toHaveBeenCalled();
});

it("never writes for a job that's finished or lost, and keeps what it had", async () => {
  readJobStoryForSummary.mockResolvedValue(story({ status: "Completed" }));
  const { create, client: c } = client();
  expect(await refreshJobScope("org", "j-1", c)).toEqual({ ok: true, scope: null, wrote: false });
  expect(create).not.toHaveBeenCalled();
});

it("says so when Tiff can't be reached, and stores nothing", async () => {
  const create = jest.fn(async () => {
    throw new Error("down");
  });
  const res = await refreshJobScope("org", "j-1", { messages: { create } } as unknown as Anthropic);
  expect(res).toEqual({ ok: false, reason: "The scope couldn't be written." });
  expect(upsert).not.toHaveBeenCalled();
});

it("never writes for a job made before the first of October", async () => {
  readJobStoryForSummary.mockResolvedValue(story({ createdOn: "2026-09-30 00:00:00" }));
  const { create, client: c } = client();
  expect(await refreshJobScope("org", "j-1", c)).toEqual({ ok: true, scope: null, wrote: false });
  expect(create).not.toHaveBeenCalled();
});

describe("a new note on a job that has a brief", () => {
  const changed = { ...BRIEF, added: [{ text: "Exhaust fans", from: "Isaac Smith, 28 Oct" }], undoSaid: "Took out the exhaust fans." };
  const answering = (brief: unknown) => {
    const create = jest.fn(async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(brief) }] }));
    return { create, client: { messages: { create } } as unknown as Anthropic };
  };

  it("hands Tiff the brief as it stands and keeps it for Undo", async () => {
    maybeSingle.mockResolvedValue({ data: row() });
    const { create, client: c } = answering(changed);
    const res = await refreshJobScope("org", "j-1", c);
    expect(res).toMatchObject({ ok: true, wrote: true, scope: { canUndo: true, undoSaid: "Took out the exhaust fans." } });
    expect((create.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content).toContain("The brief as it stands");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ brief: expect.objectContaining({ undoSaid: "Took out the exhaust fans." }), previous_brief: BRIEF, story_stamp: STAMP }));
    expect(guarded).toHaveBeenCalledWith("written_at", "2026-10-28T04:00:00Z");
  });

  it("takes the note in and leaves the brief when nothing it says changes the scope", async () => {
    maybeSingle.mockResolvedValue({ data: row({ previous_brief: { lede: "Before." } }) });
    const { client: c } = answering({ ...BRIEF, updates: [{ on: "x", from: "y", said: "A visit was booked." }] });
    const res = await refreshJobScope("org", "j-1", c);
    expect(res).toMatchObject({ ok: true, wrote: false, scope: { canUndo: true, stamp: STAMP } });
    expect(update).toHaveBeenCalledWith(expect.not.objectContaining({ brief: expect.anything() }));
    expect(update).toHaveBeenCalledWith(expect.not.objectContaining({ previous_brief: expect.anything() }));
  });

  it("doesn't lay its answer over a change someone made while it read", async () => {
    maybeSingle.mockResolvedValue({ data: row() });
    updated.mockResolvedValue({ data: [], error: null });
    const { client: c } = answering(changed);
    expect(await refreshJobScope("org", "j-1", c)).toMatchObject({ ok: true, wrote: false });
  });
});

describe("Undo", () => {
  const was = { ...BRIEF, lede: "Before.", updates: [{ on: "Tue 27 Oct", from: "Luke", said: "Started." }] };
  const now = { ...BRIEF, undoSaid: "Took out the exhaust fans.", updates: [{ on: "Wed 28 Oct", from: "Isaac Smith", said: "Added exhaust fans." }] };

  it("puts the brief back with no read, says who, and sets the change aside", async () => {
    maybeSingle.mockResolvedValue({ data: row({ brief: now, previous_brief: was, story_stamp: STAMP }) });
    const res = await undoJobScope("org", "j-1", "Sam Lee");
    expect(res).toMatchObject({ ok: true, scope: { lede: "Before.", canUndo: false, stamp: STAMP } });
    const change = update.mock.calls[0][0] as { previous_brief: unknown; set_aside: { said: string }[]; brief: { updates: { from: string; said: string }[] }; story_stamp?: string };
    expect(change.previous_brief).toBeNull();
    expect(change.story_stamp).toBeUndefined();
    expect(change.set_aside[0].said).toBe("Added exhaust fans.");
    expect(change.brief.updates[0]).toMatchObject({ from: "Sam Lee", said: "Took out the exhaust fans." });
    expect(change.brief.updates[1].said).toBe("Started.");
  });

  it("says so when there's nothing to go back to", async () => {
    maybeSingle.mockResolvedValue({ data: row() });
    expect(await undoJobScope("org", "j-1", "Sam Lee")).toEqual({ ok: false, reason: "There's nothing to undo." });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("the quote's rail", () => {
  const PUMP = { text: "Condensate pump in unit 12", from: "Isaac Smith's note" };
  const withPump = { ...BRIEF, added: [PUMP] };
  const writes = (added: object) => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(added) }] });

  beforeEach(() => hasLines.mockResolvedValue({ data: { id: "l-1" } }));

  it("holds what a note added while the quote has lines", async () => {
    maybeSingle.mockResolvedValue({ data: row() });
    const create = jest.fn(async () => writes(withPump));
    const res = await refreshJobScope("org", "j-1", { messages: { create } } as unknown as Anthropic);
    expect(res.ok && res.scope?.sincePriced).toEqual([PUMP]);
    expect(update.mock.calls[0][0]).toMatchObject({ since_priced: [PUMP] });
  });

  it("holds nothing when the quote has no lines yet", async () => {
    hasLines.mockResolvedValue({ data: null } as never);
    maybeSingle.mockResolvedValue({ data: row() });
    const create = jest.fn(async () => writes(withPump));
    const res = await refreshJobScope("org", "j-1", { messages: { create } } as unknown as Anthropic);
    expect(res.ok && res.scope?.sincePriced).toEqual([]);
  });

  it("takes a thing off the rail and leaves it in the brief, with no read", async () => {
    maybeSingle.mockResolvedValue({ data: row({ brief: withPump, since_priced: [PUMP] }) });
    const res = await takeOffQuoteRail("org", "j-1", [PUMP.text]);
    expect(res.ok && res.scope?.sincePriced).toEqual([]);
    expect(res.ok && res.scope?.added).toEqual([PUMP]);
    expect(update.mock.calls[0][0]).toMatchObject({ since_priced: [] });
    expect(update.mock.calls[0][0]).not.toHaveProperty("brief");
  });
});

describe("what the job was supplied with", () => {
  const SUPPLIED = { lede: "Watershed's tender set, Issue G.", systems: [{ area: "First floor", kind: "Ducted", text: "Two FXDQ40 and an FXDQ50.", from: ["CD106"] }], fine: [{ text: "Refrigerant GWP 700 or under", from: "Spec 0702, page 180" }], notOurs: [], clarify: [] };

  it("writes both scopes for a job made before October once its plans are read, the quoted one starting from the supplied", async () => {
    readJobStoryForSummary.mockResolvedValue(story({ createdOn: "2026-05-04 00:00:00", status: "Work Order" }));
    suppliedNow.mockResolvedValue({ scope: SUPPLIED, stamp: "sup-1", fresh: true });
    const { create, client: c } = client();
    const res = await refreshJobScope("org", "j-1", c);
    expect(res).toMatchObject({ ok: true, wrote: true, scope: { supplied: SUPPLIED } });
    const prompt = (create.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content;
    expect(prompt).toContain("The supplied scope");
    expect(prompt).toContain("Two FXDQ40 and an FXDQ50");
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ supplied: SUPPLIED, supplied_stamp: "sup-1", brief_supplied_stamp: "sup-1" }), { onConflict: "org_id,job_uuid" });
  });

  it("writes the quoted scope again when the supplied one moves, though no note has", async () => {
    maybeSingle.mockResolvedValue({ data: row({ story_stamp: STAMP, supplied: SUPPLIED, supplied_stamp: "sup-1", brief_supplied_stamp: "sup-1" }) });
    suppliedNow.mockResolvedValue({ scope: { ...SUPPLIED, lede: "Issue H." }, stamp: "sup-2", fresh: true });
    const { create, client: c } = client();
    await refreshJobScope("org", "j-1", c);
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ supplied_stamp: "sup-2", brief_supplied_stamp: "sup-2" }));
  });

  it("costs no read while neither the story nor the supplied scope has moved", async () => {
    maybeSingle.mockResolvedValue({ data: row({ story_stamp: STAMP, supplied: SUPPLIED, supplied_stamp: "sup-1", brief_supplied_stamp: "sup-1" }) });
    suppliedNow.mockResolvedValue({ scope: SUPPLIED, stamp: "sup-1", fresh: false });
    const { create, client: c } = client();
    expect(await refreshJobScope("org", "j-1", c)).toMatchObject({ ok: true, wrote: false, scope: { supplied: SUPPLIED } });
    expect(create).not.toHaveBeenCalled();
  });
});
