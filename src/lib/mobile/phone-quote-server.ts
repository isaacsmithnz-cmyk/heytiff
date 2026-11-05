import "server-only";

import { quoteSendOffered, sendQuoteToSm8 } from "@/app/actions/quote-sm8";
import { GET as linesGet, POST as linesPost } from "@/app/api/workboard/quote-lines/route";
import { GET as lookupGet } from "@/app/api/workboard/quote-lookup/route";
import { GET as priceGet } from "@/app/api/workboard/quote-price/route";
import { GET as sendGet } from "@/app/api/workboard/quote-send/route";
import { GET as talkGet } from "@/app/api/workboard/quote-session/route";
import { readEngine, type LineChange } from "@/lib/quotes/lines-server";
import type { QuoteLine } from "@/lib/quotes/lines";
import type { BookHit } from "@/lib/quotes/lookups";
import { namedUnit, unitRoleOf } from "@/lib/quotes/unit-name";
import type { QuotePrice } from "@/lib/quotes/quote-price-server";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { actAsPhoneUser, type MobileCtx } from "./auth";
import { doingOf, openQuestions, phoneQuoteOf, phoneTurns, type LinesView, type QuestionPrices, type Thread } from "./phone-quote";

/* The phone's quote, read and pressed through the web's own routes as the token's
   person, so the same gates, the same money taken out and the same figures. */

