import "server-only";

import { quoteSendOffered, sendQuoteToSm8 } from "@/app/actions/quote-sm8";
import { GET as linesGet, POST as linesPost } from "@/app/api/workboard/quote-lines/route";
import { GET as priceGet } from "@/app/api/workboard/quote-price/route";
import { GET as sendGet } from "@/app/api/workboard/quote-send/route";
import { GET as talkGet } from "@/app/api/workboard/quote-session/route";
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
