"use client";

import { useCallback, useEffect, useState } from "react";
import type { Offer } from "@/lib/quotes/price-book";
import { basketOptions } from "@/lib/quotes/basket";

/* WHAT A UNIT COSTS, AND FROM WHOM — the unit browser's buy prices.

   Every pack model's price at each supplier, through the order code it is
   linked to in Admin → Quoting (AAD's net prices, Mitsubishi's list less
   the business's discount, and what Mitsubishi last invoiced). A unit is
   bought from its LOWEST supplier by default (Isaac, 2026-09-30); pressing
   another supplier's price overrides it, and Use lowest goes back. Read
   once per page. A person without money access gets nothing back and the
   browser shows no prices at all; a model whose order code is still to be
   confirmed says so rather than showing a guess. */

export type UnitPrice = {
  code: string | null;
  /** cheapest first */
  offers: Offer[];
  cheapest: Offer | null;
  savesCents: number | null;
  /** the supplier it's bought from: the cheapest, or a person's override */
  chosen: Offer | null;
  overridden: boolean;
  features: string[];
  /** its order code is still to be confirmed in Quoting */
  proposed: boolean;
};

export type UnitPrices = Map<string, UnitPrice>;

const ROUTE = "/api/quoting/unit-prices";
let cache: Promise<UnitPrices | null> | null = null;

function load(): Promise<UnitPrices | null> {
  /* no fetch (a test's page, an old browser): no prices, nothing breaks */
  if (typeof fetch !== "function") return Promise.resolve(null);
  cache ??= fetch(ROUTE)
    .then(async (r) => {
      if (!r.ok) return null;
      const a = (await r.json()) as { ok: boolean; prices?: Record<string, UnitPrice> };
      return a.ok && a.prices ? new Map(Object.entries(a.prices)) : null;
    })
    .catch(() => null);
  return cache;
}

/** The buy prices (null while loading and for anyone without access), and
    a way to override a unit's supplier or (null) go back to the lowest. */
export function useUnitPrices(
  enabled = true
): [UnitPrices | null, (model: string, supplierKey: string | null) => Promise<void>] {
  const [prices, setPrices] = useState<UnitPrices | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void load().then((p) => live && setPrices(p));
    return () => {
      live = false;
    };
  }, [enabled]);
  const choose = useCallback(async (model: string, supplierKey: string | null) => {
    const r = await fetch(ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, supplierKey }),
    }).catch(() => null);
    if (!r?.ok) return;
    cache = null;
    setPrices(await load());
  }, []);
  return [prices, choose];
}

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const $ = (cents: number) => money.format(cents / 100);

/** A pairing's total: each unit from the supplier it's bought from. */
export function pairFromCents(prices: UnitPrices, models: string[]): number | null {
  let sum = 0;
  for (const m of models) {
    const c = prices.get(m)?.chosen?.netCents ?? null;
    if (c == null) return null;
    sum += c;
  }
  if (models.length < 2) return sum;
  /* a pair comes from one supplier (Isaac, 2026-10-05): the one chosen for
     a unit when it has them all, else the cheapest that has them all; each
     unit's own only when no one supplier has them all */
  const totalAt = (key: string): number | null => {
    let t = 0;
    for (const m of models) {
      const o = prices.get(m)?.offers.find((x) => x.supplierKey === key && x.netCents > 0);
      if (!o) return null;
      t += o.netCents;
    }
    return t;
  };
  const chosen = models.map((m) => prices.get(m)).find((p) => p?.overridden)?.chosen?.supplierKey;
  const atChosen = chosen ? totalAt(chosen) : null;
  if (atChosen != null) return atChosen;
  const keys = new Set(models.flatMap((m) => prices.get(m)?.offers.map((o) => o.supplierKey) ?? []));
  const totals = [...keys].map(totalAt).filter((t): t is number => t != null);
  return totals.length > 0 ? Math.min(...totals) : sum;
}

/** The selected unit's buy prices: each model at every supplier, grouped
    under the model, the lowest marked, the one it's bought from pressed. */
export function BuyPrices({
  prices,
  models,
  onChoose,
}: {
  prices: UnitPrices;
  models: { model: string; role: string }[];
  onChoose?: (model: string, supplierKey: string | null) => void;
}) {
  /* the pair bought together: from one supplier that has both, cheapest
     first, with what each costs over it; each at its lowest only when no one
     supplier has both */
  const options =
    models.length > 1
      ? basketOptions(
          models.map(({ model }) => ({
            key: model,
            qty: 1,
            offers: (prices.get(model)?.offers ?? []).map((o) => ({
              supplierKey: o.supplierKey,
              supplierName: o.supplierName,
              cents: o.netCents,
            })),
          })),
          { together: true }
        )
      : [];
  const pickOption = (picks: Record<string, string>) => {
    for (const { model } of models) {
      const p = prices.get(model);
      const want = picks[model];
      if (!p || !want) continue;
      /* the lowest supplier is no override at all */
      const next = p.offers[0]?.supplierKey === want ? null : want;
      if ((p.overridden ? p.chosen?.supplierKey : null) !== next) onChoose?.(model, next);
    }
  };
  const current = (picks: Record<string, string>) =>
    models.every(({ model }) => !picks[model] || prices.get(model)?.chosen?.supplierKey === picks[model]);

  return (
    <section className="ds-ub-buy" aria-label="Buy prices">
      <h4>Buy price</h4>
      {/* one supplier for the pair is worth a press even when it's the only one */}
      {(options.length > 1 || options[0]?.kind === "supplier") && (
        <div className="ds-ub-basket" role="group" aria-label="Buy the pair">
          {options.map((o) => {
            const on = current(o.picks);
            return (
              <button
                type="button"
                key={o.label}
                className={`ds-ub-offer${o.overCents === 0 ? " ok" : ""}${on ? " on" : ""}`}
                aria-pressed={on}
                disabled={!onChoose || on}
                onClick={() => pickOption(o.picks)}
              >
                <em>{o.label}</em>
                {$(o.totalCents)}
                {o.overCents > 0 && <span className="ds-ub-over">{`+${$(o.overCents)}`}</span>}
              </button>
            );
          })}
        </div>
      )}
      {models.map(({ model, role }) => {
        const p = prices.get(model);
        return (
          <div className="ds-ub-buyrow" key={model}>
            <span className="ds-ub-buyfor">
              {role}
              <em>{p?.code ?? model}</em>
              {p?.chosen && (
                <span className={p.overridden ? "ds-ub-buystate warn" : "ds-ub-buystate"}>
                  {p.overridden ? "Override" : "Lowest price"}
                </span>
              )}
            </span>
            {!p || p.offers.length === 0 ? (
              <span className="ds-ub-buynone">{p?.proposed ? "Order code to confirm in Quoting" : "No price in any price list"}</span>
            ) : (
              <span className="ds-ub-buyoffers">
                {p.offers.map((o, i) => {
                  const on = p.chosen?.supplierKey === o.supplierKey && p.chosen.code === o.code;
                  return (
                    <button
                      type="button"
                      key={`${o.supplierKey}:${o.code}`}
                      className={`ds-ub-offer${p.offers.length > 1 && i === 0 ? " ok" : ""}${on ? " on" : ""}`}
                      aria-pressed={on}
                      disabled={!onChoose || on}
                      aria-label={`Buy ${model} from ${o.supplierName}`}
                      /* the lowest again is going back to the lowest */
                      onClick={() => onChoose?.(model, i === 0 ? null : o.supplierKey)}
                    >
                      <em>{o.supplierName}</em>
                      {$(o.netCents)}
                    </button>
                  );
                })}
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
