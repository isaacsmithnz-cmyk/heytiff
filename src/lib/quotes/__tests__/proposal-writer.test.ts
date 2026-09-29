/* The proposal writer: what it is handed, what it keeps, what it refuses.

   The laws worth their tests: the prompt carries the job and the words said
   and never a price field; a change carries the draft as it stands AND the
   brief it was written from; a change with nothing to change costs no model
   call; and whatever comes back passes the draft gate before it is stored. */

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

import { changePrompt, draftPrompt, runProposalWrite, writeProposal, type ProposalJob } from "../proposal-writer";
import type { ProposalDraft } from "../proposal";

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

const draft: ProposalDraft = {
  intro: "Hi Jane,\nHere is the scope.",
  options: [{ name: "Install client-supplied 6 kW split", lines: ["Installation of a client-supplied 6 kW split system."], pros: [], cons: [] }],
  pricingMode: "multiple_choice",
  notes: ["client_supplied"],
  questions: ["Which model is it?"],
};

const answer = {
  intro: "Hi Jane,\nHere is the scope.",
  options: [{ name: "Option 1: Install client-supplied 6 kW split", lines: ["- Outdoor unit mounted on the parapet wall on brackets."], pros: [], cons: [] }],
  pricing_mode: "multiple_choice",
  notes: ["client_supplied", "roof_access"],
  questions: [],
};

function clientSaying(body: unknown, stop = "end_turn") {
  const create = jest.fn(async () => ({
    stop_reason: stop,
    content: [{ type: "text", text: JSON.stringify(body) }],
  }));
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

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
    data: { sm8_job_uuid: "j-1", draft: ((upsert.mock.calls.at(-1) as unknown[] | undefined)?.[0] as { draft?: unknown } | undefined)?.draft, brief: "b", changes: [], updated_at: "2026-09-29T08:00:00Z" },
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

  it("a change carries the draft as it stands and the brief it came from", () => {
    const p = changePrompt(job, "the original brief", draft, "Add an option with the unit on the ground");
    expect(p).toContain("the original brief");
    expect(p).toContain('"pricing_mode":"multiple_choice"');
    expect(p).toContain("Install client-supplied 6 kW split");
    expect(p).toContain("Add an option with the unit on the ground");
  });
});

describe("runProposalWrite", () => {
  it("passes the answer through the draft gate", async () => {
    const { client, create } = clientSaying(answer);
    const res = await runProposalWrite("turn", client);
    expect(res).toEqual({
      ok: true,
      draft: {
        intro: "Hi Jane,\nHere is the scope.",
        options: [
          { name: "Install client-supplied 6 kW split", lines: ["Outdoor unit mounted on the parapet wall on brackets."], pros: [], cons: [] },
        ],
        pricingMode: "multiple_choice",
        notes: ["client_supplied", "roof_access"],
        questions: [],
      },
    });
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
    const row = (upsert.mock.calls[0] as unknown[])[0] as { sm8_job_uuid: string; brief: string; changes: string[] };
    expect(row.sm8_job_uuid).toBe("j-1");
    expect(row.brief).toBe("the brief");
    expect(row.changes).toEqual([]);
  });

  it("a change with no draft to change costs no model call", async () => {
    maybeSingle.mockResolvedValue({ data: null });
    const { client, create } = clientSaying(answer);
    const res = await writeProposal("org", "user", "j-1", { kind: "change", change: "shorter" }, client);
    expect(res).toEqual({ ok: false, reason: "There's no proposal on this job to change. Draft one first." });
    expect(create).not.toHaveBeenCalled();
  });

  it("a change keeps the brief and adds itself to the changes", async () => {
    maybeSingle.mockResolvedValue({
      data: { sm8_job_uuid: "j-1", draft, brief: "the brief", changes: ["earlier"], updated_at: "2026-09-29T07:00:00Z" },
    });
    const { client } = clientSaying(answer);
    await writeProposal("org", "user", "j-1", { kind: "change", change: " add roof access " }, client);
    const row = (upsert.mock.calls[0] as unknown[])[0] as { brief: string; changes: string[] };
    expect(row.brief).toBe("the brief");
    expect(row.changes).toEqual(["earlier", "add roof access"]);
  });
});
