import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { Servicem8Screen, type Sm8Reach } from "@/components/integrations/servicem8-screen";
import { countConnectionsElsewhere, getConnectionView } from "@/lib/integrations/store";
import { readSm8Vendor } from "@/lib/integrations/sm8-read";
import { listSm8SyncStatus, type Sm8SyncStatusView } from "@/lib/integrations/sm8-sync";
import { freshenSm8AfterResponse } from "@/lib/integrations/sm8-freshness";
import { tokenKey } from "@/lib/integrations/secrets";
import { sm8Config } from "@/lib/integrations/sm8";
import { sm8ConnectMessage, sm8SwitchedNotice } from "@/lib/integrations/outcome";
import { readSm8AccountChange } from "@/lib/integrations/sm8-store";
import { countSm8WritesCancelledSince } from "@/lib/integrations/sm8-write-cancel";
import { sendHold, WRITE_HOURLY_CAP, WRITE_WORDS } from "@/lib/integrations/sm8-write-plan";
import { getSm8PeopleData } from "@/app/actions/staff-import";
import {
  countSm8Queue,
  countSm8WritesSentLately,
  listRecentSm8Writes,
  readSm8WriteState,
  sm8WriteKindsEnabled,
} from "@/lib/integrations/sm8-writes";
import { SM8_WRITE_KIND_SCOPES, SM8_WRITE_SCOPE_LIST, SM8_WRITE_SCOPES } from "@/lib/integrations/providers";
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
  /* A deployment shows only the write permissions of the kinds it allows —
     the consent won't ask for the others (the connect route agrees), so the
     screen mustn't say they're missing — and one that can't write at all
     shows every workspace's sending as off, whatever was last chosen. */
  const kinds = sm8WriteKindsEnabled();
  const allowed = new Set<string>(kinds.flatMap((k) => [...SM8_WRITE_KIND_SCOPES[k]]));
  const barred = SM8_WRITE_SCOPE_LIST.filter((s) => !allowed.has(s));
  const connection = stored
    ? {
        ...stored,
        writeMode: kinds.length === 0 ? ("off" as const) : stored.writeMode,
        missing: stored.missing.filter((s) => !barred.includes(s)),
      }
    : null;
  const errorText = sm8ConnectMessage(one(params.error));

  /* Read whenever there is a connection row, not only a working one:
     Disconnect is offered in needs_reauth too, and its confirm says what it
     would cancel. A database without the account-change columns yet reads as
     "no change". What failed is counted for the account connected now, the
     one Retry failed files can reach. */
  const [queue, previousAccount] = connection
    ? await Promise.all([countSm8Queue(orgId, connection.tenantId), readSm8AccountChange(orgId)])
    : [{ waiting: 0, failed: 0, waitingKinds: { attachment: 0, note: 0 } }, null];

  /* The writes card, WHENEVER THERE IS A CONNECTION and the deployment
     writes — needs_reauth included, which is exactly when the owner needs
     to see what is waiting and why. Settings that can't be read draw no
     card rather than a wrong one. */
  let writes: Sm8WritesView | null = null;
  /* What "What HeyTiff asks ServiceM8 for" lists beside the reads: the write
     permissions of the kinds this deployment allows AND the owner has on —
     the same ones the connect route asks for. With SM8_WRITES=1 that is the
     files permission alone, whatever the owner's notes switch says. */
  let writeScopes = SM8_WRITE_SCOPES.filter((s) => allowed.has(s.scope) && s.scope === "manage_attachments");
  if (connection && kinds.length > 0) {
    const [state, recent, sentLately] = await Promise.all([
      readSm8WriteState(orgId),
      listRecentSm8Writes(orgId),
      // the writes card's one figure: sent in the last 30 days
      countSm8WritesSentLately(orgId),
    ]);
    if (state.readable) {
      const on = new Set<string>(
        kinds.filter((k) => state.ownerKinds.includes(k)).flatMap((k) => [...SM8_WRITE_KIND_SCOPES[k]])
      );
      writeScopes = SM8_WRITE_SCOPES.filter((s) => on.has(s.scope));
      writes = {
        mode: state.mode,
        pausedReason: state.pausedReason,
        hold: sendHold(state, "attachment"),
        granted: [...state.granted],
        refused: [...state.refused],
        sentLately,
        waiting: queue.waiting,
        failed: queue.failed,
        recent,
        hourlyCap: WRITE_HOURLY_CAP,
        kinds: [...kinds],
        ownerKinds: [...state.ownerKinds],
        /* per kind: a note waiting behind Notes Off says so, a file doesn't */
        holds: Object.fromEntries(kinds.map((k) => [k, sendHold(state, k)])),
      };
    }
  }

  /* One live read, only when there is a grant to read through. Doubles as the
     health check: revoked-from-ServiceM8 shows up here as needs_reauth on the
     next render, not at the first sync somebody depends on. */
  let reach: Sm8Reach | null = null;
  let sync: Sm8SyncStatusView | null = null;
  let people: Awaited<ReturnType<typeof getSm8PeopleData>> = null;
  let elsewhere = 0;
  if (connection && connection.status === "connected") {
    const [vendor, status, peopleData, alsoConnected] = await Promise.all([
      readSm8Vendor(orgId),
      listSm8SyncStatus(orgId),
      // the reconcile card: live staff.json against this workspace's cards
      getSm8PeopleData(),
      // whether this same account is mirrored into other workspaces too
      countConnectionsElsewhere(orgId, "servicem8", connection.tenantId),
    ]);
    elsewhere = alsoConnected;
    reach = vendor.ok
      ? { ok: true, account: { name: vendor.data.name, timezoneName: vendor.data.timezoneName } }
      : { ok: false, error: vendor.error };
    sync = status;
    people = peopleData;
    /* Opening this screen counts as looking: what is waiting to go is sent,
       then a stale mirror topped up, all behind the response. */
    freshenSm8AfterResponse(orgId);
  }

  /* A reconnect that REPLACED the account says so, with what went with the
     old one. The count is read from the rows cancelled since the change,
     never taken from the URL, which anyone can type. */
  const switchedText =
    !errorText && one(params.connected) === "1" && one(params.switched) === "1" && previousAccount && connection?.tenantName
      ? sm8SwitchedNotice({
          to: connection.tenantName,
          from: previousAccount.from,
          /* files and notes apart only where the deployment sends notes;
             otherwise today's one count */
          ...(kinds.includes("note")
            ? {
                cancelled: await countSm8WritesCancelledSince(orgId, WRITE_WORDS.otherAccount, previousAccount.at, "attachment"),
                notes: await countSm8WritesCancelledSince(orgId, WRITE_WORDS.otherAccount, previousAccount.at, "note"),
              }
            : { cancelled: await countSm8WritesCancelledSince(orgId, WRITE_WORDS.otherAccount, previousAccount.at) }),
        })
      : null;

  const notice = errorText
    ? ({ kind: "error", text: errorText } as const)
    : switchedText
      ? ({ kind: "ok", text: switchedText } as const)
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
      writeScopes={writeScopes}
      waitingWrites={queue.waitingKinds.attachment}
      waitingNotes={queue.waitingKinds.note}
      previousAccount={previousAccount ? { name: previousAccount.from, at: previousAccount.at } : null}
    />
  );
}
