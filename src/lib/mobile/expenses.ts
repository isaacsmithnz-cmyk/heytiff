import "server-only";

import { addLog } from "@/app/actions/fleet";
import { cancelClaim, submitClaim } from "@/app/actions/expenses";
import { readExpenseReceipt } from "@/app/actions/expense-ai";
import { readFuelReceipt } from "@/app/actions/fleet-ai";
import { todayInAu } from "@/lib/au-dates";
import { CATEGORY_LABEL, STATUS_LABEL, isCancellable, isExpenseCategory, owedTotal, type Claim, type ExpenseCategory } from "@/lib/expenses/claim";
import { myClaims } from "@/lib/expenses/query";
import { getOwnVehicle, listVehiclePicker, staffProfileIdFor } from "@/lib/fleet/query";
import { landSlot, openSlot } from "@/lib/documents/upload-slots";
import { actAsPhoneUser, type MobileCtx } from "@/lib/mobile/auth";
import { costDescription } from "@/lib/workboard/note-cost";
import { choicesOf, type VehicleChoice } from "@/lib/mobile/vehicle-choices";

/* EXPENSE CLAIMS ON THE PHONE (Isaac, 28 October 2026, "Looks good" on
   https://claude.ai/artifact/XaSepXSBuJq5FcAT8ZDE3o): More › Expense claims,
   and Add a receipt, which photographs it, has Tiff read it, and files it
   through the web's own actions, run as the phone's person: the same reader
   (readExpenseReceipt, and the fuel log's for litres and the ABN), the same
   Send claim (submitClaim) and Undo (cancelClaim), and fuel as one record
   on the vehicle (addLog), never a claim beside it. Ungated, as on the web:
   spending your own money on the job is not a privilege.

   THE PHOTO UPLOADS ON SAVE, not on the read, so a receipt read and left
   leaves nothing in the bucket: a slot (openSlot) the phone PUTs the bytes
   to, then land. A claim's paper is `receipt`, the vehicle log's
   `fuel_receipt`, the kind that decides which record may adopt it.

   A SERVICEM8 JOB is named in the claim's words, as the web's form names
   it (costDescription): a claim links only to a project, visit or
   agreement. */

export type PhoneClaim = {
  id: string;
  description: string;
  supplier: string | null;
  expenseDate: string;
  category: ExpenseCategory;
  categoryLabel: string;
  amount: number;
  gstAmount: number | null;
  paidWith: "own" | "company";
  status: Claim["status"];
  statusLabel: string;
  reviewNote: string | null;
  jobLabel: string | null;
  /** raised by a fuel log, and the vehicle's name */
  fromFuel: string | null;
  cancellable: boolean;
  receipts: { url: string | null; image: boolean }[];
};

export type PhoneExpenses = {
  claims: PhoneClaim[];
  owed: number;
  today: string;
  /** the vehicles fuel can go on, yours first */
  vehicles: VehicleChoice[];
  ownVehicleId: string | null;
  /** no staff card: nothing can be filed */
  canFile: boolean;
};

export const phoneClaim = (c: Claim): PhoneClaim => ({
  id: c.id,
  description: c.description,
  supplier: c.supplier,
  expenseDate: c.expenseDate,
  category: c.category,
  categoryLabel: CATEGORY_LABEL[c.category],
  amount: c.amount,
  gstAmount: c.gstAmount,
  paidWith: c.paidWith,
  status: c.status,
  statusLabel: STATUS_LABEL[c.status].replace(" — ", ", "),
  reviewNote: c.reviewNote,
  jobLabel: c.job?.label ?? null,
  fromFuel: c.fuelLog ? (c.fuelLog.vehicle ?? "") : null,
  cancellable: isCancellable(c.status),
  receipts: c.receipts ?? [],
});

export async function readPhoneExpenses(ctx: MobileCtx): Promise<PhoneExpenses> {
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId);
  const [claims, picker, own] = await Promise.all([
    staffId ? myClaims(ctx.orgId, staffId) : Promise.resolve([]),
    listVehiclePicker(ctx.orgId).catch(() => []),
    getOwnVehicle(ctx.orgId, staffId).catch(() => null),
  ]);
  const vehicles = choicesOf(picker, own?.id ?? null);
  return {
    claims: claims.map(phoneClaim),
    owed: owedTotal(claims.filter((c) => c.paidWith === "own")),
    today: todayInAu(),
    vehicles,
    ownVehicleId: own?.id ?? null,
    canFile: !!staffId,
  };
}

type Done<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const bad = (error: string, status = 400): Done<never> => ({ ok: false, status, error });
const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown): number | null => {
  /* "57,912" and "1 121.50" are numbers as people type them */
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(/[,\s$]/g, "")) : NaN;
  return Number.isFinite(n) ? n : null;
};

export type PhoneReceiptRead = {
  read: boolean;
  description: string | null;
  supplier: string | null;
  date: string | null;
  category: ExpenseCategory | null;
  total: number | null;
  gst: number | null;
  litres: number | null;
  abn: string | null;
};

