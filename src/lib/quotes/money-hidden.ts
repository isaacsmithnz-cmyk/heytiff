import type { LineChange } from "./lines-server";
import type { LineFields, QuoteLine } from "./lines";

/* A QUOTE WITHOUT ITS MONEY (Isaac, 2026-10-12: "the quoting section should
   still be accessible. For techs who are quoting a job, but… the money
   visibility can be hidden… So it can still hold a conversation with the
   tech to get all of the correct information. And then anyone with money
   access can review the quote and check the pricing").

   What a person without money access is sent, taken out before it leaves
   the server, never only hidden on the page: a line's cost and sell, a
   change's prices, and every dollar figure in Tiff's thread. Pure. */

/** A dollar figure as people and Tiff write it: "$1,234.56", "-$304.92",
    "+$519.96", "$8k", "$4402.79 ex GST". */
const DOLLARS = /[+\-−]?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM]\b)?/g;

/** Words with every dollar figure taken out. */
export const maskMoney = (text: string) => text.replace(DOLLARS, "$…");

/** A line as a person without money access sees it: its work, never its price. */
export const lineWithoutMoney = (l: QuoteLine): QuoteLine => ({ ...l, costCents: 0, sellCents: null });

const MONEY_FIELDS: (keyof LineFields)[] = ["costCents", "sellCents"];
const withoutPrices = (f: Partial<LineFields> | null) => (f ? (Object.fromEntries(Object.entries(f).filter(([k]) => !MONEY_FIELDS.includes(k as keyof LineFields))) as Partial<LineFields>) : f);

/** The quote's history without its prices; a change that was only a price is gone. */
export function changesWithoutMoney(changes: readonly LineChange[]): LineChange[] {
  return changes.flatMap((c) => {
    const before = withoutPrices(c.before);
    const after = withoutPrices(c.after);
    if (c.action === "change" && after && Object.keys(after).filter((k) => k !== "source").length === 0) return [];
    return [{ ...c, before, after, why: maskMoney(c.why) }];
  });
}

type Ev = { kind: string; body: Record<string, unknown> };

/** Tiff's thread without money: her words and the person's with every
    dollar figure taken out, a tool's line too, and a price from the web
    gone from its event. */
export function threadWithoutMoney<T extends Ev>(events: readonly T[]): T[] {
  return events.map((e) => {
    const body = { ...e.body };
    for (const k of ["text", "said", "question", "why"] as const) if (typeof body[k] === "string") body[k] = maskMoney(body[k] as string);
    if (e.kind === "tool" && body.name === "research_price") delete body.detail;
    if (e.kind === "question" && Array.isArray(body.answers)) body.answers = body.answers.map((a) => (a && typeof a === "object" ? { ...a, label: maskMoney(String((a as { label?: unknown }).label ?? "")) } : a));
    return { ...e, body };
  });
}

/** A change a person without money access may make: its work, never its price. */
export function patchWithoutMoney(patch: unknown): Record<string, unknown> {
  const p = patch && typeof patch === "object" ? { ...(patch as Record<string, unknown>) } : {};
  for (const k of ["costCents", "sellCents", "estimate"]) delete p[k];
  return p;
}

/** What Tiff is told before a person without money access speaks. */
export const NO_MONEY_WORDS =
  "(The person you're talking with doesn't see prices: in what you say to them, give no price, cost, total or difference in dollars; talk about the work. A person with money access reviews the pricing.)";
