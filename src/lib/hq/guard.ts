import { redirect, notFound } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { isHqUser } from "./allow";

/* HQ access enforcement (thin IO over the pure allowlist in allow.ts).

   Two entry points, mirroring the house split between pages and Server
   Functions:

   - requireHqPage() — for /hq layout & pages. Signed out → login redirect;
     signed in but not on HQ_USER_IDS → notFound() (a 404, NOT a 403, so the
     route stays invisible to customers; there is no root not-found.tsx so this
     renders Next's default 404).
   - requireHq() — for Server Actions, which are POST-reachable independently of
     the UI (Next 16 docs: "verify authorization inside every Server Function").
     Throws rather than redirects.

   Access is decided by the session's `sub` alone. The email that comes back is
   for display and for the audit columns (added_by, deleted_by); an account
   with no email signs those with its id. */

type HqStaff = { email: string; userId: string };

function staffOf(user: { sub?: unknown; email?: unknown }): HqStaff {
  const userId = String(user.sub);
  const email = typeof user.email === "string" && user.email ? user.email : userId;
  return { email, userId };
}

/** Page/layout guard: redirect signed-out users, 404 non-staff, else return staff. */
export async function requireHqPage(): Promise<HqStaff> {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!isHqUser(session.user.sub)) notFound();
  return staffOf(session.user);
}

/** Server-action guard: throw for signed-out / non-staff callers. */
export async function requireHq(): Promise<HqStaff> {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");
  if (!isHqUser(session.user.sub)) throw new Error("Not authorized");
  return staffOf(session.user);
}
