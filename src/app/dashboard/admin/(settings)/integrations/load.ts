import { countConnectionsElsewhere, getConnectionView } from "@/lib/integrations/store";
import { readSm8Vendor } from "@/lib/integrations/sm8-read";
import { listSm8SyncStatus, type Sm8SyncStatusView } from "@/lib/integrations/sm8-sync";
import { freshenSm8AfterResponse } from "@/lib/integrations/sm8-freshness";
import { tokenKey } from "@/lib/integrations/secrets";
import { sm8Config } from "@/lib/integrations/sm8";
import { xeroConfig } from "@/lib/integrations/xero";
import { countPayrollEmployees } from "@/lib/integrations/xero-read";
import { connectMessage, sm8ConnectMessage, sm8SwitchedNotice } from "@/lib/integrations/outcome";
import { readSm8AccountChange } from "@/lib/integrations/sm8-store";
import { countSm8WritesCancelledSince } from "@/lib/integrations/sm8-write-cancel";
import { sendHold, WRITE_HOURLY_CAP, WRITE_WORDS } from "@/lib/integrations/sm8-write-plan";
import { getSm8PeopleData, getXeroPeopleData } from "@/app/actions/staff-import";
import {
  countSm8Queue,
  countSm8WritesSentLately,
  listRecentSm8Writes,
  readSm8WriteState,
  sm8WriteKindsEnabled,
} from "@/lib/integrations/sm8-writes";
import { SM8_WRITE_KIND_SCOPES, SM8_WRITE_SCOPE_LIST, SM8_WRITE_SCOPES } from "@/lib/integrations/providers";
import { sm8WebhooksState } from "@/lib/integrations/sm8-hooks-switch";
import { sm8LiveUpdatesLine } from "@/lib/integrations/sm8-hook-words";
import { quotesOnTrial } from "@/lib/integrations/sm8-quote-trial";
import type { Servicem8Props, Sm8Reach, Sm8WritesView, XeroProps, XeroReach } from "@/components/integrations/types";

/* WHAT THE INTEGRATIONS SECTION READS, one function per app (25 October
   2026: Settings is one page, and ServiceM8 and Xero are one section of it,
   Isaac: "just should be called integration. Or integrations"). These are
   the two screens' loaders as they were, moved out of their pages so the one
   page runs them side by side and a test can run each for real. Owner-only
   is the page's, as it was each screen's.

   Two booleans cross to the client per app, never the values behind them:
   whether the app's credentials exist on this deployment, and whether a
   token key exists. The ?connected / ?error query becomes a sentence HERE,
   from a fixed table, so the page never renders text a URL supplied. */

