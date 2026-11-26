import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { actAsPhoneUser, type MobileCtx } from "./auth";
import { setupNeeds } from "./setup-needs";
import { looksLikeAName } from "@/lib/staff/name";
import { formatAuDate } from "@/lib/au-dates";
import { formatAbn } from "@/lib/org/settings";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { landSlot, openSlot } from "@/lib/documents/upload-slots";
import { loadMyProfile, saveMyProfileSection, addMyLicence, type SaveResult } from "@/app/actions/profile";
import { skipMyOnboarding } from "@/app/actions/onboarding";
import { saveOrgSection } from "@/app/actions/org";
import { skipOrgSetup } from "@/app/actions/org-setup";
import { createInvite } from "@/app/actions/invite";
import { readStaffLicenceDocument } from "@/app/actions/staff-licence-ai";
import { EMERGENCY_RELATIONSHIPS } from "@/lib/staff/profile";
import { ONBOARDING_LICENCES } from "@/lib/staff/onboarding-licences";

/* THE PHONE'S FIRST RUN, after the first door (lib/mobile/start) has put
   someone in a workspace: the mock's steps, each the web's own save
   (https://claude.ai/artifact/QbyZeRc2drw5FcVWZnySZj, "Yes, build it", 26
   November 2026).

     joining a team      Your details, Emergency contact, Licences, On this phone
     starting a business Set up your business, How customers reach you,
                         Your details, Your team, then You're set up

   EVERY WRITE IS THE WEB'S, run as this person (actAsPhoneUser): the staff
   first run's saveMyProfileSection and stamp, the Organisation screen's
   saveOrgSection, Team's createInvite, the Compliance card's licence add and
   Tiff's licence reader. Nothing here decides who may do what: those actions
   already do, the same way they do on the web. */

export type Setup = {
  /** What the phone still owes this person: the business's steps (an owner of
      a workspace not yet set up) and their own (a card never onboarded). */
  needs: { business: boolean; details: boolean };
  org: string | null;
  role: string | null;
  details: Record<string, string>;
  business: Record<string, string> | null;
  /** The cards a new person is asked for, a photo each. */
  licences: string[];
  relationships: string[];
  /** Team location is on for this business: the phone says so before asking. */
  teamLocation: boolean;
};


const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function readSetup(ctx: MobileCtx): Promise<Setup> {
  const [needs, org, p] = await Promise.all([
    setupNeeds(ctx),
    supabaseAdmin
      .from("organizations")
      .select("trading_name, legal_name, abn, gst_registered, email, phone, address, suburb, state, postcode, live_location")
      .eq("id", ctx.orgId)
      .maybeSingle(),
    actAsPhoneUser(ctx, () => loadMyProfile()).catch(() => null),
  ]);
  const o = (org.data ?? null) as Record<string, unknown> | null;
  const nameish = (v: unknown) => (looksLikeAName(v) ? str(v) : "");
  const card = (p ?? {}) as Record<string, unknown>;
  return {
    needs,
    org: str(o?.trading_name).trim() || null,
    role: ctx.role,
    details: {
      first_name: nameish(card.first_name),
      last_name: nameish(card.last_name),
      preferred_name: str(card.preferred_name),
      birthday: card.birthday ? formatAuDate(str(card.birthday)) : "",
      phone: str(card.phone),
      address: str(card.address),
      emergency_name: str(card.emergency_name),
      emergency_relationship: str(card.emergency_relationship),
      emergency_phone: str(card.emergency_phone),
    },
    business:
      ctx.role === "owner" && o
        ? {
            trading_name: str(o.trading_name),
            legal_name: str(o.legal_name),
            abn: o.abn ? formatAbn(String(o.abn)) : "",
            gst_registered: o.gst_registered === true ? "Yes" : o.gst_registered === false ? "No" : "",
            email: str(o.email),
            phone: str(o.phone),
            address: str(o.address),
            suburb: str(o.suburb),
            state: str(o.state),
            postcode: str(o.postcode),
          }
        : null,
    licences: [...ONBOARDING_LICENCES],
    relationships: [...EMERGENCY_RELATIONSHIPS],
    teamLocation: o?.live_location === true,
  };
}

export { setupNeeds };

export type StepDone = { ok: true; value?: unknown } | { ok: false; status: number; error: string; fields?: string[] };

const fromSave = (r: SaveResult): StepDone => (r.ok ? { ok: true } : { ok: false, status: 400, error: r.error, fields: r.fields });

function pick(from: unknown, keys: readonly string[]): Record<string, string> {
  const o = (from ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of keys) if (typeof o[k] === "string") out[k] = o[k] as string;
  return out;
}

const DETAILS = ["first_name", "last_name", "preferred_name", "birthday", "phone", "address"] as const;
const EMERGENCY = ["emergency_name", "emergency_relationship", "emergency_phone"] as const;
const IDENTITY = ["trading_name", "legal_name", "abn", "gst_registered"] as const;
const CONTACT = ["email", "phone", "address", "suburb", "state", "postcode"] as const;

/** Your details: the name is the one thing the first run insists on. */
async function details(ctx: MobileCtx, body: Record<string, unknown>): Promise<StepDone> {
  const f = pick(body.fields, DETAILS);
  const missing = (["first_name", "last_name"] as const).filter((k) => !(f[k] ?? "").trim());
  if (missing.length) return { ok: false, status: 400, error: "Add your first and last name.", fields: [...missing] };
  return fromSave(await actAsPhoneUser(ctx, () => saveMyProfileSection("personal", f)));
}

