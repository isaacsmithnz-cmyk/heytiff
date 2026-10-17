import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { ByHand } from "./lines-job";
import type { QuoteLine } from "./lines";
import { namesBySignIn } from "./lines-server";
import { readQuotePrice } from "./quote-price-server";
import type { QuoteVersion } from "./quote-versions";
import { holding, type SessionHead } from "./session/store-server";
import { landingOf, landingPeople, type QuoteLanding } from "./quote-landing";

/* THE QUOTE TAB'S LANDING, READ (quote-landing.ts says what it is). Given
   what the quote-status route has already read, the rest: who last spoke
   to Tiff on the session and when it began, when an option was marked
   accepted, the names of everyone it mentions, and, for a reader with
   money access only, what each option comes to. Service role, by org; the
   route gates. */

/** "Option 2 accepted", as the quote-lines route marks it in the thread. */
const ACCEPTED = /^Option \d+ accepted$/;

type Ev = { author: string; at: string; body: Record<string, unknown> | null };

/** A read of the thread's events, or none where it fails: the landing says less, never nothing. */
async function listOf(q: PromiseLike<{ data: unknown }>): Promise<Ev[]> {
  try {
    return ((await q).data as Ev[] | null) ?? [];
  } catch {
    return [];
  }
}

export async function readLanding(
  orgId: string,
  jobUuid: string,
  read: { byHand: ByHand; versions: QuoteVersion[]; lines: readonly Pick<QuoteLine, "updatedAt" | "updatedBy">[]; session: SessionHead | null; money: boolean }
): Promise<QuoteLanding> {
  const { session } = read;
  const of = (sessionId: string) => supabaseAdmin.from("quote_session_events").select("author, at, body").eq("org_id", orgId).eq("session_id", sessionId);
  const [first, said, marks, price] = await Promise.all([
    session ? listOf(of(session.id).order("id", { ascending: true }).limit(1)) : [],
    session ? listOf(of(session.id).eq("kind", "message").neq("author", "tiff").order("id", { ascending: false }).limit(1)) : [],
    session && read.byHand.accepted.length ? listOf(of(session.id).eq("kind", "milestone").order("id", { ascending: false }).limit(100)) : [],
    read.money ? readQuotePrice(orgId, jobUuid).catch(() => null) : null,
  ]);
  const lastSaid = said[0] ? { author: said[0].author, at: said[0].at } : null;
  const raw = { byHand: read.byHand, versions: read.versions, lines: read.lines, lastSaid };
  const names = await namesBySignIn(orgId, landingPeople(raw)).catch(() => ({}));
  return landingOf({
    ...raw,
    firstAt: first[0]?.at ?? null,
    working: session ? holding(session, Date.now()) : false,
    acceptedAt: marks.find((m) => ACCEPTED.test(String(m.body?.text ?? "")))?.at ?? null,
    names,
    optionCents: price && price.ok ? price.options.map((o) => o.build.exGstCents) : null,
    money: read.money,
  });
}
