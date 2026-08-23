import { supabaseAdmin } from "@/lib/supabase-server";
import { DOCUMENTS_BUCKET, SIGNED_URL_SECONDS } from "@/lib/documents/query";
import { isImage } from "@/lib/documents/files";
import { displayNameOf } from "@/lib/staff/name";
import { fyRange } from "./fy";
import {
  asTaxCategory,
  totalsFor,
  type TaxItem,
  type TaxYear,
} from "./item";

/* The shape and the arithmetic live in ./item, which opens no database — this
   module is only the reads. Re-exported so a caller needs one import, not two. */
export * from "./item";

/* What the business spent, for a financial year, with the paper behind it.

   THIS TABLE DOES NOT EXIST, and that is the design. Every figure here is
   already a row somewhere else — a fuel log, an expense claim — and each one
   already has its own rules about who may create it and who may approve it. A
   `tax_items` table would be a second copy, and a second copy of money facts
   goes out of sync in the one direction nobody notices: quietly, and in June.
   So this module READS. Nothing on the Tax screen can be edited from it,
   because there is nothing on it to edit — you fix a wrong figure where it was
   entered, and this reflects the fix.

   TWO SOURCES, ONE SHAPE. A fuel docket and a hardware-shop receipt are the
   same object to an accountant: a date, a supplier, an amount, a GST
   component, and a document. The differences that matter (which van, which
   staff member) survive as columns; the differences that don't are flattened
   here rather than in the screen.

   WHAT IS DELIBERATELY ABSENT: the business's own bills. Those live in Xero
   and reach the Rate Calculator as overheads — they are already substantiated
   by the accounting system, and mirroring them here would double-count them
   against the accountant's own ledger. This screen is exactly the spend that
   happens on a phone, in a servo or a trade counter, which is the spend that
   otherwise arrives at tax time as a shoebox. */

/* Which rows are business spend.

   `declined` and `cancelled` are excluded, and the distinction is real: a
   declined claim is the business saying "that wasn't ours", which is exactly
   the thing that must not appear in a deduction. `pending` is included and
   flagged — the money left somebody's account whatever happens next.

   `recorded` is a COMPANY-CARD receipt, and it belongs here for the same
   reason company-paid fuel already does: `fuelItems` below reads every fuel
   log regardless of who paid, because a docket captured on a phone is the
   substantiation the bank feed cannot supply. The bills this report leaves to
   Xero are the ones that arrive as invoices and are already substantiated —
   rent, insurance, subscriptions — not the drill somebody bought at a trade
   counter on the way to a job. Excluding it would drop the receipt out of the
   only report that was ever going to look for it. */
const CLAIM_STATUSES = ["pending", "approved", "reimbursed", "recorded"] as const;

export async function taxYear(
  orgId: string,
  fy: number,
  opts: { signReceipts?: boolean } = {},
): Promise<TaxYear> {
  const { start, end } = fyRange(fy);

  const [fuel, claims] = await Promise.all([
    fuelItems(orgId, start, end),
    claimItems(orgId, start, end),
  ]);

  const items = [...fuel.items, ...claims.items].sort(
    // newest first, and stable within a day by supplier so a re-render or a
    // second export can't reorder two same-day rows
    (a, b) => b.date.localeCompare(a.date) || (a.supplier ?? "").localeCompare(b.supplier ?? ""),
  );

  /* The storage refs travel BESIDE the items, never on them. Signing needs the
     object key; the screen must never be handed one — a TaxItem is a client
     prop, and a path into the bucket is not something to ship to a browser
     just because the signing step happened to need it. */
  const refs = new Map([...fuel.refs, ...claims.refs]);
  const withUrls = opts.signReceipts ? await signReceipts(items, refs) : items;
  return { fy, items: withUrls, totals: totalsFor(withUrls) };
}

/** Items plus the storage refs behind them, keyed by TaxItem id. */
type Sourced = { items: TaxItem[]; refs: Map<string, string> };

/* ---------------- fuel ---------------- */

async function fuelItems(orgId: string, start: string, end: string): Promise<Sourced> {
  const { data } = await supabaseAdmin
    .from("vehicle_logs")
    .select("id, vehicle_id, staff_profile_id, logged_on, litres, cost, gst, supplier_abn, station")
    .eq("org_id", orgId)
    .eq("kind", "fuel")
    // a deleted entry is not a deduction — the row is kept for audit, not for
    // the export it was withdrawn from
    .is("deleted_at", null)
    .gte("logged_on", start)
    .lte("logged_on", end)
    // A fill with no cost on it is a fleet fact, not a purchase — it has
    // nothing to deduct and would sit in the export as a $0 line.
    .not("cost", "is", null)
    .gt("cost", 0);

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  if (rows.length === 0) return { items: [], refs: new Map() };

  const [vehicles, staff, receipts] = await Promise.all([
    vehicleLabels(orgId),
    staffNames(orgId),
    receiptsByOwner(orgId, "vehicle_log_id", rows.map((r) => String(r.id))),
  ]);

  const refs = new Map<string, string>();
  const items = rows.map((r) => {
    const id = String(r.id);
    const litres = r.litres === null || r.litres === undefined ? null : Number(r.litres);
    const doc = receipts.get(id);
    if (doc) refs.set(`fuel:${id}`, doc.ref);
    return {
      id: `fuel:${id}`,
      source: "fuel" as const,
      date: String(r.logged_on),
      supplier: (r.station as string | null) ?? null,
      abn: (r.supplier_abn as string | null) ?? null,
      category: "fuel" as const,
      description: litres ? `Fuel — ${litres} L` : "Fuel",
      amount: Number(r.cost),
      gst: r.gst === null || r.gst === undefined ? null : Number(r.gst),
      staffName: staff.get(String(r.staff_profile_id ?? "")) ?? null,
      vehicle: vehicles.get(String(r.vehicle_id)) ?? null,
      receiptUrl: null,
      receiptIsImage: doc?.image ?? false,
      hasReceipt: Boolean(doc),
      provisional: false,
    };
  });
  return { items, refs };
}

