/* READY TO SEND: the quotes someone has marked ready, for the office to look
   over and send (Isaac, 5 November 2026: "quotes ready for send ... so that
   someone in the office can look at all of the quotes that were built on the
   road, review them and send them"; the mock https://claude.ai/artifact/ETHPi3KobpjSLS8nAjMXS7,
   built 8 November 2026).

   A quote is ready while its approval stands (approvalStands: nothing on it
   changed after it was marked) and it hasn't gone to ServiceM8 as a quote
   from HeyTiff. Whether ServiceM8 still calls the job a Quote is the list's
   call (jobs-list.ts), from the mirror it already holds.

   Server only. Reads the drafts' approval and the lines' times, nothing else:
   no money, no lines. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { localNow } from "@/lib/integrations/sm8-booking-plan";
import { approvalStands } from "./lines-proposal";
import { namesBySignIn } from "./lines-server";

/** One quote marked ready: when, on the account's own clock
    ("YYYY-MM-DD HH:MM:00"), and the name of whoever marked it. */
export type ReadyQuote = { at: string; by: string | null };

type DraftRow = {
  sm8_job_uuid: string;
  proposal: { approvedAt?: string | null; approvedBy?: string | null; updatedAt?: string | null } | null;
  sent: unknown;
};

/** Sent to ServiceM8 as a quote, not a trial run of it. */
const sentForReal = (sent: unknown) => !!sent && typeof sent === "object" && !(sent as { trial?: unknown }).trial;

/** The drafts whose approval stands and that HeyTiff hasn't sent, by job
    uuid, with who marked each. Pure: the read and the test agree. */
export function readyOf(drafts: readonly DraftRow[], lineTimes: ReadonlyMap<string, readonly string[]>): Map<string, { at: string; by: string | null }> {
  const out = new Map<string, { at: string; by: string | null }>();
  for (const d of drafts) {
    const p = d.proposal;
    if (!p?.approvedAt || sentForReal(d.sent)) continue;
    const proposal = { approvedAt: p.approvedAt, updatedAt: p.updatedAt ?? "" };
    if (!approvalStands(proposal, lineTimes.get(d.sm8_job_uuid) ?? [])) continue;
    out.set(d.sm8_job_uuid, { at: p.approvedAt, by: p.approvedBy ?? null });
  }
  return out;
}

/** An instant as Postgres or JavaScript writes it, as JavaScript does, so the
    two compare as text. */
const isoOf = (s: string) => {
  const t = Date.parse(s.includes("T") ? s : s.replace(" ", "T").replace(/\+00$/, "Z"));
  return Number.isNaN(t) ? s : new Date(t).toISOString();
};

/** Every quote marked ready in the workspace, by job uuid. A read that fails
    is logged and names none: the view is then empty, never wrong. */
export async function readReadyToSend(orgId: string, zone: string | null): Promise<Record<string, ReadyQuote>> {
  const { data, error } = await supabaseAdmin
    .from("quote_drafts")
    .select("sm8_job_uuid, proposal:draft->byHand->proposal, sent:draft->byHand->sent")
    .eq("org_id", orgId)
    .not("draft->byHand->proposal->>approvedAt", "is", null);
  if (error) {
    console.error(`[quotes] couldn't read org ${orgId}'s quotes ready to send:`, error);
    return {};
  }
  const drafts = (data ?? []) as unknown as DraftRow[];
  if (drafts.length === 0) return {};

  const { data: lineRows, error: linesError } = await supabaseAdmin
    .from("quote_lines")
    .select("sm8_job_uuid, updated_at")
    .eq("org_id", orgId)
    .in("sm8_job_uuid", drafts.map((d) => d.sm8_job_uuid));
  if (linesError) {
    console.error(`[quotes] couldn't read the lines of org ${orgId}'s quotes ready to send:`, linesError);
    return {};
  }
  const lineTimes = new Map<string, string[]>();
  for (const l of (lineRows ?? []) as { sm8_job_uuid: string; updated_at: string | null }[]) {
    if (!l.updated_at) continue;
    lineTimes.set(l.sm8_job_uuid, [...(lineTimes.get(l.sm8_job_uuid) ?? []), isoOf(l.updated_at)]);
  }

  const ready = readyOf(drafts, lineTimes);
  const names = await namesBySignIn(orgId, [...ready.values()].map((r) => r.by ?? ""));
  const out: Record<string, ReadyQuote> = {};
  for (const [job, r] of ready) {
    const t = Date.parse(r.at);
    const wall = zone && !Number.isNaN(t) ? localNow(zone, t) : null;
    out[job] = { at: wall ? `${wall.slice(0, 16)}:00` : r.at.slice(0, 16).replace("T", " ") + ":00", by: r.by ? names[r.by] ?? null : null };
  }
  return out;
}