/** Tiff reads the photo into a draft for checking; fuel also through the fuel log's reader. A failed read is an empty draft. */
export async function readPhoneReceipt(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<PhoneReceiptRead>> {
  const data = typeof body.data === "string" ? body.data : "";
  const mediaType = str(body.mediaType, 40) || "image/jpeg";
  if (!data) return bad("Take a photo of the receipt first.");
  const empty: PhoneReceiptRead = { read: false, description: null, supplier: null, date: null, category: null, total: null, gst: null, litres: null, abn: null };
  const res = await actAsPhoneUser(ctx, () => readExpenseReceipt(data, mediaType)).catch(() => null);
  if (!res || !res.ok) return { ok: true, value: empty };
  const draft: PhoneReceiptRead = {
    read: true,
    description: res.description,
    supplier: res.supplier,
    date: res.date,
    category: res.category,
    total: res.total,
    gst: res.gst,
    litres: null,
    abn: null,
  };
  /* a fuel docket, or anything logged as fuel from Your vehicle */
  if (res.category === "fuel" || body.fuel === true) {
    const fuel = await actAsPhoneUser(ctx, () => readFuelReceipt(data, mediaType)).catch(() => null);
    if (fuel?.ok) {
      draft.litres = fuel.litres;
      draft.abn = fuel.abn;
    }
  }
  return { ok: true, value: draft };
}

/** A slot for the receipt's bytes, of the kind its record will adopt. */
export async function receiptSlot(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<{ documentId: string; uploadUrl: string }>> {
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId);
  if (!staffId) return bad("Your account isn't linked to a staff record.", 403);
  /* the kind its record adopts: a claim's receipt, a fill's docket, an issue's photo */
  const kind = body.kind === "fuel_receipt" ? "fuel_receipt" : body.kind === "issue_photo" ? "issue_photo" : "receipt";
  const size = num(body.sizeBytes);
  const slot = await openSlot(ctx.orgId, staffId, kind, {
    fileName: str(body.fileName, 120) || "receipt.jpg",
    mimeType: str(body.mimeType, 60) || "image/jpeg",
    sizeBytes: size && size > 0 ? Math.round(size) : 0,
  });
  if (!slot.ok) return bad(slot.error);
  return { ok: true, value: { documentId: slot.documentId, uploadUrl: slot.signedUrl } };
}

/** The bytes landed. */
export async function landReceipt(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<null>> {
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId);
  if (!staffId) return bad("Your account isn't linked to a staff record.", 403);
  const id = str(body.documentId, 60);
  if (!id) return bad("Which receipt?");
  const landed = await landSlot(ctx.orgId, staffId, id);
  return landed.ok ? { ok: true, value: null } : bad(landed.error);
}

/** Send claim, or Save the receipt: the web's submitClaim, as the phone's person. */
export async function fileClaim(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<{ id: string }>> {
  const whatFor = str(body.description);
  const supplier = str(body.supplier, 120);
  const job = str(body.jobLabel, 160);
  const category = isExpenseCategory(body.category) ? body.category : null;
  if (!category) return bad("Pick what kind of spend it was.");
  if (category === "fuel") return bad("Fuel goes on the vehicle.");
  const amount = num(body.amount);
  const gst = num(body.gstAmount);
  const documentIds = Array.isArray(body.documentIds) ? body.documentIds.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
  const res = await actAsPhoneUser(ctx, () =>
    submitClaim({
      job: null,
      expenseDate: str(body.expenseDate, 10),
      description: job ? costDescription({ whatFor, supplier }, job) : whatFor,
      category,
      amount: amount ?? 0,
      gstAmount: gst,
      supplier: supplier || null,
      paidWith: body.paidWith === "company" ? "company" : "own",
      documentIds,
    }),
  );
  return res.ok ? { ok: true, value: { id: res.id } } : bad(res.error);
}

/** Fuel: one record, on the vehicle, as the web's Log fuel makes it. */
export async function logFuel(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<null>> {
  const vehicleId = str(body.vehicleId, 60);
  if (!vehicleId) return bad("Which vehicle was it for?");
  const odo = num(body.odo);
  const litres = num(body.litres);
  const cost = num(body.cost);
  const gst = num(body.gst);
  const res = await actAsPhoneUser(ctx, () =>
    addLog({
      vehicleId,
      kind: "fuel",
      source: "scan",
      ...(odo !== null ? { odo: Math.round(odo) } : {}),
      ...(litres !== null ? { litres } : {}),
      ...(cost !== null ? { cost } : {}),
      ...(gst !== null ? { gst } : {}),
      ...(str(body.abn, 20) ? { abn: str(body.abn, 20).replace(/\s+/g, "") } : {}),
      ...(str(body.supplier, 120) ? { station: str(body.supplier, 120) } : {}),
      ...(str(body.purchasedOn, 10) ? { purchasedOn: str(body.purchasedOn, 10) } : {}),
      ...(str(body.receiptDocumentId, 60) ? { receiptDocumentId: str(body.receiptDocumentId, 60) } : {}),
      paidWith: body.paidWith === "company" ? "company" : "own",
    }),
  );
  return res.ok ? { ok: true, value: null } : bad(res.error);
}

/** Undo: the claim withdrawn, while nobody has decided. */
export async function undoClaim(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<null>> {
  const id = str(body.id, 60);
  if (!id) return bad("Which claim?");
  const res = await actAsPhoneUser(ctx, () => cancelClaim(id));
  return res.ok ? { ok: true, value: null } : bad(res.error);
}
