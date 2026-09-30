"use client";

import { useEffect, useState } from "react";
import type { Offer } from "@/lib/quotes/price-book";

/* WHAT A UNIT COSTS, AND FROM WHOM — the unit browser's buy prices.

   Every pack model's price at each supplier, through the order code it is
   linked to in Admin → Quoting (AAD's net prices, Mitsubishi's list less
   the business's discount, and what Mitsubishi last invoiced). Read once
   per page. A person without money access gets nothing back and the
   browser shows no prices at all; a model whose order code is still to be
   confirmed says so rather than showing a guess. */

export type UnitPrice = {
  code: string | null;
  offers: Offer[];
  cheapest: Offer | null;
  savesCents: number | null;
  features: string[];
  /** its order code is still to be confirmed in Quoting */
  proposed: boolean;
};

export type UnitPrices = Map<string, UnitPrice>;

let cache: Promise<UnitPrices | null> | null = null;

function load(): Promise<UnitPrices | null> {
  /* no fetch (a test's page, an old browser): no prices, nothing breaks */
  if (typeof fetch !== "function") return Promise.resolve(null);
  cache ??= fetch("/api/quoting/unit-prices")
    .then(async (r) => {
      if (!r.ok) return null;
      const a = (await r.json()) as { ok: boolean; prices?: Record<string, UnitPrice> };
      return a.ok && a.prices ? new Map(Object.entries(a.prices)) : null;
    })
    .catch(() => null);
  return cache;
}

/** The buy prices, or null while loading and for anyone without access. */
export function useUnitPrices(enabled = true): UnitPrices | null {
  const [prices, setPrices] = useState<UnitPrices | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void load().then((p) => live && setPrices(p));
    return () => {
      live = false;
    };
  }, [enabled]);
  return prices;
}

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const $ = (cents: number) => money.format(cents / 100);

/** The cheapest a model can be bought for, or null. */
export const lowestCents = (p: UnitPrice | undefined) => p?.cheapest?.netCents ?? null;

/** A pairing's cheapest total: each unit at its own cheapest supplier. */
export function pairFromCents(prices: UnitPrices, models: string[]): number | null {
  let sum = 0;
  for (const m of models) {
    const c = lowestCents(prices.get(m));
    if (c == null) return null;
    sum += c;
  }
  return sum;
}

/** The selected unit's buy prices: each model at every supplier, the
    cheaper marked with how much it saves. */
export function BuyPrices({ prices, models }: { prices: UnitPrices; models: { model: string; role: string }[] }) {
  return (
    <section className="ds-ub-buy" aria-label="Buy prices">
      <h4>Buy price</h4>
      {models.map(({ model, role }) => {
        const p = prices.get(model);
        return (
          <div className="ds-ub-buyrow" key={model}>
            <span className="ds-ub-buyfor">
              {role}
              <em>{p?.code ?? model}</em>
            </span>
            {!p || p.offers.length === 0 ? (
              <span className="ds-ub-buynone">{p?.proposed ? "Order code to confirm in Quoting" : "No price in any price list"}</span>
            ) : (
              <span className="ds-ub-buyoffers">
                {p.offers.map((o, i) => (
                  /* offers come cheapest first */
                  <span key={`${o.supplierKey}:${o.code}`} className={p.offers.length > 1 && i === 0 ? "ds-ub-offer ok" : "ds-ub-offer"}>
                    <em>{o.supplierName}</em>
                    {$(o.netCents)}
                  </span>
                ))}
                {p.cheapest && p.savesCents != null && p.savesCents > 0 && (
                  <span className="ds-ub-saves">{`${p.cheapest.supplierName} is ${$(p.savesCents)} cheaper`}</span>
                )}
              </span>
            )}
          </div>
        );
      })}
    </section>
  );
}

export const moneyText = $;
