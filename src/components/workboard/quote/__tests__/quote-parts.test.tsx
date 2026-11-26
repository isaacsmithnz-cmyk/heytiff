import { renderHook, waitFor } from "@testing-library/react";
import { priceBuildUp } from "@/lib/quotes/buildup";
import type { OptionPrice, QuotePrice } from "@/lib/quotes/quote-price-server";
import { priceState, useQuotePrice } from "../quote-parts";

/* Isaac, 2026-10-04: "Switch it on now"; 2026-10-06: the quote page in
   Home's frame — each option's lines down the page, its price at the top of
   the list on the right */
const settings = { unitMarkupPct: 25, materialMarkupPct: 40, chargeOutCents: 14000, dayHours: 8, contingency: null };
const ap71 = { key: "row-0", group: "Units", name: "MSZ-AP71VGD2", code: "MSZ-AP71VGKD2-A2", supplierKey: "aad", qty: 1, unitBuyCents: 40000, kind: "unit" as const };
const option = (o: Partial<OptionPrice> & Pick<OptionPrice, "build">): OptionPrice => ({ name: "Split", unpriced: [], rows: 1, labourFrom: "brief", ...o });
const one = (o: OptionPrice): QuotePrice => ({ ok: true, options: [o], chargeOutCents: 14000 });

it("reads the price for each version, and nothing without the money grant", async () => {
  const fetchMock = jest.fn(async () => ({ json: async () => ({ ok: true, price: { ok: true, options: [] } }) }));
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
  const { result, rerender } = renderHook(({ v, on }) => useQuotePrice("j-1", on, v), { initialProps: { v: "v1", on: true } });
  await waitFor(() => expect(result.current).toEqual({ ok: true, options: [] }));
  rerender({ v: "v2", on: true });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  rerender({ v: "v2", on: false });
  expect(result.current).toBeUndefined();
});

it("tells the progress line what the price says", () => {
  const build = priceBuildUp([ap71], [{ stage: "Install", people: 1, days: 1 }], settings);
  expect(priceState(undefined)).toEqual({ kind: "hidden" });
  expect(priceState({ ok: false, unset: ["rate"] })).toEqual({ kind: "unset" });
  expect(priceState(one(option({ build: priceBuildUp([], [], settings), rows: 0, labourFrom: "none" })))).toEqual({ kind: "empty" });
  expect(priceState(one(option({ build, unpriced: [{ name: "x", qty: "1", why: "y" }] })))).toEqual({ kind: "priced", left: 1 });
});
