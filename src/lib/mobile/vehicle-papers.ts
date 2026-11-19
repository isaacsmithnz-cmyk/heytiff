import "server-only";

import { addLog, recordRenewal, saveVehicle } from "@/app/actions/fleet";
import { readRegoCertificate, readRenewalDocument, readServiceRecord } from "@/app/actions/fleet-ai";
import { daysUntil, todayInAu } from "@/lib/au-dates";
import { AU_STATES, BODY_TYPES, RENEWAL_DOC_KIND, type RenewalKind, type Vehicle } from "@/components/fleet/logic";
import { landSlot, openSlot } from "@/lib/documents/upload-slots";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { actAsPhoneUser, type MobileCtx } from "@/lib/mobile/auth";
import type { StoredDocument } from "@/lib/documents/query";

/* A VEHICLE'S PAPERS FROM THE PHONE (Isaac, 18 November 2026: "I want to be
   able to add a new vehicle and update vehicle documents on the app, given
   it's the easiest way to take photos of documents", then "Approved, build
   it" to https://claude.ai/artifact/CcpihXhUEykQ6zcwqzdNfw). For whoever
   holds the register (`assets_all`; the route checks it first, and each
   action below checks it again as the web's does).

   Nothing here is new law. Each step is the web's own, run as the phone's
   person: a paper's bytes go up by the signed slot every phone upload uses,
   Tiff reads it with the web's readers (the rego certificate, a renewal, a
   service record), and the save is saveVehicle with its first rego,
   recordRenewal, or addLog's service, each adopting the paper as the web's
   forms do. */

type Done<T> = { ok: true; value: T } | { ok: false; error: string; status: number };
const bad = (error: string, status = 400) => ({ ok: false, error, status }) as const;
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const int = (v: unknown) => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};
const orNull = (v: unknown, max = 200) => str(v, max) || null;
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** The papers a phone may file, each as the document kind its record adopts. */
export const PAPER_KIND = {
  rego: RENEWAL_DOC_KIND.rego,
  insurance: RENEWAL_DOC_KIND.insurance,
  ctp: RENEWAL_DOC_KIND.ctp,
  service: "service_record",
} as const;
export type Paper = keyof typeof PAPER_KIND;
const isPaper = (v: unknown): v is Paper => typeof v === "string" && v in PAPER_KIND;
const isRenewal = (v: unknown): v is RenewalKind => v === "rego" || v === "insurance" || v === "ctp";

/** A slot for a paper's bytes, of the kind its record adopts. */
export async function paperSlot(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<{ documentId: string; uploadUrl: string }>> {
  if (!isPaper(body.paper)) return bad("Which paper is it?");
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId);
  if (!staffId) return bad("Your account isn't linked to a staff record.", 403);
  const size = num(body.sizeBytes);
  const slot = await openSlot(ctx.orgId, staffId, PAPER_KIND[body.paper], {
    fileName: str(body.fileName, 120) || "paper.jpg",
    mimeType: str(body.mimeType, 60) || "image/jpeg",
    sizeBytes: size && size > 0 ? Math.round(size) : 0,
  });
  if (!slot.ok) return bad(slot.error);
  return { ok: true, value: { documentId: slot.documentId, uploadUrl: slot.signedUrl } };
}

/** The bytes landed. */
export async function paperLand(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<null>> {
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId);
  if (!staffId) return bad("Your account isn't linked to a staff record.", 403);
  const id = str(body.documentId, 60);
  if (!id) return bad("Which paper?");
  const landed = await landSlot(ctx.orgId, staffId, id);
  return landed.ok ? { ok: true, value: null } : bad(landed.error);
}

/** What Tiff read off a paper, for checking before it's saved. `read` false is
    an empty draft: the read failed or there's no key, and the rows are typed. */
export type PaperRead = { read: boolean; fields: Record<string, string | number | null> };

/** Tiff reads the photo: `new` is a rego certificate for Add a vehicle; rego,
    insurance and ctp a renewal; service a service record. */
