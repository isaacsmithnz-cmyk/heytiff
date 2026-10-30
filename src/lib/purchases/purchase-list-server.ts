import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { bookSummary, countWord, totalCents, whereItWent, type Purchase } from "./purchase";
import { readPurchase, readPurchases } from "./purchase-server";
import { signOne } from "@/lib/documents/query";

/* TEAM › PURCHASES (Isaac, 29 October 2026: "Any scanned purchase shows up
   here… a van service invoice is attached to the vehicle but also shows in
   purchases"). One list of everything bought with paper behind it: the
   purchases themselves, a van's service with its record, and an expense
   receipt. Each stays where it belongs (its jobs, the van, the person's
   expenses) and shows here too: one record, seen in two places. Fuel is
   left out: a fill is the van's running, not a purchase.

   Before GST where the paper says it; a service or a receipt whose GST
   wasn't read shows its total with GST, and says so. GST IS NEVER DERIVED.
   `financials` reads this (the route gates it). */

export type PurchaseListRow = {
  key: string;
  kind: "purchase" | "service" | "expense";
  /** yyyy-mm-dd */
  date: string;
  supplier: string;
  /** "Invoice 7729 4410", "Service", "Receipt, company card" */
  ref: string;
  boughtBy: string | null;
  wentTo: string;
  /** a second line under where it went: "Two lines to stock" */
  wentNote: string | null;
  /** lines still to put somewhere, which is a look */
  open: number;
  book: { text: string; tone: "or" | "gr" | "q" };
  cents: number | null;
  /** the figure is the total with GST: the GST wasn't on the paper */
  withGst: boolean;
  purchaseId: string | null;
  href: string | null;
};

const LIMIT = 200;

const firstName = (full: string | null) => (full ?? "").trim().split(/\s+/)[0] || null;

export function purchaseRow(p: Purchase): PurchaseListRow {
  const groups = whereItWent(p.lines);
  const jobs = groups.filter((g) => g.wentTo === "job").map((g) => g.label);
  const stock = groups.find((g) => g.wentTo === "stock");
  const open = p.lines.filter((l) => l.wentTo === "open").length;
  const wentTo = jobs.length ? jobs.join(", ") : stock ? "Stock" : "Nowhere yet";
  const wentNote = open
    ? `${countWord(open, "line", "lines")} still to put somewhere`
    : jobs.length && stock
      ? `${countWord(stock.lines, "line", "lines")} to stock`
      : null;
  return {
    key: `p:${p.id}`,
    kind: "purchase",
    date: p.invoiceDate ?? p.createdAt.slice(0, 10),
    supplier: p.supplierName || "A supplier",
    ref: p.invoiceNo ? `Invoice ${p.invoiceNo}` : "Docket",
    boughtBy: p.boughtBy?.name ?? null,
    wentTo,
    wentNote,
    open,
    book: bookSummary(p.lines),
    cents: totalCents(p.lines),
    withGst: false,
    purchaseId: p.id,
    href: null,
  };
}

const cents = (total: number | string | null, gst: number | string | null): { cents: number | null; withGst: boolean } => {
  if (total == null) return { cents: null, withGst: false };
  const t = Number(total);
  if (gst == null) return { cents: Math.round(t * 100), withGst: true };
  return { cents: Math.round((t - Number(gst)) * 100), withGst: false };
};

async function serviceRows(orgId: string): Promise<PurchaseListRow[]> {
  const { data: docs } = await supabaseAdmin
    .from("documents")
    .select("vehicle_log_id")
    .eq("org_id", orgId)
    .eq("kind", "service_record")
    .not("vehicle_log_id", "is", null)
    .not("uploaded_at", "is", null)
    .limit(LIMIT);
  const ids = [...new Set(((docs ?? []) as { vehicle_log_id: string }[]).map((d) => d.vehicle_log_id))];
  if (!ids.length) return [];
  const { data } = await supabaseAdmin
    .from("vehicle_logs")
    .select("id, vehicle_id, staff_profile_id, logged_on, cost, gst, station, note")
    .eq("org_id", orgId)
    .eq("kind", "service")
    .is("deleted_at", null)
    .in("id", ids);
  const logs = (data ?? []) as { id: string; vehicle_id: string; staff_profile_id: string | null; logged_on: string; cost: number | null; gst: number | null; station: string | null; note: string | null }[];
  if (!logs.length) return [];
  const [{ data: vans }, { data: people }] = await Promise.all([
    supabaseAdmin.from("vehicles").select("id, name, make, model, plate").eq("org_id", orgId).in("id", [...new Set(logs.map((l) => l.vehicle_id))]),
    supabaseAdmin.from("staff_profiles").select("id, full_name").eq("org_id", orgId).in("id", [...new Set(logs.map((l) => l.staff_profile_id).filter((v): v is string => !!v))]),
  ]);
  const van = new Map(((vans ?? []) as { id: string; name: string | null; make: string | null; model: string | null; plate: string | null }[]).map((v) => [v.id, [v.model || v.name || v.make, v.plate].filter(Boolean).join(" ") || "A vehicle"]));
  const who = new Map(((people ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name]));
  return logs.map((l) => ({
    key: `s:${l.id}`,
    kind: "service",
    date: l.logged_on,
    supplier: l.station || "A workshop",
    ref: "Service",
    boughtBy: (l.staff_profile_id && who.get(l.staff_profile_id)) || null,
    wentTo: van.get(l.vehicle_id) ?? "A vehicle",
    wentNote: "On the van's service log",
    open: 0,
    book: { text: "Not for the book", tone: "q" },
    ...cents(l.cost, l.gst),
    purchaseId: null,
    href: `/dashboard/vehicles/${l.vehicle_id}`,
  }));
}

