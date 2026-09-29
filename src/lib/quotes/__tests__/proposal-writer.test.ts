/* The proposal writer: what it is handed, what it keeps, what it refuses.

   The laws worth their tests: the prompt carries the job and the words said
   and never a price field; the instructions carry the whole checklist
   catalogue and ban "TBC" and "a suitable point"; a change carries the draft
   as it stands, the brief it was written from, and the answers given on the
   card since; a change with nothing to change costs no model call; the
   writer names a payment preset but the stages are HeyTiff's, and stages a
   person set by hand survive a change that keeps the preset. */

import type Anthropic from "@anthropic-ai/sdk";

const maybeSingle = jest.fn();
const single = jest.fn();
const upsert = jest.fn(() => ({ select: () => ({ single }) }));
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }),
      upsert,
    }),
  },
}));

const readMirrorJobDetail = jest.fn();
jest.mock("@/lib/workboard/all-jobs-query", () => ({
  resolveJobCard: async () => ({ parentRemoteId: "j-1", focusRemoteId: null }),
  readMirrorJobDetail: (...a: unknown[]) => readMirrorJobDetail(...(a as [])),
  readJobNotes: async () => [{ text: "Living room grille 1780 x 145" }],
  familyMediaSources: async () => [],
}));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: async () => "Australia/Sydney" }));

import {
  SYSTEM_PROMPT,
  changePrompt,
  draftPrompt,
  runProposalWrite,
  writeProposal,
  type ProposalJob,
} from "../proposal-writer";
import { normaliseDraft, type ProposalDraft } from "../proposal";
import { CHECKLIST_KEYS } from "../checklist";
import { PAYMENT_PRESETS } from "../payment";

const job: ProposalJob = {
  cardId: "j-1",
  jobNumber: "3400",
  address: "12 Smith St\nMosman NSW 2088",
  clientName: "Jane Citizen",
  contactFirstName: "Jane",
  category: "Install",
  scope: "Quote for AC",
  notes: ["Parapet wall, tiled roof"],
};

const draft: ProposalDraft = normaliseDraft({
  intro: "Hi Jane,\nHere is the scope.",
  options: [{ name: "Install client-supplied 6 kW split", lines: ["Installation of a client-supplied 6 kW split system."] }],
  notes: ["client_supplied"],
  payment: { preset: "domestic_small", stages: [{ when: "Deposit, on accepting", percent: 5 }, { when: "Balance", percent: 95 }] },
  checklist: [
    { key: "model", state: "ask", answer: "" },
    { key: "pipe_colour", state: "known", answer: "Paperbark", fresh: true },
  ],
})!;

const answer = {
  intro: "Hi Jane,\nHere is the scope.",
  why: "",
  options: [
    {
      name: "Option 1: Install client-supplied 6 kW split",
      lines: ["- Outdoor unit mounted on the parapet wall on brackets."],
      units: [],
      pros: [],
      cons: [],
    },
  ],
  pricing_mode: "multiple_choice",
  items: [],
  extras: [],
  allowances: [],
  notes: ["client_supplied", "roof_access"],
  payment_preset: "domestic_small",
  checklist: [
    { key: "drain_to", state: "known", answer: "Downpipe" },
    { key: "pipe_covering", state: "ask", answer: "" },
  ],
};

function clientSaying(body: unknown, stop = "end_turn") {
  const create = jest.fn(async () => ({
    stop_reason: stop,
    content: [{ type: "text", text: JSON.stringify(body) }],
  }));
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

const lastRow = () => (upsert.mock.calls.at(-1) as unknown[] | undefined)?.[0] as
  | { sm8_job_uuid: string; brief: string; changes: string[]; draft: ProposalDraft }
  | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  readMirrorJobDetail.mockResolvedValue({
    remoteId: "j-1",
    jobNumber: "3400",
    address: "12 Smith St\nMosman NSW 2088",
    geoLine: null,
    clientName: "Jane Citizen",
    categoryName: "Install",
    description: "Quote for AC",
    contacts: [{ name: "Jane Citizen", type: null, phone: null, altPhone: null, email: null }],
  });
  single.mockImplementation(async () => ({
    data: { sm8_job_uuid: "j-1", draft: lastRow()?.draft, brief: "b", changes: [], updated_at: "2026-09-29T08:00:00Z" },
    error: null,
  }));
});

