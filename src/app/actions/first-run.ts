"use server";

import { auth0 } from "@/lib/auth0";
import { askForNewInvite, joinInvite, resendConfirm } from "@/lib/mobile/start";
import type { MobileIdentity } from "@/lib/mobile/identity";
import { sessionIdentity } from "@/lib/session-identity";
import { createMyOrg } from "./org-create";
import { saveMyProfileSection, type SaveResult } from "./profile";
import { saveOrgSection } from "./org";
import { skipOrgSetup } from "./org-setup";
import { skipMyOnboarding } from "./onboarding";
import { createInvite } from "./invite";
import { orgSetupPending } from "@/lib/org/query";
import { getDbRole } from "@/lib/permissions-server";

/* THE WEB'S FIRST RUN, AS THE PHONE'S (Isaac, 26 November 2026: "make the web
   first run match the phone"). The same door and the same steps as the phone's
   app/start and app/onboarding, and the same server code under them: the door
   reads and presses lib/mobile/start, and every step is the web's own save.

   WHO IS THE SESSION, and an address counts for an invitation only when Auth0
   says it's verified, exactly as on the phone (lib/mobile/identity). */

const identity = async (): Promise<MobileIdentity | null> => sessionIdentity(await auth0.getSession());

export type DoorResult = { ok: true } | { ok: false; error: string };
const NOT_SIGNED_IN: DoorResult = { ok: false, error: "You're not signed in." };

/** Join: the invitation's own accept, then the session opens on that workspace. */
export async function joinFromStart(id: string): Promise<DoorResult> {
  const who = await identity();
  if (!who) return NOT_SIGNED_IN;
  const r = await joinInvite(who, id);
  if (!r.ok) return { ok: false, error: r.error };
  /* createMyOrg adopts a membership that exists into the session and makes nothing: the one place that writes it */
  return createMyOrg();
}

export async function askFromStart(id: string): Promise<DoorResult> {
  const who = await identity();
  if (!who) return NOT_SIGNED_IN;
  const r = await askForNewInvite(who, id);
  return r.ok ? r : { ok: false, error: r.error };
}

export async function confirmFromStart(): Promise<DoorResult> {
  const who = await identity();
  if (!who) return NOT_SIGNED_IN;
  const r = await resendConfirm(who);
  return r.ok ? r : { ok: false, error: r.error };
}

/** The first run's own steps, by name; each the web's own save. */
export type FirstRunStep = "business" | "contact" | "details" | "emergency";

const pick = (from: Record<string, string> | undefined, keys: readonly string[]) => {
  const out: Record<string, string> = {};
  for (const k of keys) if (typeof from?.[k] === "string") out[k] = from[k]!;
  return out;
};

export async function saveFirstRunStep(step: FirstRunStep, fields: Record<string, string>): Promise<SaveResult> {
  if (step === "business") {
    const f = pick(fields, ["trading_name", "legal_name", "abn", "gst_registered"]);
    if (!(f.trading_name ?? "").trim()) return { ok: false, error: "Give the business a name.", fields: ["trading_name"] };
    return saveOrgSection("identity", f);
  }
  if (step === "contact") return saveOrgSection("contact", pick(fields, ["email", "phone", "address", "suburb", "state", "postcode"]));
  if (step === "details") {
    const f = pick(fields, ["first_name", "last_name", "preferred_name", "birthday", "phone", "address"]);
    const missing = (["first_name", "last_name"] as const).filter((k) => !(f[k] ?? "").trim());
    if (missing.length) return { ok: false, error: "Add your first and last name.", fields: [...missing] };
    return saveMyProfileSection("personal", f);
  }
  if (step === "emergency") return saveMyProfileSection("emergency", pick(fields, ["emergency_name", "emergency_relationship", "emergency_phone"]));
  return { ok: false, error: "That isn't a step." };
}

export type TeamResult = { ok: true; sent: number; failed: { email: string; error: string }[] } | { ok: false; error: string };

/** Your team: one invitation each, Team's own. */
export async function inviteFirstRunTeam(people: { name: string; email: string; role: string }[]): Promise<TeamResult> {
  const failed: { email: string; error: string }[] = [];
  let sent = 0;
  for (const p of (people ?? []).slice(0, 20)) {
    const email = (p?.email ?? "").trim();
    if (!email) continue;
    const r = await createInvite({ email, role: p.role === "admin" ? "admin" : "staff", name: (p.name ?? "").trim() || undefined });
    if (r.ok) sent += 1;
    else failed.push({ email, error: "error" in r && typeof r.error === "string" ? r.error : "Couldn't send that one." });
  }
  return { ok: true, sent, failed };
}

/** The first run is over, finished or skipped: the business's stamp (an owner's) and your own. */
export async function finishFirstRun(): Promise<SaveResult> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (orgId && (await getDbRole()) === "owner" && (await orgSetupPending(orgId))) {
    const r = await skipOrgSetup();
    if (!r.ok) return r;
  }
  return skipMyOnboarding();
}
