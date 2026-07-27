/* Running a drift sweep for one organisation — server side.

   ONE IMPLEMENTATION, TWO CALLERS. The weekly cron uses it, and so does the
   Check pay rates button: the button has just computed the truth, so it may as
   well leave the flag accurate rather than let a schedule catch up hours later.
   Two code paths computing "how many wages differ" would eventually disagree,
   and the disagreement would show as a flag that contradicts the screen under
   it.

   NO SESSION HERE. The cron runs as nobody, so this module takes an orgId and
   is itself the boundary — every caller is responsible for having established
   the right to ask (the route's shared-secret check, or `financials` in the
   action). Nothing in here reads a session, and nothing returns a wage: the
   result is a COUNT. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { listPayrollLinks } from "./links";
import { getOrdinaryPayLine, listEarningsRates, listPayrollEmployees } from "./xero-read";
import { resolveXeroPay, wageDrift, type WageDrift } from "./wage";
import { countDrifting, countUnreadable, needsRecompute, planSweep } from "./drift";

export type SweepResult =
  /** Xero says nothing moved — the cheap outcome, and the usual one. */
  | { kind: "unchanged"; calls: number }
  /** Recomputed; `count` is how many wages now differ. */
  | { kind: "checked"; count: number; calls: number }
  /** Recomputed, but some reads failed. The stored flag was deliberately NOT
      updated — a count missing the failed rows would read as fewer drifts,
      and a transient outage across everyone linked would write zero and take
      the warning down. The old count and cursor stand; next run retries. */
  | { kind: "partial"; count: number; unreadable: number; calls: number }
  /** Nothing to sweep: not connected, no links, or the grant is broken. */
  | { kind: "skipped"; reason: string };

/** Compare every linked person's wage against Xero. Returns the drifts, so the
    interactive caller can render them and the sweep can just count. */
export async function compareWages(
  orgId: string,
  tenantId: string
): Promise<{ drifts: WageDrift[]; byStaff: Map<string, WageDrift>; calls: number } | null> {
  const links = await listPayrollLinks(orgId, tenantId);
  if (links.length === 0) return { drifts: [], byStaff: new Map(), calls: 0 };

  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, hourly_wage")
    .eq("org_id", orgId)
    .in("id", links.map((l) => l.staffProfileId));

  const wageHere = new Map<string, number | null>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const raw = r.hourly_wage;
    wageHere.set(String(r.id), typeof raw === "number" ? raw : raw ? Number(raw) : null);
  }

  // One call for the whole org — it resolves the inherited-rate case.
  const rates = await listEarningsRates(orgId);
  let calls = 1;
  const earningsRates = rates.ok ? rates.data : [];

  const byStaff = new Map<string, WageDrift>();
  const drifts: WageDrift[] = [];
  for (const link of links) {
    const line = await getOrdinaryPayLine(orgId, link.remoteId);
    calls += 1;
    /* One person's read failing must not lose everybody else's answer — but it
       must stay a FAILURE, not become "nothing comparable". The two used to
       collapse together, which silently dropped failed rows out of the count.
       An inherited-rate employee whose org-rates read failed is the same case
       wearing a different call: without the rates list, "couldn't be found"
       would blame Xero's data for our fetch. */
    const drift: WageDrift = !line.ok
      ? { kind: "unreadable" }
      : !rates.ok && (line.data?.calculationType ?? "").toUpperCase() === "USEEARNINGSRATE"
        ? { kind: "unreadable" }
        : wageDrift(wageHere.get(link.staffProfileId) ?? null, resolveXeroPay(line.data, earningsRates));
    byStaff.set(link.staffProfileId, drift);
    drifts.push(drift);
  }

  return { drifts, byStaff, calls };
}

/** Forget what the last sweep found — count AND cursor.

    Called when this workspace changes something the count was computed FROM: a
    linked person's wage edited on their card, a link removed, the active
    tenant switched. The stored rates aren't here to recompute against (a count
    is all we keep, deliberately), so the honest move is silence until the next
    look — the Monday sweep runs a full recompute (null cursor ⇒ full), or
    "Check pay rates" answers immediately. A week of silence beats a week of a
    banner asserting a difference that may no longer exist. */
