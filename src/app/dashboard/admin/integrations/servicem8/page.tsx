import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { Servicem8Screen, type Sm8Reach } from "@/components/integrations/servicem8-screen";
import { getConnectionView } from "@/lib/integrations/store";
import { readSm8Vendor } from "@/lib/integrations/sm8-read";
import { kickSm8SyncIfStale, listSm8SyncStatus, type Sm8SyncStatusView } from "@/lib/integrations/sm8-sync";
import { tokenKey } from "@/lib/integrations/secrets";
import { sm8Config } from "@/lib/integrations/sm8";
import { sm8ConnectMessage } from "@/lib/integrations/outcome";
import { getSm8PeopleData } from "@/app/actions/staff-import";

/* The ServiceM8 connection screen. Owner-only, matching the routes it links
   to — the Xero page's sibling, and the same posture throughout: two booleans
   cross to the client, never the values behind them, and the ?connected /
   ?error query becomes a sentence HERE, from a fixed table. */

export default async function Servicem8IntegrationPage({
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
  const connection = await getConnectionView(orgId, "servicem8");
  const errorText = sm8ConnectMessage(one(params.error));

  /* One live read, only when there is a grant to read through. Doubles as the
     health check: revoked-from-ServiceM8 shows up here as needs_reauth on the
     next render, not at the first sync somebody depends on. */
  let reach: Sm8Reach | null = null;
  let sync: Sm8SyncStatusView | null = null;
  let people: Awaited<ReturnType<typeof getSm8PeopleData>> = null;
  if (connection && connection.status === "connected") {
    const [vendor, status, peopleData] = await Promise.all([
      readSm8Vendor(orgId),
      listSm8SyncStatus(orgId),
      // the reconcile card: live staff.json against this workspace's cards
      getSm8PeopleData(),
    ]);
    reach = vendor.ok
      ? { ok: true, account: { name: vendor.data.name, timezoneName: vendor.data.timezoneName } }
      : { ok: false, error: vendor.error };
    sync = status;
    people = peopleData;
    // Opening this screen counts as looking — top the mirrors up behind the
    // response when they're stale. Closes over the orgId read above; no
    // request APIs inside (Server Component after() rule).
    await kickSm8SyncIfStale(orgId);
  }

  const notice = errorText
    ? ({ kind: "error", text: errorText } as const)
    : one(params.connected) === "1"
      ? /* Name what was connected, never just "connected". OAuth authorises
           whichever account the browser was signed into and never asks which
           one you meant — an anonymous success is how a live business account
           got connected by accident on 2026-08-10. */
        ({
          kind: "ok",
          text: connection?.tenantName
            ? `Connected to ${connection.tenantName}.`
            : "ServiceM8 is connected.",
        } as const)
      : null;

  return (
    <Servicem8Screen
      connection={connection}
      configured={sm8Config() !== null}
      sealed={tokenKey() !== null}
      notice={notice}
      reach={reach}
      sync={sync}
      people={people}
    />
  );
}
