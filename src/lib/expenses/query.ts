/* Reading expense claims — server only, org-scoped throughout.

   THE MONEY RULE HERE IS THE OPPOSITE WAY ROUND from timesheets, and worth
   saying out loud: an approver MUST see the amount — that is the whole
   decision they are being asked to make — but must never see a pay rate. That
   holds structurally, because nothing in this module touches staff_profiles'
   wage column at all. It only ever joins a name.

   Receipts are signed per render (the bucket is private), one round trip for
   the whole page rather than per claim. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { displayNameOf } from "@/lib/staff/name";
import { isImage } from "@/lib/documents/files";
import { DOCUMENTS_BUCKET, SIGNED_URL_SECONDS } from "@/lib/documents/query";
import {
  isExpenseCategory,
  isExpenseStatus,
  isJobKind,
  isPaidWith,
  type Claim,
  type JobLink,
} from "./claim";

/* The job a row is against. NO JOIN — `job_label` is a snapshot taken when the
   row was filed, for the reason the migration spells out: this records which
   job the money went on at the time, and most rows now carry one, so resolving
   three tables per read would be both wrong and expensive.

   A half-written link reads as no link rather than as an error. The column
   constraint refuses one, so seeing it here means somebody wrote the table by
   hand, and a row that still has a description and an amount on it is worth
   showing without its job. */
function toJob(row: Record<string, unknown>): JobLink | null {
  const kind = row.job_kind;
  const id = row.job_id;
  if (!isJobKind(kind) || !id) return null;
  return { kind, id: String(id), label: String(row.job_label ?? "") };
}

const COLUMNS =
  "id, staff_profile_id, expense_date, description, category, amount, gst_amount, " +
  "supplier, paid_with, status, review_note, created_at, vehicle_log_id, " +
  "job_kind, job_id, job_label";

/** A claim plus who made it — the review queue needs the name, the person's
    own list already knows. */
export type TeamClaim = Claim & { staffName: string };

function toClaim(row: Record<string, unknown>): Claim | null {
  const category = row.category;
  const status = row.status;
  /* A row whose category, status or payer we don't recognise is a row written
     by something newer than this code. Dropping it beats rendering it wrong —
     and `paid_with` earns its place in that list more than the other two:
     guessing it wrong means showing a claim as settled, or asking for money
     that was never spent. */
  if (!isExpenseCategory(category) || !isExpenseStatus(status)) return null;
  const paidWith = row.paid_with ?? "own";
  if (!isPaidWith(paidWith)) return null;

  return {
    id: String(row.id),
    staffProfileId: String(row.staff_profile_id ?? ""),
    expenseDate: String(row.expense_date ?? "").slice(0, 10),
    description: String(row.description ?? ""),
    category,
    amount: Number(row.amount ?? 0),
    gstAmount: row.gst_amount === null || row.gst_amount === undefined ? null : Number(row.gst_amount),
    supplier: (row.supplier as string | null) ?? null,
    paidWith,
    job: toJob(row),
    status,
    reviewNote: (row.review_note as string | null) ?? null,
    createdAt: String(row.created_at ?? ""),
    /* The id only. `attachFuelSource` fills in the vehicle, because naming it
       costs a join and most claim sets contain no fuel-log claims at all. */
    fuelLog: row.vehicle_log_id ? { vehicleLogId: String(row.vehicle_log_id), vehicle: null } : null,
  };
}

/* Name the vehicle behind any claim that came from a fuel log.

   Two round trips, and only when at least one claim has a log — the common
   case is none, and then this costs nothing. Kept separate from `toClaim` for
   the same reason `attachReceipts` is: the pure row-shaping stays synchronous
   and testable, and the I/O is one deliberate step you can see. */
async function attachFuelSource<T extends Claim>(orgId: string, claims: T[]): Promise<T[]> {
  const logIds = claims.map((c) => c.fuelLog?.vehicleLogId).filter((v): v is string => !!v);
  if (logIds.length === 0) return claims;

  const { data: logs } = await supabaseAdmin
    .from("vehicle_logs")
    .select("id, vehicle_id")
    .eq("org_id", orgId)
    .in("id", logIds);

  const vehicleByLog = new Map(
    ((logs ?? []) as Record<string, unknown>[]).map((r) => [String(r.id), String(r.vehicle_id ?? "")]),
  );
  const vehicleIds = [...new Set([...vehicleByLog.values()].filter(Boolean))];
  if (vehicleIds.length === 0) return claims;

  const { data: vehicles } = await supabaseAdmin
    .from("vehicles")
    .select("id, name, plate")
    .eq("org_id", orgId)
    .in("id", vehicleIds);

  /* The same fallback the fleet register uses — plenty of vehicles are only
     ever known by their plate, and a blank label would be worse than none. */
  const labelById = new Map(
    ((vehicles ?? []) as Record<string, unknown>[]).map((r) => [
      String(r.id),
      String(r.name ?? "").trim() || String(r.plate ?? "").trim() || null,
    ]),
  );

  return claims.map((c) =>
    c.fuelLog
      ? { ...c, fuelLog: { ...c.fuelLog, vehicle: labelById.get(vehicleByLog.get(c.fuelLog.vehicleLogId) ?? "") ?? null } }
      : c,
  );
}

