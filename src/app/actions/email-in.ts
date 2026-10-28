"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { emailInAddress } from "@/lib/email/inbound";
import { makeEmailAddress } from "@/lib/email/inbound-server";

/* EMAIL TO TIFF, the address (Settings › Integrations). Owner-only, as the
   page and the connected apps are: the address takes mail into the business.
   Making one replaces the last, so the old address finds no one (the norm
   Isaac approved on 20 October: "make a new address" kills the old). */

export type MadeAddress = { ok: true; address: string } | { ok: false; error: string };

export async function makeTiffEmailAddress(): Promise<MadeAddress> {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");
  const orgId = session.orgId as string | undefined;
  if (!orgId) throw new Error("No active organization");
  if (!hasMinRole(await getDbRole(), "owner")) return { ok: false, error: "Only an owner can change Tiff's email address." };
  const made = await makeEmailAddress(orgId, session.user.sub as string);
  if (!made) return { ok: false, error: "The address couldn't be made. Try again." };
  revalidatePath("/dashboard/admin/integrations");
  return { ok: true, address: emailInAddress(made.token) };
}