export type Query = { [key: string]: string | string[] | undefined };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** ServiceM8: the connection, what goes out, what came in, the people. */
export async function loadServicem8(orgId: string, params: Query): Promise<Servicem8Props> {
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
     one Retry the files can reach. */
  const [queue, previousAccount] = connection
    ? await Promise.all([countSm8Queue(orgId, connection.tenantId), readSm8AccountChange(orgId)])
    : [{ waiting: 0, failed: 0, waitingKinds: { attachment: 0, note: 0, booking: 0, leave: 0 } }, null];

  /* Sending, WHENEVER THERE IS A CONNECTION and the deployment writes —
     needs_reauth included, which is exactly when the owner needs to see
     what is waiting and why. Settings that can't be read draw nothing
     rather than something wrong. */
  let writes: Sm8WritesView | null = null;
  /* What the permissions list beside the reads: the write permissions of
     the kinds this deployment allows AND the owner has on — the same ones
     the connect route asks for. With SM8_WRITES=1 that is the files
     permission alone, whatever the owner's notes switch says. */
  let writeScopes = SM8_WRITE_SCOPES.filter((s) => allowed.has(s.scope) && s.scope === "manage_attachments");
  if (connection && kinds.length > 0) {
    const [state, recent, sentLately] = await Promise.all([
      readSm8WriteState(orgId),
      listRecentSm8Writes(orgId),
      // the one figure sending has: sent in the last 30 days
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
        quotesTrial: kinds.includes("quote") ? await quotesOnTrial(orgId) : true,
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
  let liveUpdates: string | null = null;
  if (connection && connection.status === "connected") {
    const [vendor, status, peopleData, alsoConnected, hooksHealth] = await Promise.all([
      readSm8Vendor(orgId),
      listSm8SyncStatus(orgId),
      // the people review: live staff.json against this workspace's cards
      getSm8PeopleData(),
      // whether this same account is mirrored into other workspaces too
      countConnectionsElsewhere(orgId, "servicem8", connection.tenantId),
      /* live updates from ServiceM8 (two-way phase 4): one line, only when
         they aren't working. With the switch anything but on, nothing is
         read and the subscribing module is never loaded. A module that
         won't load, or a read that throws, says nothing rather than taking
         the section down. */
      sm8WebhooksState() === "on"
        ? import("@/lib/integrations/sm8-hooks")
            .then((m) => m.readSm8HooksHealth(orgId))
            .catch(() => null)
        : null,
    ]);
    elsewhere = alsoConnected;
    liveUpdates = sm8LiveUpdatesLine(hooksHealth);
    reach = vendor.ok
      ? { ok: true, account: { name: vendor.data.name, timezoneName: vendor.data.timezoneName } }
      : { ok: false, error: vendor.error };
    sync = status;
    people = peopleData;
    /* Opening this section counts as looking: what is waiting to go is
       sent, then a stale mirror topped up, all behind the response. */
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
          /* kind by kind only where the deployment sends more than files —
             files and notes, and bookings where it sends them; otherwise
             today's one count */
          ...(kinds.includes("note") || kinds.includes("booking") || kinds.includes("leave") || kinds.includes("job") || kinds.includes("customer") || kinds.includes("quote")
            ? {
                cancelled: await countSm8WritesCancelledSince(orgId, WRITE_WORDS.otherAccount, previousAccount.at, "attachment"),
                notes: await countSm8WritesCancelledSince(orgId, WRITE_WORDS.otherAccount, previousAccount.at, "note"),
                ...(kinds.includes("booking")
                  ? { bookings: await countSm8WritesCancelledSince(orgId, WRITE_WORDS.otherAccount, previousAccount.at, "booking") }
                  : {}),
                ...(kinds.includes("leave")
                  ? { leave: await countSm8WritesCancelledSince(orgId, WRITE_WORDS.otherAccount, previousAccount.at, "leave") }
                  : {}),
                ...(kinds.includes("job")
                  ? { jobs: await countSm8WritesCancelledSince(orgId, WRITE_WORDS.otherAccount, previousAccount.at, "job") }
                  : {}),
                ...(kinds.includes("customer")
                  ? { customers: await countSm8WritesCancelledSince(orgId, WRITE_WORDS.otherAccount, previousAccount.at, "customer") }
                  : {}),
                ...(kinds.includes("quote")
                  ? { quotes: await countSm8WritesCancelledSince(orgId, WRITE_WORDS.otherAccount, previousAccount.at, "quote") }
                  : {}),
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
            text: connection?.tenantName ? `Connected to ${connection.tenantName}.` : "ServiceM8 is connected.",
          } as const)
        : null;

  return {
    connection,
    configured: sm8Config() !== null,
    sealed: tokenKey() !== null,
    notice,
    reach,
    sync,
    people,
    elsewhere,
    writes,
    writeScopes,
    waitingWrites: queue.waitingKinds.attachment,
    waitingNotes: queue.waitingKinds.note,
    waitingBookings: queue.waitingKinds.booking,
    /* only where the deployment sends leave: anywhere else the props are
       exactly today's (sm8-hooks-prod.test) */
    ...(kinds.includes("leave") ? { waitingLeave: queue.waitingKinds.leave } : {}),
    ...(kinds.includes("job") ? { waitingJobs: queue.waitingKinds.job ?? 0 } : {}),
    ...(kinds.includes("customer") ? { waitingCustomers: queue.waitingKinds.customer ?? 0 } : {}),
    ...(kinds.includes("quote") ? { waitingQuotes: queue.waitingKinds.quote ?? 0 } : {}),
    previousAccount: previousAccount ? { name: previousAccount.from, at: previousAccount.at } : null,
    /* only when there is something to say: otherwise the props are today's */
    ...(liveUpdates ? { liveUpdates } : {}),
  };
}

/** Xero: the connection, which organisation, the people. */
export async function loadXero(orgId: string, params: Query): Promise<XeroProps> {
  const connection = await getConnectionView(orgId, "xero");
  const errorText = connectMessage(one(params.error));

  /* One live read, only when there is a grant to read through. It doubles as
     the health check: a revoked-from-Xero connection still has a row and
     unexpired-looking tokens, and this is what notices — the read layer marks
     the row needs_reauth on a 401, so the next render says "reconnect". */
  let reach: XeroReach | null = null;
  let people: Awaited<ReturnType<typeof getXeroPeopleData>> = null;
  let elsewhere = 0;
  if (connection && connection.status === "connected") {
    // the people review: the live payroll list against this workspace's cards
    const [count, peopleData, alsoConnected] = await Promise.all([
      countPayrollEmployees(orgId),
      getXeroPeopleData(),
      // whether this same organisation is connected to other workspaces too
      countConnectionsElsewhere(orgId, "xero", connection.tenantId),
    ]);
    reach = count.ok ? { ok: true, employees: count.data } : { ok: false, error: count.error };
    people = peopleData;
    elsewhere = alsoConnected;
  }

  const notice = errorText
    ? ({ kind: "error", text: errorText } as const)
    : one(params.connected) === "1"
      ? /* Name the organisation, not just the fact — same reason as
           ServiceM8's: consent follows the browser session. */
        ({
          kind: "ok",
          text: connection?.tenantName ? `Connected to ${connection.tenantName}.` : "Xero is connected.",
        } as const)
      : null;

  return {
    connection,
    configured: xeroConfig() !== null,
    sealed: tokenKey() !== null,
    notice,
    reach,
    people,
    elsewhere,
  };
}
