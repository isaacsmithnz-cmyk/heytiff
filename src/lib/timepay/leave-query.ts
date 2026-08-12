import { supabaseAdmin } from "@/lib/supabase-server";
import { displayNameOf } from "@/lib/staff/name";
import { signMany } from "@/lib/documents/query";
import { shiftDefaultsFor } from "./query";
import { businessDays, certificateExpected } from "./leave";
import type {
  BalanceKind,
  BalanceSource,
  LeaveBalance,
  LeaveCertificate,
  LeaveKind,
  LeaveRequest,
  LeaveStatus,
} from "./leave";
import type { Unavailability } from "./availability";

/* Leave queries. Org-scoped throughout, like the rest of lib/timepay.

   Leave carries no wage, so there is no money projection here — but who
   requested what stays scoped: the *my* screen reads only your own rows, the
   team screen reads the org's. */

const REQUEST_COLUMNS =
  "id, staff_profile_id, kind, start_date, end_date, hours, note, status, review_note, reviewed_by";

function toRequest(r: Record<string, unknown>, name?: (id: string) => string | undefined): LeaveRequest {
  const staffId = String(r.staff_profile_id);
  return {
    id: String(r.id),
    staffId,
    staffName: name?.(staffId),
    kind: r.kind as LeaveKind,
    startDate: String(r.start_date).slice(0, 10),
    endDate: String(r.end_date).slice(0, 10),
    hours: Number(r.hours) || 0,
    note: typeof r.note === "string" && r.note ? r.note : undefined,
    status: r.status as LeaveStatus,
    reviewNote: typeof r.review_note === "string" && r.review_note ? r.review_note : undefined,
    reviewedBy: (r.reviewed_by as string) ?? null,
  };
}

/* THE CERTIFICATE IS THE MOST SENSITIVE THING IN THIS MODULE, and it is
   attached separately rather than joined into `REQUEST_COLUMNS` for exactly
   that reason: a caller has to ASK for it. Leave carries no wage, so the rest
   of this file has no projection to make — this is the one field where who is
   reading matters, and a query that returned it by default would put a
   person's medical certificate into every list that happens to render a leave
   row.

   Two callers are entitled: the person themselves (`myRequests`), and somebody
   holding `approvals`, who is being asked to decide the absence it is evidence
   for. Everyone else gets requests with `certificate` absent — which reads the
   same as "none attached", and is meant to. */
export async function certificatesFor(
  orgId: string,
  requestIds: readonly string[],
): Promise<Map<string, LeaveCertificate>> {
  const out = new Map<string, LeaveCertificate>();
  if (requestIds.length === 0) return out;

  const { data } = await supabaseAdmin
    .from("documents")
    .select("id, leave_request_id, file_name, storage_ref")
    .eq("org_id", orgId)
    .eq("kind", "medical_certificate")
    .in("leave_request_id", [...requestIds]);

  const rows = (data ?? []) as Record<string, unknown>[];
  const signed = await signMany(rows.map((r) => String(r.storage_ref)));
  for (const r of rows) {
    out.set(String(r.leave_request_id), {
      documentId: String(r.id),
      fileName: String(r.file_name),
      url: signed.get(String(r.storage_ref)) ?? null,
    });
  }
  return out;
}

/* Resolve `certExpected` for a batch of rows, through each requester's OWN
   roster. One place, so the person and their approver are told the same thing
   about the same absence — see the field's comment in leave.ts. */
export async function markCertExpected(
  orgId: string,
  rows: LeaveRequest[],
  holidays: Set<string>,
  orgWorkDays: number[],
  certAfterDays: number | null | undefined,
): Promise<LeaveRequest[]> {
  if (certAfterDays == null) return rows;
  const personal = rows.filter((r) => r.kind === "personal");
  if (personal.length === 0) return rows;

  const { workDays } = await shiftDefaultsFor(orgId, [...new Set(personal.map((r) => r.staffId))]);
  return rows.map((r) => {
    if (r.kind !== "personal") return r;
    const days = workDays.get(r.staffId) ?? orgWorkDays;
    const working = businessDays(r.startDate, r.endDate, holidays, days);
    return { ...r, certExpected: certificateExpected(r.kind, working, certAfterDays) };
  });
}