async function expenseRows(orgId: string): Promise<PurchaseListRow[]> {
  const { data: docs } = await supabaseAdmin
    .from("documents")
    .select("expense_claim_id")
    .eq("org_id", orgId)
    .eq("kind", "receipt")
    .not("expense_claim_id", "is", null)
    .not("uploaded_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  const ids = [...new Set(((docs ?? []) as { expense_claim_id: string }[]).map((d) => d.expense_claim_id))];
  if (!ids.length) return [];
  const { data } = await supabaseAdmin
    .from("expense_claims")
    .select("id, staff_profile_id, expense_date, description, amount, gst_amount, supplier, paid_with, job_label, status, vehicle_log_id")
    .eq("org_id", orgId)
    .in("id", ids)
    .not("status", "in", "(cancelled,declined)")
    .is("vehicle_log_id", null);
  const claims = (data ?? []) as {
    id: string;
    staff_profile_id: string;
    expense_date: string;
    description: string;
    amount: number;
    gst_amount: number | null;
    supplier: string | null;
    paid_with: string | null;
    job_label: string | null;
  }[];
  if (!claims.length) return [];
  const { data: people } = await supabaseAdmin.from("staff_profiles").select("id, full_name").eq("org_id", orgId).in("id", [...new Set(claims.map((c) => c.staff_profile_id))]);
  const who = new Map(((people ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name]));
  return claims.map((c) => {
    const name = who.get(c.staff_profile_id) ?? null;
    return {
      key: `e:${c.id}`,
      kind: "expense" as const,
      date: c.expense_date,
      supplier: c.supplier || c.description || "A receipt",
      ref: c.paid_with === "company" ? "Receipt, company card" : "Receipt",
      boughtBy: name,
      wentTo: c.job_label || c.description || "Expenses",
      wentNote: firstName(name) ? `In ${firstName(name)}'s expenses too` : "In expenses too",
      open: 0,
      book: { text: "Not for the book", tone: "q" as const },
      ...cents(c.amount, c.gst_amount),
      purchaseId: null,
      href: "/dashboard/team?view=expenses",
    };
  });
}

/** Everything bought with paper behind it, newest first. */
export async function readPurchaseList(orgId: string): Promise<PurchaseListRow[]> {
  const [purchases, services, expenses] = await Promise.all([
    readPurchases(orgId, { limit: LIMIT }),
    serviceRows(orgId).catch(() => []),
    expenseRows(orgId).catch(() => []),
  ]);
  return [...purchases.map(purchaseRow), ...services, ...expenses]
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
    .slice(0, LIMIT);
}

/** The docket behind a purchase, signed for this page, and whether it's a picture. */
export async function docketOf(orgId: string, documentId: string | null): Promise<{ url: string; image: boolean } | null> {
  if (!documentId) return null;
  const { data } = await supabaseAdmin.from("documents").select("storage_ref, mime_type").eq("org_id", orgId).eq("id", documentId).maybeSingle();
  const d = data as { storage_ref: string; mime_type: string } | null;
  const url = d ? await signOne(d.storage_ref) : null;
  return url && d ? { url, image: d.mime_type.startsWith("image/") } : null;
}

export type OpenPurchase = { purchase: Purchase; docket: { url: string; image: boolean } | null };

/** Team's Purchases: the list, and the one the address opens. */
export async function loadPurchasesView(orgId: string, openId: string | null): Promise<{ rows: PurchaseListRow[]; open: OpenPurchase | null }> {
  const [rows, purchase] = await Promise.all([readPurchaseList(orgId), openId ? readPurchase(orgId, openId) : Promise.resolve(null)]);
  return { rows, open: purchase ? { purchase, docket: await docketOf(orgId, purchase.documentId) } : null };
}