describe("the prompts", () => {
  it("carries the job and what was said, and the greeting's first name", () => {
    const p = draftPrompt(job, "Client has his own 6 kW ME split, parapet wall");
    expect(p).toContain("Job 3400");
    expect(p).toContain("Contact's first name: Jane");
    expect(p).toContain("Site: 12 Smith St, Mosman NSW 2088");
    expect(p).toContain("- Parapet wall, tiled roof");
    expect(p).toContain("Client has his own 6 kW ME split, parapet wall");
    expect(p).not.toMatch(/\$|price/i);
  });

  it("the instructions carry every checklist topic and ban the vague words", () => {
    for (const k of CHECKLIST_KEYS) expect(SYSTEM_PROMPT).toContain(`- ${k} (`);
    expect(SYSTEM_PROMPT).toContain('Never write "TBC", "to be confirmed", "as discussed" or "a suitable point"');
  });

  it("a change carries the draft, the brief, and the answers given since", () => {
    const p = changePrompt(job, "the original brief", draft, "Add an option with the unit on the ground");
    expect(p).toContain("the original brief");
    expect(p).toContain('"payment_preset":"domestic_small"');
    expect(p).toContain("Install client-supplied 6 kW split");
    expect(p).toContain("- Covering colour: Paperbark");
    expect(p).toContain("Add an option with the unit on the ground");
  });
});

describe("runProposalWrite", () => {
  it("passes the answer through the draft gate, stages from the preset", async () => {
    const { client, create } = clientSaying(answer);
    const res = await runProposalWrite("turn", client);
    if (!res.ok) throw new Error(res.reason);
    expect(res.draft.options[0]).toEqual({
      name: "Install client-supplied 6 kW split",
      lines: ["Outdoor unit mounted on the parapet wall on brackets."],
      units: [],
      pros: [],
      cons: [],
    });
    expect(res.draft.payment).toEqual({ preset: "domestic_small", stages: PAYMENT_PRESETS.domestic_small.stages });
    expect(res.draft.checklist.map((i) => i.key)).toEqual(["pipe_covering", "drain_to"]);
    const params = (create.mock.calls[0] as unknown[])[0] as { model: string; fallbacks: unknown; output_config: { format: { type: string } } };
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.fallbacks).toEqual([{ model: "claude-opus-4-8" }]);
    expect(params.output_config.format.type).toBe("json_schema");
  });

  it("says so when the model declines, runs long, or returns no scope", async () => {
    expect((await runProposalWrite("t", clientSaying(answer, "refusal").client)).ok).toBe(false);
    expect((await runProposalWrite("t", clientSaying(answer, "max_tokens").client)).ok).toBe(false);
    expect(await runProposalWrite("t", clientSaying({ ...answer, options: [] }).client)).toEqual({
      ok: false,
      reason: "Tiff returned no scope. Say a little more about the job.",
    });
  });
});

describe("writeProposal", () => {
  it("drafts and stores against the card", async () => {
    const { client } = clientSaying(answer);
    const res = await writeProposal("org", "user", "j-1", { kind: "draft", brief: "  the brief  " }, client);
    expect(res.ok).toBe(true);
    expect(lastRow()?.sm8_job_uuid).toBe("j-1");
    expect(lastRow()?.brief).toBe("the brief");
    expect(lastRow()?.changes).toEqual([]);
  });

  it("a change with no draft to change costs no model call", async () => {
    maybeSingle.mockResolvedValue({ data: null });
    const { client, create } = clientSaying(answer);
    const res = await writeProposal("org", "user", "j-1", { kind: "change", change: "shorter" }, client);
    expect(res).toEqual({ ok: false, reason: "There's no proposal on this job to change. Draft one first." });
    expect(create).not.toHaveBeenCalled();
  });

  it("a change keeps the brief, logs itself, and keeps hand-set stages on the same preset", async () => {
    maybeSingle.mockResolvedValue({
      data: { sm8_job_uuid: "j-1", draft, brief: "the brief", changes: ["earlier"], updated_at: "2026-09-29T07:00:00Z" },
    });
    const { client } = clientSaying(answer);
    await writeProposal("org", "user", "j-1", { kind: "change", change: "" }, client);
    expect(lastRow()?.brief).toBe("the brief");
    expect(lastRow()?.changes).toEqual(["earlier", "Put the checklist answers in"]);
    expect(lastRow()?.draft.payment.stages[0]).toEqual({ when: "Deposit, on accepting", percent: 5 });
  });

  it("a change to another preset takes that preset's stages", async () => {
    maybeSingle.mockResolvedValue({
      data: { sm8_job_uuid: "j-1", draft, brief: "the brief", changes: [], updated_at: "2026-09-29T07:00:00Z" },
    });
    const { client } = clientSaying({ ...answer, payment_preset: "commercial" });
    await writeProposal("org", "user", "j-1", { kind: "change", change: "It's a bakery" }, client);
    expect(lastRow()?.draft.payment).toEqual({ preset: "commercial", stages: PAYMENT_PRESETS.commercial.stages });
  });
});