/** Hang certificates onto requests that have one. */
async function withCertificates(orgId: string, rows: LeaveRequest[]): Promise<LeaveRequest[]> {
  // only personal leave ever carries one, so nothing else is worth a lookup
  const ids = rows.filter((r) => r.kind === "personal").map((r) => r.id);
  if (ids.length === 0) return rows;
  const certs = await certificatesFor(orgId, ids);
  return rows.map((r) => (certs.has(r.id) ? { ...r, certificate: certs.get(r.id) } : r));
}

/** Your own leave requests, newest first. */
export async function myRequests(orgId: string, staffProfileId: string): Promise<LeaveRequest[]> {
  const { data } = await supabaseAdmin
    .from("leave_requests")
    .select(REQUEST_COLUMNS)
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffProfileId)
    .order("start_date", { ascending: false });
  // your own certificate is yours to see
  return withCertificates(
    orgId,
    ((data ?? []) as Record<string, unknown>[]).map((r) => toRequest(r)),
  );
}

/** Your entitlements. Missing rows mean "none recorded", not zero-forever — the
    request form treats an absent balance as nothing available. */
export async function myBalances(orgId: string, staffProfileId: string): Promise<LeaveBalance[]> {
  const { data } = await supabaseAdmin
    .from("leave_balances")
    .select("kind, balance_hours, as_at, source, synced_at")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffProfileId);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    kind: r.kind as BalanceKind,
    balanceHours: Number(r.balance_hours) || 0,
    asAt: String(r.as_at).slice(0, 10),
    source: r.source as BalanceSource,
    syncedAt: (r.synced_at as string) ?? null,
  }));
}

/** One person's balances plus their live bookings, for the balance-set screen. */
export async function balancesFor(
  orgId: string,
  staffProfileId: string,
): Promise<{ balances: LeaveBalance[]; requests: LeaveRequest[] }> {
  const [balances, requests] = await Promise.all([
    myBalances(orgId, staffProfileId),
    myRequests(orgId, staffProfileId),
  ]);
  return { balances, requests };
}

async function staffNames(orgId: string): Promise<(id: string) => string | undefined> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, first_name, last_name, full_name, preferred_name")
    .eq("org_id", orgId);
  const map = new Map<string, string>();
  for (const r of data ?? []) map.set(r.id as string, displayNameOf(r));
  return (id: string) => map.get(id);
}

/** Pending requests across the org, oldest first (longest-waiting on top). */
export async function pendingRequests(orgId: string): Promise<LeaveRequest[]> {
  const [{ data }, name] = await Promise.all([
    supabaseAdmin
      .from("leave_requests")
      .select(REQUEST_COLUMNS)
      .eq("org_id", orgId)
      .eq("status", "pending")
      .order("start_date", { ascending: true }),
    staffNames(orgId),
  ]);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => toRequest(r, name));
}

/* ---- unavailability (casuals) ---- */

const UNAVAIL_COLUMNS = "id, staff_profile_id, from_date, to_date, note";

function toBlock(r: Record<string, unknown>, name?: (id: string) => string | undefined): Unavailability {
  const staffId = String(r.staff_profile_id);
  return {
    id: String(r.id),
    staffId,
    staffName: name?.(staffId),
    from: String(r.from_date).slice(0, 10),
    to: String(r.to_date).slice(0, 10),
    note: typeof r.note === "string" && r.note ? r.note : undefined,
  };
}

/** Your own unavailability, soonest first. Tolerant of the table not existing
    yet: an unmigrated workspace simply has nobody marked unavailable. */
export async function myUnavailability(
  orgId: string,
  staffProfileId: string,
): Promise<Unavailability[]> {
  const { data, error } = await supabaseAdmin
    .from("staff_unavailability")
    .select(UNAVAIL_COLUMNS)
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffProfileId)
    .order("from_date");
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map((r) => toBlock(r));
}

