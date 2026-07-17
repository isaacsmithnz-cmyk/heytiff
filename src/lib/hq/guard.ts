import { redirect, notFound } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { isHqEmail } from "./allow";

/* HQ access enforcement (thin IO over the pure allowlist in allow.ts).

   Two entry points, mirroring the house split between pages and Server
   Functions:

   - requireHqPage() — for /hq layout & pages. Signed out → login redirect;
     signed in but not on HQ_EMAILS → notFound() (a 404, NOT a 403, so the
     route stays invisible to customers; there is no root not-found.tsx so this
     renders Next's default 404).
   - requireHq() — for Server Actions, which are POST-reachable independently of
     the UI (Next 16 docs: "verify authorization inside every Server Function").
     Throws rather than redirects. */

/** Page/layout guard: redirect signed-out users, 404 non-staff, else return staff. */
export async function requireHqPage(): Promise<{ email: string; userId: string }> {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const email = session.user.email ?? null;
  if (!isHqEmail(email)) notFound();
  return { email: email as string, userId: session.user.sub as string };
}

/** Server-action guard: throw for signed-out / non-staff callers. */
export async function requireHq(): Promise<{ email: string; userId: string }> {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");
  const email = session.user.email ?? null;
  if (!isHqEmail(email)) throw new Error("Not authorized");
  return { email: email as string, userId: session.user.sub as string };
}