async function emergency(ctx: MobileCtx, body: Record<string, unknown>): Promise<StepDone> {
  return fromSave(await actAsPhoneUser(ctx, () => saveMyProfileSection("emergency", pick(body.fields, EMERGENCY))));
}

/** The business's name, ABN and GST: the web's Organisation identity save. */
async function business(ctx: MobileCtx, body: Record<string, unknown>): Promise<StepDone> {
  const f = pick(body.fields, IDENTITY);
  if (!(f.trading_name ?? "").trim()) return { ok: false, status: 400, error: "Give the business a name.", fields: ["trading_name"] };
  return fromSave(await actAsPhoneUser(ctx, () => saveOrgSection("identity", f)));
}

async function contact(ctx: MobileCtx, body: Record<string, unknown>): Promise<StepDone> {
  return fromSave(await actAsPhoneUser(ctx, () => saveOrgSection("contact", pick(body.fields, CONTACT))));
}

/** Your team: one invitation per person, each Team's own (its letter, its
    role rules). Says which ones didn't go, by address. */
async function team(ctx: MobileCtx, body: Record<string, unknown>): Promise<StepDone> {
  const people = Array.isArray(body.people) ? (body.people as unknown[]).slice(0, 20) : [];
  const failed: { email: string; error: string }[] = [];
  let sent = 0;
  for (const raw of people) {
    const p = (raw ?? {}) as Record<string, unknown>;
    const email = str(p.email).trim();
    if (!email) continue;
    const r = await actAsPhoneUser(ctx, () =>
      createInvite({ email, role: p.role === "admin" ? "admin" : "staff", name: str(p.name).trim() || undefined })
    ).catch(() => ({ ok: false as const, error: "Couldn't send that one." }));
    if (r.ok) sent += 1;
    else failed.push({ email, error: "error" in r && typeof r.error === "string" ? r.error : "Couldn't send that one." });
  }
  return { ok: true, value: { sent, failed } };
}

/** The first run is over, finished or skipped: the stamps the web's screens write. */
async function done(ctx: MobileCtx): Promise<StepDone> {
  const needs = await setupNeeds(ctx);
  if (needs.business) {
    const r = await actAsPhoneUser(ctx, () => skipOrgSetup());
    if (!r.ok) return fromSave(r);
  }
  return fromSave(await actAsPhoneUser(ctx, () => skipMyOnboarding()));
}

/* LICENCES: a photo up to storage as your own `licence` document, Tiff's read
   of it, then the Compliance card's own add with what you checked. The same
   three steps a vehicle's paper takes (vehicle-papers.ts). */
async function licenceSlot(ctx: MobileCtx, body: Record<string, unknown>): Promise<StepDone> {
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId);
  if (!staffId) return { ok: false, status: 403, error: "There's no staff card for you here yet." };
  const size = typeof body.sizeBytes === "number" && body.sizeBytes > 0 ? Math.round(body.sizeBytes) : 0;
  const slot = await openSlot(ctx.orgId, staffId, "licence", {
    fileName: str(body.fileName).slice(0, 120) || "licence.jpg",
    mimeType: str(body.mimeType).slice(0, 60) || "image/jpeg",
    sizeBytes: size,
  });
  if (!slot.ok) return { ok: false, status: 400, error: slot.error };
  return { ok: true, value: { documentId: slot.documentId, uploadUrl: slot.signedUrl } };
}

async function licenceLand(ctx: MobileCtx, body: Record<string, unknown>): Promise<StepDone> {
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId);
  if (!staffId) return { ok: false, status: 403, error: "There's no staff card for you here yet." };
  const landed = await landSlot(ctx.orgId, staffId, str(body.documentId));
  return landed.ok ? { ok: true } : { ok: false, status: 400, error: landed.error };
}

/** What Tiff read off the card. A failed read is an empty one, typed by hand. */
async function licenceRead(ctx: MobileCtx, body: Record<string, unknown>): Promise<StepDone> {
  const data = str(body.data);
  if (!data) return { ok: false, status: 400, error: "Take a photo of the card first." };
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId);
  if (!staffId) return { ok: false, status: 403, error: "There's no staff card for you here yet." };
  const r = await actAsPhoneUser(ctx, () => readStaffLicenceDocument(data, str(body.mediaType) || "image/jpeg", staffId)).catch(() => null);
  if (!r || !r.ok) return { ok: true, value: { read: false, fields: {} } };
  const { ok: _ok, ...fields } = r;
  return { ok: true, value: { read: true, fields } };
}

/** Save the licence as checked, with its photo on it. */
async function licenceAdd(ctx: MobileCtx, body: Record<string, unknown>): Promise<StepDone> {
  const typeName = str(body.typeName).trim();
  if (!typeName) return { ok: false, status: 400, error: "Which licence is it?" };
  const f = pick(body.fields, ["number", "issuer", "issuingState", "classes", "startsOn", "expiresOn"]);
  const documentId = str(body.documentId) || null;
  return fromSave(
    await actAsPhoneUser(ctx, () =>
      addMyLicence({ typeName, licenceNumber: f.number }, { ...f, documentId, source: "scan" })
    )
  );
}

export const STEPS = {
  details,
  emergency,
  business,
  contact,
  team,
  done,
  "licence-slot": licenceSlot,
  "licence-land": licenceLand,
  "licence-read": licenceRead,
  "licence-add": licenceAdd,
} as const;