/** Sign every claim's receipts in one round trip.

    ALL of them: a claim can carry up to MAX_RECEIPTS, and the audit found
    this map keyed by claim id — duplicate keys silently overwrote, so an
    approver judging a three-receipt claim saw one receipt and no hint the
    others existed. */
async function attachReceipts(orgId: string, claims: Claim[]): Promise<Claim[]> {
  if (claims.length === 0) return claims;

  const { data } = await supabaseAdmin
    .from("documents")
    .select("expense_claim_id, storage_ref, mime_type")
    .eq("org_id", orgId)
    .in("expense_claim_id", claims.map((c) => c.id))
    .not("uploaded_at", "is", null);

  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return claims;

  const refs = rows.map((r) => String(r.storage_ref)).filter(Boolean);
  const { data: signed } = await supabaseAdmin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrls(refs, SIGNED_URL_SECONDS);

  const urlByRef = new Map((signed ?? []).map((s) => [s.path ?? "", s.signedUrl]));
  const byClaim = new Map<string, { url: string | null; image: boolean }[]>();
  for (const r of rows) {
    const claimId = String(r.expense_claim_id);
    const list = byClaim.get(claimId) ?? [];
    list.push({
      url: urlByRef.get(String(r.storage_ref)) ?? null,
      image: isImage(String(r.mime_type ?? "")),
    });
    byClaim.set(claimId, list);
  }

  return claims.map((c) => ({ ...c, receipts: byClaim.get(c.id) ?? [] }));
}

/** How many claims are waiting on a decision — the dashboard chip's number.
    A head count, deliberately: the full teamClaims read signs every receipt
    in the org to compute two integers, which is exactly what the audit told
    us not to do for a tile. */
export async function pendingClaimsCount(orgId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("expense_claims")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "pending");
  return count ?? 0;
}

/** YOUR claims that came back declined, newest decision first — the dashboard's
    "you were told nothing" chip.

    Four columns and no receipt signing, unlike `myClaims`: this runs on every
    dashboard render to decide whether a chip exists, and signing a bucket URL
    for a receipt nobody is about to look at is exactly the tile-shaped waste
    `pendingClaimsCount` was written to avoid. `since` is an ISO date — the
    caller owns the window (see CLAIM_NUDGE_DAYS), so the SQL and the chip rule
    can't drift into disagreeing about what "recent" means. */
export async function ownDeclinedClaims(
  orgId: string,
  staffProfileId: string,
  since: string,
): Promise<{ id: string; description: string; amount: number; decidedOn: string | null }[]> {
  const { data } = await supabaseAdmin
    .from("expense_claims")
    .select("id, description, amount, reviewed_at")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffProfileId)
    .eq("status", "declined")
    .gte("reviewed_at", since)
    .order("reviewed_at", { ascending: false })
    .limit(20);

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    description: String(r.description ?? ""),
    amount: Number(r.amount ?? 0),
    decidedOn: (r.reviewed_at as string | null) ?? null,
  }));
}

/** One person's own claims, newest first. Intrinsic — no capability. */
export async function myClaims(orgId: string, staffProfileId: string): Promise<Claim[]> {
  const { data } = await supabaseAdmin
    .from("expense_claims")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffProfileId)
    .order("expense_date", { ascending: false });

  // via unknown: the column list is built by concatenation, which Supabase's
  // type parser can't resolve, so it widens `data` to its error shape
  const claims = ((data ?? []) as unknown as Record<string, unknown>[])
    .map(toClaim)
    .filter((c): c is Claim => c !== null);
  return attachFuelSource(orgId, await attachReceipts(orgId, claims));
}

/** Everyone's claims, for the review queue. The CALLER holds the capability —
    this module is org-scoped, not permission-aware, same as lib/timepay. */
export async function teamClaims(orgId: string): Promise<TeamClaim[]> {
  const { data } = await supabaseAdmin
    .from("expense_claims")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .order("expense_date", { ascending: false });

  // via unknown: the column list is built by concatenation, which Supabase's
  // type parser can't resolve, so it widens `data` to its error shape
  const claims = ((data ?? []) as unknown as Record<string, unknown>[])
    .map(toClaim)
    .filter((c): c is Claim => c !== null);

  const withReceipts = await attachFuelSource(orgId, await attachReceipts(orgId, claims));
  const names = await namesFor(orgId, [...new Set(withReceipts.map((c) => c.staffProfileId))]);

  return withReceipts.map((c) => ({ ...c, staffName: names.get(c.staffProfileId) ?? "Unknown" }));
}

/** Names only. No wage column is selected here, and that is the point. */
async function namesFor(orgId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;

  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, first_name, last_name, full_name, preferred_name")
    .eq("org_id", orgId)
    .in("id", ids);

  for (const r of (data ?? []) as Record<string, unknown>[]) {
    out.set(
      String(r.id),
      displayNameOf({
        first_name: (r.first_name as string | null) ?? null,
        last_name: (r.last_name as string | null) ?? null,
        full_name: (r.full_name as string | null) ?? null,
        preferred_name: (r.preferred_name as string | null) ?? null,
      })
    );
  }
  return out;
}