export async function clearDrift(orgId: string): Promise<void> {
  await supabaseAdmin
    .from("integration_connections")
    .update({ drift_count: null, drift_checked_at: null })
    .eq("org_id", orgId)
    .eq("provider", "xero");
}

/** Record what a sweep found. Count only — see the migration's note on why the
    amounts deliberately don't live here. */
export async function recordDrift(orgId: string, count: number, now = Date.now()): Promise<void> {
  await supabaseAdmin
    .from("integration_connections")
    .update({ drift_count: count, drift_checked_at: new Date(now).toISOString() })
    .eq("org_id", orgId)
    .eq("provider", "xero");
}

/** The scheduled sweep for one organisation.

    The shape that makes this cheap: ask Xero what changed since we last
    looked, and stop there when the answer is nothing. A full comparison
    happens only when something actually moved — see drift.ts for why a change
    triggers a recompute of EVERYONE rather than only the changed. */
export async function sweepOrg(
  orgId: string,
  tenantId: string,
  checkedAt: string | null,
  now = Date.now()
): Promise<SweepResult> {
  const plan = planSweep(checkedAt, now);

  if (plan.kind === "since") {
    const changed = await listPayrollEmployees(orgId, plan.since);
    if (!changed.ok) return { kind: "skipped", reason: changed.error };

    if (!needsRecompute(changed.data.map((e) => e.employeeId))) {
      /* The quiet week: one call, nothing moved. The timestamp still advances
         — that is what keeps the next window short, and it doubles as the
         thing that keeps the 60-day refresh token from ever going idle. */
      await recordDrift(orgId, (await currentCount(orgId)) ?? 0, now);
      return { kind: "unchanged", calls: 1 };
    }
  }

  const compared = await compareWages(orgId, tenantId);
  if (!compared) return { kind: "skipped", reason: "Couldn't read pay rates." };

  const count = countDrifting(compared.drifts);
  const unreadable = countUnreadable(compared.drifts);
  const calls = compared.calls + (plan.kind === "since" ? 1 : 0);

  /* A partial read records nothing: the rows that failed aren't in `count`,
     and writing it would advance the cursor past reads that never happened.
     Leaving the old flag and timestamp means next week's window still covers
     this one, so the retry is automatic. */
  if (unreadable > 0) return { kind: "partial", count, unreadable, calls };

  await recordDrift(orgId, count, now);
  return { kind: "checked", count, calls };
}

/** The count we last stored — kept when a sweep confirms nothing moved, since
    an un-adopted difference is still a difference. */
async function currentCount(orgId: string): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("integration_connections")
    .select("drift_count")
    .eq("org_id", orgId)
    .eq("provider", "xero")
    .maybeSingle();
  const raw = (data as { drift_count?: unknown } | null)?.drift_count;
  return typeof raw === "number" ? raw : null;
}

export type SweepableOrg = { orgId: string; tenantId: string; checkedAt: string | null };

/** Every workspace with a live Xero grant worth sweeping. */
export async function sweepableOrgs(limit: number): Promise<SweepableOrg[]> {
  const { data } = await supabaseAdmin
    .from("integration_connections")
    .select("org_id, tenant_id, drift_checked_at")
    .eq("provider", "xero")
    .eq("status", "connected")
    // Oldest first, so a run that hits its cap still makes progress on the
    // workspaces that have waited longest rather than re-sweeping the same few.
    .order("drift_checked_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  return ((data ?? []) as Record<string, unknown>[])
    .filter((r) => typeof r.tenant_id === "string" && r.tenant_id)
    .map((r) => ({
      orgId: String(r.org_id),
      tenantId: String(r.tenant_id),
      checkedAt: (r.drift_checked_at as string | null) ?? null,
    }));
}
