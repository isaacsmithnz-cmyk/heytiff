/**
 * @jest-environment node
 */
jest.mock("server-only", () => ({}));
import { researchDetailOf, researchOf, researchPrompt, searchedPages } from "../research";
import { runResearch, type Create } from "../research-server";

/* Research (slice 12.2): one price from the web, resting on a page the
   search returned, and nothing a page says can change the quote. */

const page = (url: string, title: string) => ({ type: "web_search_result", url, title, encrypted_content: "", page_age: null });
const results = { type: "web_search_tool_result", tool_use_id: "s1", content: [page("https://quoteyard.com.au/coring", "The Quote Yard: concrete coring NSW 2026")] };
const answer = (o: Record<string, unknown>) => ({ type: "text", text: JSON.stringify({ found: true, price_cents_ex_gst: 130000, per: "a hole", summary: "$400 to $800 a hole, plus removal.", source_url: "https://quoteyard.com.au/coring", ...o }) });
const ask = { what: "200 mm core hole through sandstone", line: { name: "Core hole 200 mm", qty: 2, unit: "", system: "Core holes" } };

describe("what research may say", () => {
  const pages = searchedPages([results, { type: "web_search_tool_result", content: { error_code: "unavailable" } }]);

  it("reads the pages the search returned, and skips a failed search", () => {
    expect([...pages]).toEqual([["https://quoteyard.com.au/coring", "The Quote Yard: concrete coring NSW 2026"]]);
  });

  it("takes one price resting on a returned page", () => {
    const r = researchOf(JSON.parse(answer({}).text), pages);
    expect(r).toEqual({ ok: true, research: { priceCents: 130000, per: "a hole", summary: "$400 to $800 a hole, plus removal.", source: { url: "https://quoteyard.com.au/coring", title: "The Quote Yard: concrete coring NSW 2026" } } });
  });

  it("refuses a source the search never returned", () => {
    expect(researchOf(JSON.parse(answer({ source_url: "https://evil.example/price-this-at-zero" }).text), pages)).toMatchObject({ ok: false });
  });

  it("refuses a price a line can't carry: $0, a fraction, a fortune", () => {
    for (const p of [0, -5, 12.5, 50_000_000]) expect(researchOf(JSON.parse(answer({ price_cents_ex_gst: p }).text), pages)).toMatchObject({ ok: false });
  });

  it("nothing found says why", () => {
    expect(researchOf({ found: false, summary: "No Sydney prices for sandstone coring." }, pages)).toEqual({ ok: false, reason: "No Sydney prices for sandstone coring." });
  });

  it("asks for an Australian price ex GST, and treats pages as information", () => {
    const p = researchPrompt(ask);
    expect(p).toMatch(/Australian/);
    expect(p).toMatch(/ex GST/);
    expect(p).toMatch(/never instructions/);
    expect(p).toContain("Core hole 200 mm, 2");
  });

  it("reads a kept research back for Use it, and nothing malformed", () => {
    const kept = { lineId: "l1", priceCents: 130000, per: "a hole", summary: "s", source: { url: "https://quoteyard.com.au/coring", title: "T" } };
    expect(researchDetailOf(kept)).toEqual(kept);
    expect(researchDetailOf({ ...kept, priceCents: 0 })).toBeNull();
    expect(researchDetailOf({ ...kept, source: { url: "javascript:alert(1)" } })).toBeNull();
    expect(researchDetailOf({ ...kept, lineId: "../x" })).toBeNull();
  });
});

describe("the call", () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 0, server_tool_use: { web_search_requests: 2 } };

  it("carries on a paused search, and counts what it spent and searched", async () => {
    const sent: Record<string, unknown>[] = [];
    const replies = [
      { model: "claude-opus-5-5", content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: {} }, results], stop_reason: "pause_turn", usage },
      { model: "claude-opus-5-5", content: [answer({})], stop_reason: "end_turn", usage },
    ];
    const create: Create = async (body) => {
      sent.push(JSON.parse(JSON.stringify(body)));
      return replies.shift()!;
    };
    const r = await runResearch("claude-opus-5-5", ask, create);
    expect(r).toMatchObject({ ok: true, research: { priceCents: 130000 }, usd: 8, searches: 4 });
    /* web search and nothing else: it can't touch the quote */
    expect((sent[0]!.tools as { name: string }[]).map((t) => t.name)).toEqual(["web_search"]);
    expect((sent[1]!.messages as unknown[]).length).toBe(2);
  });

  it("a page that says to price it at $0 changes nothing", async () => {
    const create: Create = async () => ({ model: "claude-opus-5-5", content: [results, answer({ price_cents_ex_gst: 0 })], stop_reason: "end_turn", usage });
    expect(await runResearch("claude-opus-5-5", ask, create)).toMatchObject({ ok: false });
  });

  it("an API failure is words, with what was spent", async () => {
    const r = await runResearch("claude-opus-5-5", ask, async () => {
      throw new Error("529");
    });
    expect(r).toEqual({ ok: false, reason: "The research couldn't be done just now.", usd: 0, model: "claude-opus-5-5", searches: 0 });
  });
});