/* ---------------- expense claims ---------------- */

/* ONE PURCHASE, ONE LINE. A claim carrying a `vehicle_log_id` is the
   reimbursement half of a fuel log — somebody filled the ute on their own card
   — and that log is ALREADY in this report as a fuel item. Reading both would
   put the same tank in the year's total twice, once as fuel and once as a
   staff expense: exactly the double count lib/documents/files.ts warns about.

   The FUEL LOG is the tax line because it is the fuller record — litres, the
   vehicle, the odometer, the docket's own ABN. The claim is only how the money
   gets back to the person. */
async function claimItems(orgId: string, start: string, end: string): Promise<Sourced> {
  const { data } = await supabaseAdmin
    .from("expense_claims")
    .select("id, staff_profile_id, expense_date, description, category, amount, gst_amount, supplier, status")
    .eq("org_id", orgId)
    .is("vehicle_log_id", null)
    .gte("expense_date", start)
    .lte("expense_date", end)
    .in("status", [...CLAIM_STATUSES]);

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  if (rows.length === 0) return { items: [], refs: new Map() };

  const [staff, receipts] = await Promise.all([
    staffNames(orgId),
    receiptsByOwner(orgId, "expense_claim_id", rows.map((r) => String(r.id))),
  ]);

  const refs = new Map<string, string>();
  const items = rows.map((r) => {
    const id = String(r.id);
    const doc = receipts.get(id);
    if (doc) refs.set(`expense:${id}`, doc.ref);
    return {
      id: `expense:${id}`,
      source: "expense" as const,
      date: String(r.expense_date),
      supplier: (r.supplier as string | null) ?? null,
      // An expense claim has never captured an ABN. Null is the honest answer
      // — the alternative is an empty column that looks like a missing value
      // rather than a field that was never asked for.
      abn: null,
      category: asTaxCategory(r.category),
      description: String(r.description ?? ""),
      amount: Number(r.amount),
      gst: r.gst_amount === null || r.gst_amount === undefined ? null : Number(r.gst_amount),
      staffName: staff.get(String(r.staff_profile_id)) ?? null,
      vehicle: null,
      receiptUrl: null,
      receiptIsImage: doc?.image ?? false,
      hasReceipt: Boolean(doc),
      provisional: r.status === "pending",
    };
  });
  return { items, refs };
}

/* ---------------- shared lookups ---------------- */

/** "FRU397 — Hilux", the way a vehicle is named on a docket line. */
async function vehicleLabels(orgId: string): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin
    .from("vehicles")
    .select("id, name, plate, make, model")
    .eq("org_id", orgId);
  const out = new Map<string, string>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const plate = String(r.plate ?? "");
    const named = String(r.name ?? "") || [r.make, r.model].filter(Boolean).join(" ");
    out.set(String(r.id), [plate, named].filter(Boolean).join(" — "));
  }
  return out;
}

/** Names only. No wage column is selected, same rule as lib/expenses. */
async function staffNames(orgId: string): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, first_name, last_name, full_name, preferred_name")
    .eq("org_id", orgId);
  const out = new Map<string, string>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    out.set(
      String(r.id),
      displayNameOf({
        first_name: (r.first_name as string | null) ?? null,
        last_name: (r.last_name as string | null) ?? null,
        full_name: (r.full_name as string | null) ?? null,
        preferred_name: (r.preferred_name as string | null) ?? null,
      }),
    );
  }
  return out;
}

type ReceiptRef = { ref: string; image: boolean };

/** The confirmed receipt for each owner id, keyed by owner. */
async function receiptsByOwner(
  orgId: string,
  column: "vehicle_log_id" | "expense_claim_id",
  ownerIds: string[],
): Promise<Map<string, ReceiptRef>> {
  const out = new Map<string, ReceiptRef>();
  if (ownerIds.length === 0) return out;

  const { data } = await supabaseAdmin
    .from("documents")
    .select(`${column}, storage_ref, mime_type`)
    .eq("org_id", orgId)
    .in(column, ownerIds)
    .not("uploaded_at", "is", null);

  for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
    const owner = String(r[column]);
    // A claim may carry several pages; the first is the one the row links to,
    // and the screen's job here is "is there paper", not "how many pages".
    if (!out.has(owner)) {
      out.set(owner, { ref: String(r.storage_ref), image: isImage(String(r.mime_type ?? "")) });
    }
  }
  return out;
}

/* Every receipt on the page, signed in ONE round trip, from refs the item
   queries already fetched — asking the documents table a second time would be
   two more round trips to Singapore for rows we just had in hand.

   The bucket is private, so a link is minted per request and expires; nothing
   about a receipt is reachable from a URL somebody kept. */
async function signReceipts(items: TaxItem[], refs: Map<string, string>): Promise<TaxItem[]> {
  if (refs.size === 0) return items;

  const { data: signed } = await supabaseAdmin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrls([...refs.values()], SIGNED_URL_SECONDS);
  const urlByRef = new Map((signed ?? []).map((s) => [s.path ?? "", s.signedUrl]));

  return items.map((i) => {
    const ref = refs.get(i.id);
    return ref ? { ...i, receiptUrl: urlByRef.get(ref) ?? null } : i;
  });
}