const ask = (path: string, job: string, more = "") => new Request(`https://phone.local${path}?job=${encodeURIComponent(job)}${more}`);
const say = (path: string, body: Record<string, unknown>) => new Request(`https://phone.local${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** A web route's answer as the phone reads answers: `error` in words when it says no. */
export async function asPhone(r: Response): Promise<Response> {
  const body = (await r.json().catch(() => null)) as { ok?: boolean; reason?: string; error?: string } | null;
  if (r.ok && body?.ok !== false) return Response.json(body, { headers: { "cache-control": "no-store" } });
  return Response.json({ error: body?.reason ?? body?.error ?? "That didn't go through. Try again." }, { status: r.ok ? 409 : r.status, headers: { "cache-control": "no-store" } });
}

type TalkAnswer = { on?: boolean; working?: boolean; events: Thread[]; names?: Record<string, string>; me?: string; questions?: QuestionPrices };

export async function readPhoneQuote(ctx: MobileCtx, id: string) {
  return actAsPhoneUser(ctx, async () => {
    const { parentRemoteId: job } = await resolveJobCard(ctx.orgId, id);
    const [viewed, talked] = await Promise.all([
      linesGet(ask("/api/workboard/quote-lines", job)).then((r) => (r.ok ? (r.json() as Promise<LinesView & { names?: Record<string, string> }>) : null)),
      talkGet(ask("/api/workboard/quote-session", job, "&questions=1")).then((r) => (r.ok ? (r.json() as Promise<TalkAnswer>) : null)),
    ]);
    if (!viewed) return null;
    const price =
      viewed.money && viewed.lines.length > 0
        ? await priceGet(ask("/api/workboard/quote-price", job)).then(async (r) => (r.ok ? ((await r.json()) as { price: QuotePrice }).price : null))
        : null;
    const events = talked?.events ?? [];
    const names = { ...viewed.names, ...talked?.names };
    const working = talked?.working === true;
    const asked = openQuestions(events, talked?.questions);
    const quote = phoneQuoteOf(viewed, price, events, asked.length, working, names);
    /* what Send to ServiceM8 needs, read for the quote as it now stands */
    let send = null;
    if (quote.approved && ctx.caps.has("workboard_manage") && ctx.caps.has("financials")) {
      const [offer, plan] = await Promise.all([
        quoteSendOffered(),
        sendGet(ask("/api/workboard/quote-send", job, "&as=quote")).then((r) => (r.ok ? (r.json() as Promise<{ editDate: string | null; key: string }>) : null)),
      ]);
      send = { offered: offer.offered, trial: offer.trial, held: offer.held ?? null, ready: !!plan };
    }
    return {
      ...quote,
      on: talked?.on === true,
      working,
      doing: doingOf(events),
      talked: events.length > 0,
      turns: phoneTurns(events, names, talked?.me ?? ctx.userId),
      asked,
      send,
      manage: ctx.caps.has("workboard_manage"),
    };
  });
}

/** While she works, the conversation and how far along, read again every few seconds. */
export function readPhoneTalk(ctx: MobileCtx, id: string) {
  return actAsPhoneUser(ctx, async () => {
    const r = await talkGet(ask("/api/workboard/quote-session", id));
    if (!r.ok) return asPhone(r);
    const t = (await r.json()) as TalkAnswer;
    const events = t.events ?? [];
    return Response.json({ working: t.working === true, doing: doingOf(events), turns: phoneTurns(events, t.names ?? {}, t.me ?? ctx.userId) }, { headers: { "cache-control": "no-store" } });
  });
}

/** What she'd read before building, each one to untick. */
export function readPhoneSources(ctx: MobileCtx, id: string) {
  return actAsPhoneUser(ctx, async () => {
    const r = await talkGet(ask("/api/workboard/quote-session", id, "&sources=1"));
    if (!r.ok) return asPhone(r);
    const t = (await r.json()) as { sources: { id: string; label: string; text: string }[] };
    return Response.json({ sources: t.sources.map((s) => ({ id: s.id, label: s.label, text: s.text.replace(/\s+/g, " ").trim().slice(0, 120) })) }, { headers: { "cache-control": "no-store" } });
  });
}

/** Mark ready to send, its Undo, or Customer accepted: the web's own press. */
export function pressQuote(ctx: MobileCtx, id: string, body: { op: "approve" } | { op: "unapprove" } | { op: "accept"; option: number }) {
  return actAsPhoneUser(ctx, async () => {
    const r = await linesPost(say("/api/workboard/quote-lines", { job: id, ...body }));
    const a = (await r.json().catch(() => null)) as { ok?: boolean; reason?: string } | null;
    if (r.ok && a?.ok !== false) return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
    return Response.json({ error: a?.reason ?? "That didn't go through. Try again." }, { status: r.ok ? 409 : r.status, headers: { "cache-control": "no-store" } });
  });
}

/** Tiff builds on the quote's lines, so a quote still on the old engine moves over first, as the web's quote screen moves it when it opens. Call it as the person. */
export async function putOnLines(ctx: MobileCtx, job: string): Promise<void> {
  if ((await readEngine(ctx.orgId, job)) !== "lines") await linesPost(say("/api/workboard/quote-lines", { job, op: "switch", engine: "lines" }));
}

/** Send to ServiceM8, the plan read fresh so what goes is the quote as it stands. */
export function sendPhoneQuote(ctx: MobileCtx, id: string) {
  return actAsPhoneUser(ctx, async () => {
    const { parentRemoteId: job } = await resolveJobCard(ctx.orgId, id);
    const seen = await sendGet(ask("/api/workboard/quote-send", job, "&as=quote"));
    if (!seen.ok) return asPhone(seen);
    const plan = (await seen.json()) as { editDate: string | null; key: string };
    const a = await sendQuoteToSm8(job, crypto.randomUUID(), plan.editDate, plan.key, "quote");
    return a.ok ? Response.json(a, { headers: { "cache-control": "no-store" } }) : Response.json({ error: a.error }, { status: 409, headers: { "cache-control": "no-store" } });
  });
}

/* A LINE CHANGED FROM THE PHONE (Isaac, 6 November 2026, on 3054: "Need to be
   able to remove line items, swap them out etc on web and mobile"; the mock
   https://claude.ai/artifact/1RAW4dd7ik8Ei8th7p7KYe). Each line is the web's
   own change, one at a time against the version the phone read it at, so the
   same gates and the same history; what comes back is each change's id, for
   the toast's Undo. */

/** A line as the phone names it: which, and the version it read. */
export type PhoneLineRef = { id: string; version: number };
/** One from the book, as the phone picked it. */
export type PhonePick = { name: string; code: string; supplierKey: string; cents: number; unit: boolean };
export type PhoneLineOp =
  | { op: "remove"; lines: PhoneLineRef[] }
  | { op: "price"; lines: PhoneLineRef[]; costCents: number | null; qty: number | null }
  | { op: "swap"; lines: PhoneLineRef[]; pick: PhonePick }
  | { op: "undo"; changes: number[] };

const no = (error: string, status = 409) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

/** The body the phone sent, made safe; null when it isn't one of these. */
export function phoneLineOpOf(body: Record<string, unknown> | null): PhoneLineOp | null {
  if (!body) return null;
  const refs = Array.isArray(body.lines)
    ? body.lines
        .filter((r): r is { id: string; version: number } => !!r && typeof r === "object" && typeof (r as { id?: unknown }).id === "string" && typeof (r as { version?: unknown }).version === "number")
        .slice(0, 20)
        .map((r) => ({ id: r.id.slice(0, 80), version: r.version }))
    : [];
  const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null);
  if (body.op === "line-undo") {
    const changes = Array.isArray(body.changes) ? body.changes.filter((c): c is number => typeof c === "number" && Number.isInteger(c)).slice(0, 20) : [];
    return changes.length ? { op: "undo", changes } : null;
  }
  if (refs.length === 0) return null;
  if (body.op === "line-remove") return { op: "remove", lines: refs };
  if (body.op === "line-price") {
    const costCents = num(body.costCents, 100_000_000);
    const qty = num(body.qty, 100_000);
    return costCents === null && qty === null ? null : { op: "price", lines: refs, costCents, qty };
  }
  if (body.op === "line-swap" && body.pick && typeof body.pick === "object") {
    const p = body.pick as Record<string, unknown>;
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const pick = { name: str(p.name, 200), code: str(p.code, 80), supplierKey: str(p.supplierKey, 80), cents: num(p.cents, 100_000_000) ?? -1, unit: p.unit === true };
    return pick.name && pick.code && pick.supplierKey && pick.cents >= 0 ? { op: "swap", lines: refs, pick } : null;
  }
  return null;
}

/** What a swap puts on a line: a unit for a unit stays named by what it is, in the room it was, as the web swaps it. */
export function swapPatch(line: Pick<QuoteLine, "name" | "kind" | "source">, pick: PhonePick) {
  return {
    name: line.kind === "unit" && pick.unit ? namedUnit(unitRoleOf(null, { name: pick.name, code: pick.code }, { name: line.name }), line.name, pick.name) : pick.name,
    code: pick.code,
    supplierKey: pick.supplierKey,
    costCents: pick.cents,
    sellCents: null,
    ...(line.source === "unknown" ? { source: "by_hand" as const } : {}),
  };
}

export function changePhoneLines(ctx: MobileCtx, id: string, op: PhoneLineOp) {
  return actAsPhoneUser(ctx, async () => {
    const { parentRemoteId: job } = await resolveJobCard(ctx.orgId, id);
    const post = async (body: Record<string, unknown>) => {
      const r = await linesPost(say("/api/workboard/quote-lines", { job, ...body }));
      const a = (await r.json().catch(() => null)) as { ok?: boolean; reason?: string; changes?: LineChange[]; lines?: QuoteLine[] } | null;
      return r.ok && a?.ok !== false ? { ok: true as const, changes: a?.changes ?? [] } : { ok: false as const, reason: a?.reason ?? "That didn't go through. Try again.", status: r.ok ? 409 : r.status };
    };
    if (op.op === "undo") {
      for (const change of op.changes) {
        const a = await post({ op: "undo", change });
        if (!a.ok) return no(a.reason, a.status);
      }
      return Response.json({ ok: true, undo: [] }, { headers: { "cache-control": "no-store" } });
    }
    /* the lines as they stand, for a swap's names */
    let now: QuoteLine[] = [];
    if (op.op === "swap") {
      const r = await linesGet(ask("/api/workboard/quote-lines", job));
      now = r.ok ? (((await r.json()) as { lines?: QuoteLine[] }).lines ?? []) : [];
    }
    const undo: number[] = [];
    for (const ref of op.lines) {
      const body =
        op.op === "remove"
          ? { op: "remove", id: ref.id, version: ref.version }
          : op.op === "price"
            ? { op: "change", id: ref.id, version: ref.version, patch: { ...(op.costCents !== null ? { costCents: op.costCents } : {}), ...(op.qty !== null ? { qty: op.qty } : {}) } }
            : (() => {
                const line = now.find((l) => l.id === ref.id);
                return line ? { op: "change", id: ref.id, version: ref.version, patch: swapPatch(line, op.pick), why: "Select preferred item" } : null;
              })();
      if (!body) return no("That line has changed. Pull down to read the quote again.");
      const a = await post(body);
      if (!a.ok) return no(undo.length ? `${a.reason} The others changed.` : a.reason, a.status);
      const c = a.changes.find((x) => x.lineId === ref.id);
      if (c) undo.push(c.id);
    }
    return Response.json({ ok: true, undo: undo.reverse() }, { headers: { "cache-control": "no-store" } });
  });
}

/** The book searched for a swap, as the web's pick list searches it: each item at the price it would be bought at, from its preferred supplier else the cheapest. */
export function phoneLookup(ctx: MobileCtx, q: string, size: number | null) {
  return actAsPhoneUser(ctx, async () => {
    const r = await lookupGet(new Request(`https://phone.local/api/workboard/quote-lookup?q=${encodeURIComponent(q)}${size ? `&size=${size}` : ""}`));
    if (!r.ok) return asPhone(r);
    const a = (await r.json()) as { hits?: BookHit[] };
    const hits = (a.hits ?? []).flatMap((h) => {
      const o = h.product.preferred ?? h.product.cheapest;
      return o ? [{ key: h.product.key, name: h.product.name, code: o.code, supplierKey: o.supplierKey, supplierName: o.supplierName, cents: o.netCents, unit: h.product.category === "units", why: h.why }] : [];
    });
    return Response.json({ hits: hits.slice(0, 30) }, { headers: { "cache-control": "no-store" } });
  });
}
