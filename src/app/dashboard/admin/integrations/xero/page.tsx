import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { XeroScreen, type XeroReach } from "@/components/integrations/xero-screen";
import { getConnectionView } from "@/lib/integrations/store";
import { countPayrollEmployees } from "@/lib/integrations/xero-read";
import { tokenKey } from "@/lib/integrations/secrets";
import { xeroConfig } from "@/lib/integrations/xero";
import { connectMessage } from "@/lib/integrations/outcome";
import { getXeroPeopleData } from "@/app/actions/staff-import";

/* The Xero connection screen. Owner-only, matching the routes it links to.

   Two booleans cross to the client, never the values behind them: whether the
   Xero app credentials exist, and whether a token key exists. Same posture as
   the Organisation screen's `addressLookup` — the client needs to know a thing
   is configured, and nothing more.

   The `?connected` / `?error` query is turned into a sentence HERE, from a
   fixed table, so the page never renders text an arbitrary URL supplied. */

export default async function XeroIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!hasMinRole(await getDbRole(), "owner")) redirect("/dashboard");

  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const orgId = session.orgId as string;
  const connection = await getConnectionView(orgId, "xero");
  const errorText = connectMessage(one(params.error));

  /* One live read, only when there is a grant to read through. It doubles as
     the health check: a revoked-from-Xero connection still has a row and
     unexpired-looking tokens, and this is what notices — the read layer marks
     the row needs_reauth on a 401, so the next render says "reconnect". */
  let reach: XeroReach | null = null;
  let people: Awaited<ReturnType<typeof getXeroPeopleData>> = null;
  if (connection && connection.status === "connected") {
    // the reconcile card: the live payroll list against this workspace's cards
    const [count, peopleData] = await Promise.all([
      countPayrollEmployees(orgId),
      getXeroPeopleData(),
    ]);
    reach = count.ok ? { ok: true, employees: count.data } : { ok: false, error: count.error };
    people = peopleData;
  }

  const notice = errorText
    ? ({ kind: "error", text: errorText } as const)
    : one(params.connected) === "1"
      ? /* Name the organisation, not just the fact — same reason as the
           ServiceM8 screen: consent follows the browser session. */
        ({
          kind: "ok",
          text: connection?.tenantName
            ? `Connected to ${connection.tenantName}.`
            : "Xero is connected.",
        } as const)
      : null;

  return (
    <XeroScreen
      connection={connection}
      configured={xeroConfig() !== null}
      sealed={tokenKey() !== null}
      notice={notice}
      reach={reach}
      people={people}
    />
  );
}