/** Everyone's unavailability overlapping a span — for whoever rosters. */
export async function unavailabilityInSpan(
  orgId: string,
  spanStart: string,
  spanEnd: string,
): Promise<Unavailability[]> {
  const [{ data, error }, name] = await Promise.all([
    supabaseAdmin
      .from("staff_unavailability")
      .select(UNAVAIL_COLUMNS)
      .eq("org_id", orgId)
      .lte("from_date", spanEnd)
      .gte("to_date", spanStart),
    staffNames(orgId),
  ]);
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map((r) => toBlock(r, name));
}

/** One person's live (pending or approved) requests intersecting a span — the
    overlap guard at request and approve time. Two live bookings covering the
    same day would each draw the balance while only one could ever land on the
    timesheet. `excludeId` lets an approval skip the request being decided. */
export async function overlappingRequests(
  orgId: string,
  staffProfileId: string,
  spanStart: string,
  spanEnd: string,
  excludeId?: string,
): Promise<{ id: string; status: string; startDate: string; endDate: string }[]> {
  let q = supabaseAdmin
    .from("leave_requests")
    .select("id, status, start_date, end_date")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffProfileId)
    .in("status", ["pending", "approved"])
    .lte("start_date", spanEnd)
    .gte("end_date", spanStart);
  if (excludeId) q = q.neq("id", excludeId);
  const { data } = await q;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    status: String(r.status),
    startDate: String(r.start_date).slice(0, 10),
    endDate: String(r.end_date).slice(0, 10),
  }));
}

/** Approved leave overlapping a date span, for the team calendar. */
export async function approvedInSpan(
  orgId: string,
  spanStart: string,
  spanEnd: string,
): Promise<LeaveRequest[]> {
  const [{ data }, name] = await Promise.all([
    supabaseAdmin
      .from("leave_requests")
      .select(REQUEST_COLUMNS)
      .eq("org_id", orgId)
      .eq("status", "approved")
      .lte("start_date", spanEnd)
      .gte("end_date", spanStart),
    staffNames(orgId),
  ]);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => toRequest(r, name));
}

/** Public-holiday dates for this org + state within a span (for suggested-hours,
    the leave calendar and the timesheet). The calendar is per-org, so it
    reflects the days THIS business closes for. Empty until seeded/entered —
    never guessed. */
export async function holidaysInSpan(
  orgId: string,
  state: string | null,
  spanStart: string,
  spanEnd: string,
): Promise<{ date: string; name: string }[]> {
  if (!state) return [];
  const { data } = await supabaseAdmin
    .from("public_holidays")
    .select("holiday_date, name")
    .eq("org_id", orgId)
    .eq("state", state)
    .eq("suppressed", false)
    .gte("holiday_date", spanStart)
    .lte("holiday_date", spanEnd)
    .order("holiday_date");
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    date: String(r.holiday_date).slice(0, 10),
    name: String(r.name),
  }));
}

async function orgState(orgId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("organizations")
    .select("state")
    .eq("id", orgId)
    .maybeSingle();
  return (data?.state as string) ?? null;
}

export type Holiday = {
  id: string;
  state: string;
  date: string;
  name: string;
  source: string;
  suppressed: boolean;
};

/** Every holiday in the org's calendar from `fromISO` on — the admin manager's
    list. All states, so a multi-state business sees the whole picture.
    Suppressed rows are INCLUDED (the manager lists them under "Removed" with
    a restore); every staff-facing read goes through `holidaysInSpan`, which
    filters them. */
export async function listOrgHolidays(orgId: string, fromISO: string): Promise<Holiday[]> {
  const { data } = await supabaseAdmin
    .from("public_holidays")
    .select("id, state, holiday_date, name, source, suppressed")
    .eq("org_id", orgId)
    .gte("holiday_date", fromISO)
    .order("holiday_date");
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    state: String(r.state),
    date: String(r.holiday_date).slice(0, 10),
    name: String(r.name),
    source: String(r.source),
    suppressed: Boolean(r.suppressed),
  }));
}

/** The state whose holiday calendar applies to a staff member (theirs, else
    the org's). Drives suggested leave hours. Empty staffProfileId → org state. */
export async function stateFor(orgId: string, staffProfileId: string): Promise<string | null> {
  if (!staffProfileId) return orgState(orgId);
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("state")
    .eq("org_id", orgId)
    .eq("id", staffProfileId)
    .maybeSingle();
  return (data?.state as string) ?? (await orgState(orgId));
}
