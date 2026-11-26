import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { orgSetupPending } from "@/lib/org/query";
import { formatAbn } from "@/lib/org/settings";
import { FirstRun, type Step } from "@/components/first-run/first-run";
import { firstRunCommon } from "./first-run-props";
/* For the address box and the licence scan alone: their rules are `.fg`-scoped in the frame's sheet, and this page
   is outside the frame. Every rule in it is scoped to a class this page does not otherwise use. */
import "@/app/dashboard/shell.css";

/* A NEW BUSINESS'S FIRST RUN — where Home sends the owner of a brand-new org
   (lib/org/setup-gate.ts), as the phone's (Isaac, 26 November 2026: "make the
   web first run match the phone"): the business's name (asked at the door,
   so only here when it's still blank), how customers reach it, your own
   details, your team, and what's left.

   EVERY GUARD RESOLVES TO A REDIRECT, not an error page: this URL survives in
   history and can be revisited signed out, org-less, demoted, or long after
   setup finished, and each of those people has a better screen than a
   refusal. THE DRAFT PREFILLS FROM THE ROW: an owner who half-filled
   Organisation first finds their words waiting.

   Deliberately NOT prefilled: the contact email from the login. Seeding
   company-facing facts from personal ones is how every org in prod ended up
   named after somebody's gmail. */

const COLUMNS = "trading_name, legal_name, abn, gst_registered, email, phone, address, suburb, state, postcode";

export default async function WelcomePage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const orgId = session.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");
  if (!hasMinRole(await getDbRole(), "owner")) redirect("/dashboard");
  if (!(await orgSetupPending(orgId))) redirect("/dashboard");

  const [{ data }, common] = await Promise.all([supabaseAdmin.from("organizations").select(COLUMNS).eq("id", orgId).maybeSingle(), firstRunCommon()]);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const d = (data ?? {}) as Record<string, unknown>;
  const business = {
    trading_name: str(d.trading_name),
    legal_name: str(d.legal_name),
    abn: d.abn ? formatAbn(String(d.abn)) : "",
    gst_registered: d.gst_registered === true ? "Yes" : d.gst_registered === false ? "No" : "",
    email: str(d.email),
    phone: str(d.phone),
    address: str(d.address),
    suburb: str(d.suburb),
    state: str(d.state),
    postcode: str(d.postcode),
  };
  const steps: Step[] = [...(business.trading_name.trim() ? [] : (["business"] as Step[])), "contact", "details", "team", "ready"];

  return <FirstRun steps={steps} org={business.trading_name || null} initialBusiness={business} {...common} />;
}
