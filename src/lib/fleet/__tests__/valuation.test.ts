import type Anthropic from "@anthropic-ai/sdk";
import { anySearchSucceeded, runFleetValuation, valuationPrompt, type FleetAiVehicle } from "../valuation";

/* Grounding the valuation in live listings is the whole point of this module,
   so the tests guard the two ways it could quietly stop being grounded: the
   search tool not actually being asked for, and a failed search being counted
   as a successful one. The third is the resume — a server-tool turn that hits
   the iteration cap returns `pause_turn` with NO error, so a loop that doesn't
   handle it just returns half an answer and looks fine. */

const VAN: FleetAiVehicle = {
  id: "v1",
  make: "Toyota",
  model: "Hiace",
  year: 2022,
  odometerKm: 55500,
  status: "In service",
  purchasePriceAud: null,
  ageYears: null,
};

const answer = (json: string) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: json }],
});

const VALUATIONS = JSON.stringify({
  valuations: [{ id: "v1", low: 38000, high: 46000, point: 42000, note: "8 listings, 2022 Hiace LWB" }],
});

function fakeClient(responses: unknown[]) {
  const create = jest.fn();
  for (const r of responses) create.mockResolvedValueOnce(r);
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

it("asks for live search with the current tool, in Australia", async () => {
  const { client, create } = fakeClient([answer(VALUATIONS)]);
  await runFleetValuation([VAN], client);

  const tools = create.mock.calls[0][0].tools;
  expect(tools).toEqual([
    expect.objectContaining({
      type: "web_search_20260209",
      name: "web_search",
      user_location: expect.objectContaining({ country: "AU" }),
    }),
  ]);
  // this variant filters internally; a second execution environment confuses it
  expect(tools.some((t: { type: string }) => t.type.startsWith("code_execution"))).toBe(false);
});

it("bounds what one press can spend", async () => {
  const { client, create } = fakeClient([answer(VALUATIONS)]);
  await runFleetValuation([VAN], client);
  expect(create.mock.calls[0][0].tools[0].max_uses).toBeGreaterThan(0);
});

it("resumes a paused turn by appending it and nothing else", async () => {
  const paused = {
    stop_reason: "pause_turn",
    content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: {} }],
  };
  const { client, create } = fakeClient([paused, answer(VALUATIONS)]);

  const res = await runFleetValuation([VAN], client);
  expect(res).toMatchObject({ ok: true, valuations: [{ point: 42000 }] });
  expect(create).toHaveBeenCalledTimes(2);

  // The resume must be the same user turn plus the paused assistant turn. An
  // extra "continue" message would stop the server resuming on its own.
  const resumed = create.mock.calls[1][0].messages;
  expect(resumed).toHaveLength(2);
  expect(resumed[0]).toEqual({ role: "user", content: valuationPrompt([VAN]) });
  expect(resumed[1]).toEqual({ role: "assistant", content: paused.content });
});

it("gives up rather than resuming forever", async () => {
  const paused = { stop_reason: "pause_turn", content: [] };
  const { client, create } = fakeClient(Array.from({ length: 12 }, () => paused));

  const res = await runFleetValuation([VAN], client);
  expect(res).toMatchObject({ ok: false });
  expect(create.mock.calls.length).toBeLessThanOrEqual(6);
});

it("does not claim a market check when the search failed", async () => {
  // a failed web search is HTTP 200 with an error OBJECT where results go
  const failed = {
    stop_reason: "end_turn",
    content: [
      { type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
      { type: "text", text: VALUATIONS },
    ],
  };
  const { client } = fakeClient([failed]);
  const res = await runFleetValuation([VAN], client);
  expect(res).toMatchObject({ ok: true, searched: false });
});

it("reports a market check when results actually came back", async () => {
  const ok = {
    stop_reason: "end_turn",
    content: [
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://example.com" }] },
      { type: "text", text: VALUATIONS },
    ],
  };
  const { client } = fakeClient([ok]);
  const res = await runFleetValuation([VAN], client);
  expect(res).toMatchObject({ ok: true, searched: true });
});

it("reads the success/error shape directly", () => {
  const arr = [{ type: "web_search_tool_result", content: [] }] as unknown as Anthropic.ContentBlock[];
  const obj = [{ type: "web_search_tool_result", content: { error_code: "x" } }] as unknown as Anthropic.ContentBlock[];
  expect(anySearchSucceeded(arr)).toBe(true);
  expect(anySearchSucceeded(obj)).toBe(false);
});

it("surfaces a refusal instead of returning empty valuations", async () => {
  const { client } = fakeClient([{ stop_reason: "refusal", content: [] }]);
  expect(await runFleetValuation([VAN], client)).toMatchObject({ ok: false });
});

it("tells the model to say what it priced against, and to admit an empty search", () => {
  const p = valuationPrompt([VAN]);
  expect(p).toMatch(/priced it against/);
  expect(p).toMatch(/no live listings found/);
});
