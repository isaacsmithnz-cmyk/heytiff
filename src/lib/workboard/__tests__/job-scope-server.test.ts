/* A job's scope, written and kept: Tiff reads only when the job's story has
   moved past the stored brief, only on a job being quoted or worked, and
   never sees a money-shaped entry. */

import type Anthropic from "@anthropic-ai/sdk";

const maybeSingle = jest.fn();
const upsert = jest.fn(async () => ({ error: null }));
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }), upsert }),
  },
}));
const readJobStoryForSummary = jest.fn();
jest.mock("../job-summary", () => ({ readJobStoryForSummary: (...a: unknown[]) => readJobStoryForSummary(...a) }));

import { refreshJobScope } from "../job-scope-server";

const BRIEF = { lede: "Four systems.", systems: [{ area: "Studio", kind: "split system", text: "Living and bedroom.", from: ["A201"] }], added: [], notOurs: [], clarify: [], updates: [] };

const story = (over: Record<string, unknown> = {}) => ({
  cardId: "j-1",
  stamp: "2026-10-28 14:40:00|3",
  status: "Quote",
  clientName: "Tandem Projects",
  scope: "Fw: Quote 6 Bishops avenue",
  workDone: null,
  entries: [
    { kind: "note", day: "2026-10-28", at: "2026-10-28 14:40:00", author: "Isaac Smith", text: "Builder rang: exhaust fans too", actionRequired: false },
    { kind: "payment", day: "2026-10-20", at: null, amountCents: 500000, isDeposit: true, method: null },
  ],
  ...over,
});

const client = () => {
  const create = jest.fn(async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(BRIEF) }] }));
  return { create, client: { messages: { create } } as unknown as Anthropic };
};

beforeEach(() => {
  maybeSingle.mockReset().mockResolvedValue({ data: null });
  upsert.mockClear();
  readJobStoryForSummary.mockReset().mockResolvedValue(story());
});

it("writes the scope when the job has none, from its story without the money", async () => {
  const { create, client: c } = client();
  const res = await refreshJobScope("org", "j-1", c);
  expect(res).toMatchObject({ ok: true, wrote: true, scope: { lede: "Four systems.", stamp: "2026-10-28 14:40:00|3" } });
  const prompt = (create.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content;
  expect(prompt).toContain("Builder rang: exhaust fans too");
  expect(prompt).not.toMatch(/deposit|5,000|\$/);
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ org_id: "org", job_uuid: "j-1", story_stamp: "2026-10-28 14:40:00|3" }), { onConflict: "org_id,job_uuid" });
});

it("costs no read while the stored scope is as new as the story", async () => {
  maybeSingle.mockResolvedValue({ data: { brief: BRIEF, story_stamp: "2026-10-28 14:40:00|3", written_at: "2026-10-28T04:00:00Z" } });
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
