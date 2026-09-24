import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { Servicem8Screen, type Sm8Reach } from "@/components/integrations/servicem8-screen";
import { countConnectionsElsewhere, getConnectionView } from "@/lib/integrations/store";
import { readSm8Vendor } from "@/lib/integrations/sm8-read";
import { kickSm8SyncIfStale, listSm8SyncStatus, type Sm8SyncStatusView } from "@/lib/integrations/sm8-sync";
import { tokenKey } from "@/lib/integrations/secrets";
import { sm8Config } from "@/lib/integrations/sm8";
import { sm8ConnectMessage } from "@/lib/integrations/outcome";
import { getSm8PeopleData } from "@/app/actions/staff-import";
import {
  countSm8WritesSentLately,
  kickSm8WritesIfDue,
  listRecentSm8Writes,
  sm8WritesEnabled,
} from "@/lib/integrations/sm8-writes";
import { SM8_WRITE_SCOPE_LIST } from "@/lib/integrations/providers";
import type { Sm8WritesView } from "@/components/integrations/sm8-writes-card";

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
  const stored = await getConnectionView(orgId, "servicem8");
  /* A deployment that can't write shows every workspace's sending as off,
     whatever was last chosen: the consent won't ask for the write
     permission there (the connect route agrees), so the screen mustn't say
     it's missing. */
  const connection =
    stored && !sm8WritesEnabled() && stored.writeMode !== "off"
      ? {
          ...stored,
          writeMode: "off" as const,
          missing: stored.missing.filter((s) => !SM8_WRITE_SCOPE_LIST.includes(s)),
        }
      : stored;
  const errorText = sm8ConnectMessage(one(params.error));

  /* One live read, only when there is a grant to read through. Doubles as the
     health check: revoked-from-ServiceM8 shows up here as needs_reauth on the
     next render, not at the first sync somebody depends on. */
  let reach: Sm8Reach | null = null;
  let sync: Sm8SyncStatusView | null = null;
  let people: Awaited<ReturnType<typeof getSm8PeopleData>> = null;
  let elsewhere = 0;
  let writes: Sm8WritesView | null = null;
  if (connection && connection.status === "connected") {
    const [vendor, status, peopleData, alsoConnected, recent, sentLately] = await Promise.all([
      readSm8Vendor(orgId),
      listSm8SyncStatus(orgId),
      // the reconcile card: live staff.json against this workspace's cards
      getSm8PeopleData(),
      // whether this same account is mirrored into other workspaces too
      countConnectionsElsewhere(orgId, "servicem8", connection.tenantId),
      sm8WritesEnabled() ? listRecentSm8Writes(orgId) : Promise.resolve([]),
      // the writes card's one figure: files sent in the last 30 days
      sm8WritesEnabled() ? countSm8WritesSentLately(orgId) : Promise.resolve(null),
    ]);
    if (sm8WritesEnabled()) {
      writes = {
        mode: connection.writeMode,
        granted: SM8_WRITE_SCOPE_LIST.every((s) => connection.scopes.includes(s)),
        sentLately,
        recent,
      };
    }
    elsewhere = alsoConnected;
    reach = vendor.ok
      ? { ok: true, account: { name: vendor.data.name, timezoneName: vendor.data.timezoneName } }
      : { ok: false, error: vendor.error };
    sync = status;
    people = peopleData;
    // Opening this screen counts as looking — top the mirrors up behind the
    // response when they're stale. Closes over the orgId read above; no
    // request APIs inside (Server Component after() rule).
    await kickSm8SyncIfStale(orgId);
    // and whatever is waiting to go the other way
    await kickSm8WritesIfDue(orgId);
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
      elsewhere={elsewhere}
      writes={writes}
    />
  );
}
