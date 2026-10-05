/**
 * @jest-environment node
 */
/* A maker's document read for its code letters, on Sonnet (Isaac,
   2026-10-05: "I would use Sonnet"), and the rules a business keeps. */
import type Anthropic from "@anthropic-ai/sdk";

jest.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
let ROWS: Row[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const filters: ((r: Row) => boolean)[] = [];
      let removing = false;
      const q = {
        select: () => q,
        delete: () => ((removing = true), q),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        order: () => q,
        upsert: async (rows: Row[]) => {
          for (const row of rows) ROWS = [...ROWS.filter((r) => !(r.org_id === row.org_id && r.rule_key === row.rule_key)), { id: `id-${ROWS.length + 1}`, ...row }];
          return { error: null };
        },
        then: (resolve: (v: { data: Row[]; error: null }) => void) => {
          const hit = ROWS.filter((r) => filters.every((f) => f(r)));
          if (removing) {
            ROWS = ROWS.filter((r) => !hit.includes(r));
            return resolve({ data: [], error: null });
          }
          return resolve({ data: hit, error: null });
        },
      };
      return q;
    },
  },
}));

import { keepLetterRules, readCodeLetters, readLetterRules, removeLetterRule } from "../code-letters-server";

const answer = {
  maker: "Mitsubishi Electric",
  rules: [
    { family: "MSZ", letter: "K", meaning: "Wi-Fi built in", codeWith: "MSZ-AP25VGKD2", codeWithout: "MSZ-AP25VGD2" },
    { family: "PUMY", letter: "Q", meaning: "Quiet", codeWith: "", codeWithout: "" },
  ],
};
const clientSaying = (body: unknown, stop = "end_turn") => {
  const create = jest.fn(async (_req: unknown) => ({ stop_reason: stop, content: [{ type: "text", text: JSON.stringify(body) }] }));
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
};

beforeEach(() => {
  ROWS = [];
});

it("reads on Sonnet, the document before the ask, and believes only what its examples bear out", async () => {
  const { client, create } = clientSaying(answer);
  const res = await readCodeLetters(Buffer.from("%PDF"), "application/pdf", client);
  const req = create.mock.calls[0]![0] as { model: string; output_config: { effort: string }; messages: { content: { type: string }[] }[] };
  expect(req.model).toBe("claude-sonnet-5-5");
  expect(req.output_config.effort).toBe("medium");
  expect(req.messages[0]!.content.map((b) => b.type)).toEqual(["document", "text"]);
  expect(res).toMatchObject({ ok: true, read: { maker: "Mitsubishi Electric", rules: [{ family: "MSZ", letter: "K" }], skipped: [{ why: "not a letter and a meaning with an example" }] } });
});

it("says so when Tiff declines or runs out of room", async () => {
  expect(await readCodeLetters(Buffer.from("x"), "image/png", clientSaying(answer, "refusal").client)).toEqual({ ok: false, reason: "Tiff declined to read this document." });
  expect(await readCodeLetters(Buffer.from("x"), "image/png", clientSaying(answer, "max_tokens").client)).toEqual({ ok: false, reason: "That document is too long to read in one go." });
});

it("keeps a business's rules, one a rule however often it's kept, and takes one out", async () => {
  const k = { family: "MSZ", letter: "K", meaning: "Wi-Fi built in", example: { with: "MSZ-AP25VGKD2", without: "MSZ-AP25VGD2" } };
  expect(await keepLetterRules("org-1", "u1", "mitsubishi", "ME_PriceList.pdf", [k, { ...k, meaning: "WiFi built in", example: { with: "MSZ-AP71VGKD2", without: "MSZ-AP71VGD2" } }])).toBe(true);
  /* a rule its example doesn't bear out is never kept */
  expect(await keepLetterRules("org-1", "u1", "mitsubishi", "x", [{ ...k, example: { with: "MSZ-AP25VGKD2", without: "MSZ-AP35VGD2" } }])).toBe(false);
  const kept = await readLetterRules("org-1", "mitsubishi");
  expect(kept.map((r) => [r.family, r.letter, r.meaning, r.source])).toEqual([["MSZ", "K", "WiFi built in", "ME_PriceList.pdf"]]);
  expect(await readLetterRules("org-2")).toEqual([]);
  expect(await removeLetterRule("org-1", kept[0]!.id)).toBe(true);
  expect(await readLetterRules("org-1")).toEqual([]);
});