export async function readPaper(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<PaperRead>> {
  const data = typeof body.data === "string" ? body.data : "";
  const mediaType = str(body.mediaType, 40) || "image/jpeg";
  if (!data) return bad("Take a photo of the paper first.");
  const empty: PaperRead = { read: false, fields: {} };
  const what = body.what;
  if (what === "new") {
    const r = await actAsPhoneUser(ctx, () => readRegoCertificate(data, mediaType)).catch(() => null);
    if (!r || !r.ok) return { ok: true, value: empty };
    const { ok: _ok, ...fields } = r;
    return { ok: true, value: { read: true, fields } };
  }
  if (isRenewal(what)) {
    const r = await actAsPhoneUser(ctx, () => readRenewalDocument(data, mediaType, what)).catch(() => null);
    if (!r || !r.ok) return { ok: true, value: empty };
    const { ok: _ok, ...fields } = r;
    return { ok: true, value: { read: true, fields } };
  }
  if (what === "service") {
    const r = await actAsPhoneUser(ctx, () => readServiceRecord(data, mediaType)).catch(() => null);
    if (!r || !r.ok) return { ok: true, value: empty };
    const { ok: _ok, workDone, ...rest } = r;
    return { ok: true, value: { read: true, fields: { ...rest, workDone: workDone.join("\n") || null } } };
  }
  return bad("Which paper is it?");
}

/** Add a vehicle: the web's form's own vehicle, with the rego it arrived with
    filed as its first renewal and the certificate under it. */
export function newVehicle(body: Record<string, unknown>, today: string): Vehicle {
  const bodyType = (BODY_TYPES as readonly string[]).includes(str(body.bodyType)) ? (str(body.bodyType) as Vehicle["bodyType"]) : null;
  const motorised = bodyType !== "trailer";
  const state = str(body.plateState, 3).toUpperCase();
  const odometer = motorised ? Math.max(0, int(body.odometer) ?? 0) : 0;
  const regoExpiry = day(body.regoExpiry);
  return {
    id: "",
    name: str(body.name, 60).toUpperCase(),
    plate: str(body.plate, 12).toUpperCase().replace(/\s+/g, ""),
    plateState: (AU_STATES as readonly string[]).includes(state) ? (state as Vehicle["plateState"]) : null,
    make: str(body.make, 60),
    model: str(body.model, 60),
    year: Math.max(0, int(body.year) ?? 0),
    status: "active",
    odometer,
    assignedTo: orNull(body.assignedTo, 60),
    value: 0,
    purchasePrice: 0,
    purchaseDateDays: 0,
    purchaseSupplier: null,
    purchaseInvoiceNo: null,
    purchaseExGst: null,
    purchaseGst: null,
    purchaseOnRoad: null,
    purchaseDeposit: null,
    purchaseOdometer: null,
    regoDays: regoExpiry ? daysUntil(regoExpiry, today) : null,
    insuranceDays: null,
    ctpDays: null,
    serviceIntervalKm: null,
    lastServiceOdo: odometer,
    serviceIntervalMonths: null,
    lastServiceDays: null,
    serviceDays: null,
    motorised,
    bodyType,
    colour: orNull(body.colour, 40),
    vin: orNull(body.vin, 30)?.toUpperCase() ?? null,
    engineNumber: orNull(body.engineNumber, 30)?.toUpperCase() ?? null,
    engineCapacityCc: motorised ? int(body.engineCapacityCc) : null,
    seating: motorised ? int(body.seating) : null,
    tareKg: int(body.tareKg),
    gvmKg: int(body.gvmKg),
    atmKg: motorised ? null : int(body.atmKg),
    variant: orNull(body.variant, 60),
    regoCustomerNo: orNull(body.regoCustomerNo, 30),
    photoDocumentId: null,
  } as Vehicle;
}

export async function addVehicle(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<{ id: string }>> {
  const today = todayInAu();
  const v = newVehicle(body, today);
  if (!v.plate) return bad("Give the rego plate.");
  if (!v.make) return bad("Give the make.");
  const documentId = orNull(body.documentId, 60);
  const regoExpiry = day(body.regoExpiry);
  if (documentId && !regoExpiry) return bad("The certificate is filed under the first rego, so give its expiry.");
  const res = await actAsPhoneUser(ctx, () =>
    saveVehicle(
      v,
      undefined,
      regoExpiry
        ? {
            kind: "rego",
            expiresOn: regoExpiry,
            startsOn: null,
            provider: orNull(body.regoIssuer, 80),
            premium: num(body.regoPaid),
            termMonths: int(body.regoTerm),
            documentId: documentId ?? undefined,
            source: body.scanned === true ? "scan" : "manual",
          }
        : undefined,
    ),
  );
  return res.ok ? { ok: true, value: { id: res.id } } : bad(res.error);
}

/** A renewal: the web's Renew, with the new paper filed under it. */
export async function renewPaper(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<null>> {
  const vehicleId = str(body.vehicleId, 60);
  if (!vehicleId) return bad("Which vehicle?");
  if (!isRenewal(body.kind)) return bad("Which renewal is it?");
  const expiresOn = day(body.expiresOn);
  if (!expiresOn) return bad("Give the date it runs to.");
  const kind = body.kind;
  const provider = orNull(body.provider, 80);
  if (kind !== "rego" && !provider) return bad(kind === "insurance" ? "Give the insurer." : "Give the insurer of the green slip.");
  const cover = kind === "insurance" && (body.cover === "comprehensive" || body.cover === "third_party_property" || body.cover === "third_party_fire_theft") ? body.cover : null;
  const res = await actAsPhoneUser(ctx, () =>
    recordRenewal({
      vehicleId,
      kind,
      expiresOn,
      startsOn: day(body.startsOn),
      provider,
      premium: num(body.premium),
      documentId: orNull(body.documentId, 60) ?? undefined,
      policyNumber: kind === "rego" ? null : orNull(body.policyNumber, 60),
      cover,
      excess: kind === "insurance" ? num(body.excess) : null,
      termMonths: kind === "insurance" ? null : int(body.termMonths),
      garagingPostcode: kind === "ctp" ? orNull(body.garagingPostcode, 4) : null,
      inspectionOn: kind === "rego" ? day(body.inspectionOn) : null,
      source: body.scanned === true ? "scan" : "manual",
    }),
  );
  return res.ok ? { ok: true, value: null } : bad(res.error);
}

/** A service: the web's Log service, with its record adopted. */
export async function logService(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<null>> {
  const vehicleId = str(body.vehicleId, 60);
  if (!vehicleId) return bad("Which vehicle?");
  const odo = int(body.odo);
  const cost = num(body.cost);
  const gst = num(body.gst);
  const workDone = str(body.workDone, 2000);
  const workshop = str(body.workshop, 120);
  const res = await actAsPhoneUser(ctx, () =>
    addLog({
      vehicleId,
      kind: "service",
      source: body.scanned === true ? "scan" : "manual",
      ...(odo !== null ? { odo } : {}),
      ...(cost !== null ? { cost } : {}),
      ...(gst !== null ? { gst } : {}),
      ...(str(body.abn, 20) ? { abn: str(body.abn, 20).replace(/\s+/g, "") } : {}),
      ...(workshop ? { station: workshop } : {}),
      ...(day(body.servicedOn) ? { purchasedOn: day(body.servicedOn)! } : {}),
      ...(str(body.summary, 200) ? { note: str(body.summary, 200) } : {}),
      ...(workDone ? { workDone } : {}),
      ...(str(body.documentId, 60) ? { receiptDocumentId: str(body.documentId, 60) } : {}),
    }),
  );
  return res.ok ? { ok: true, value: null } : bad(res.error);
}

/* ---- a vehicle's papers, as its page lists them ---- */

const PAPER_WORD: Partial<Record<StoredDocument["kind"], string>> = {
  rego_notice: "Rego certificate",
  insurance_policy: "Insurance policy",
  green_slip: "CTP green slip",
  service_record: "Service record",
  purchase_invoice: "Purchase invoice",
  finance_agreement: "Finance agreement",
};

export type PhonePaper = { id: string; word: string; sub: string; url: string | null; image: boolean; mimeType: string };

const fmtAdded = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `Added ${d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Sydney" })}`;
};

/** The vehicle's own papers, newest first: renewals, services, the purchase.
    Fuel dockets and issue photos stay with their entries. */
export function papersOf(docs: readonly StoredDocument[]): PhonePaper[] {
  return docs
    .filter((d) => PAPER_WORD[d.kind])
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((d) => ({ id: d.id, word: PAPER_WORD[d.kind]!, sub: [fmtAdded(d.createdAt), d.fileName].filter(Boolean).join(" · "), url: d.url, image: d.image, mimeType: d.mimeType }));
}
