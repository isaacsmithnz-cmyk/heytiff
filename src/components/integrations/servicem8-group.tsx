"use client";

import { useState } from "react";
import { Button } from "@/components/parts/button";
import { StateWord, type Tone } from "@/components/parts/state";
import { Group, Setting, Wrong } from "@/components/settings/parts";
import { auDayOf, fmtAuTime, fmtAuWeekdayDate, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { useHydrated } from "@/lib/use-hydrated";
import { SM8_SCOPES, SM8_WRITE_SCOPES } from "@/lib/integrations/providers";
import type { ConnectionView } from "@/lib/integrations/connection";
import type { Sm8ObjectStatus, Sm8SyncStatusView } from "@/lib/integrations/sm8-sync";
import { nameList, sm8WaitingConsequence } from "@/lib/integrations/outcome";
import { disconnectServiceM8Action, syncServiceM8NowAction } from "@/app/actions/integrations";
import { ConnectDialog, DisconnectDialog, NotSwitchedOn, Permissions, Said, useIntegrationAct } from "./int-parts";
import { PeopleReview } from "./people-review";
import { Sm8Sending } from "./sm8-sending";
import type { Servicem8Props, Sm8Reach } from "./types";

/* SETTINGS › INTEGRATIONS, SERVICEM8 (v2, 25 October 2026; the mock's
   Integrations board). One group under its line: the connection and its
   health, then what goes out (Sending to ServiceM8), then what comes in
   (What HeyTiff reads: the mirror, the people, the permissions), then
   Reconnect and Disconnect at its foot. Sync now is on the group's head,
   beside the sentence it changes.

   What is real about ServiceM8, not stylistic: one account per grant (no
   organisation picker), no revocation endpoint, so Disconnect names the one
   step that finishes the job on their side, and a disconnect here drops a
   whole MIRROR, not just credentials, which is why it asks for the
   account's name. */

const START = "/api/integrations/servicem8/connect";

/** The files permission alone: what a deployment that sends files asks. */
const FILES_SCOPES = SM8_WRITE_SCOPES.filter((s) => s.scope === "manage_attachments");

/** 24996 → "24,996". A real account's first sync reaches five figures. */
const num = (n: number) => n.toLocaleString("en-AU");

/* THE CONNECTION'S HEALTH, AS ONE WORD IN ITS STATE'S COLOUR (Isaac,
   2026-09-28: "some sort of green signalling to show that it is connected,
   and working"). Green is earned, not assumed: it needs the grant whole,
   the live read to have worked, and the last sync to have finished. Each
   way short of that says which. */
export function sm8Health(
  connection: ConnectionView | null,
  reach: Sm8Reach | null | undefined,
  sync: Sm8SyncStatusView | null | undefined,
): { tone: Tone; word: string } | null {
  if (!connection) return null;
  if (connection.status === "needs_reauth") return { tone: "wrong", word: "Needs reconnecting" };
  if (reach && !reach.ok) return { tone: "look", word: "Can't be read" };
  if (connection.missing.length > 0) return { tone: "look", word: "Missing access" };
  if (sync?.lastRun?.running) return { tone: "good", word: "Syncing now" };
  if (sync?.lastRun && sync.lastRun.ok === false) return { tone: "look", word: "Last sync didn't finish" };
  return { tone: "good", word: "Connected and working" };
}

export function Servicem8Group({
  connection,
  configured,
  sealed,
  notice,
  reach,
  sync,
  people,
  elsewhere = 0,
  writes = null,
  waitingWrites = 0,
  waitingNotes = 0,
  waitingBookings = 0,
  waitingLeave = 0,
  waitingJobs = 0,
  waitingCustomers = 0,
  waitingQuotes = 0,
  writeScopes = FILES_SCOPES,
  previousAccount = null,
  liveUpdates = null,
}: Servicem8Props) {
  const act = useIntegrationAct();
  const [dialog, setDialog] = useState<"connect" | "disconnect" | null>(null);
  const [gone, setGone] = useState<string | null>(null);

  const ready = configured && sealed;
  const connected = connection !== null;
  const attention = connection !== null && (connection.status === "needs_reauth" || connection.missing.length > 0);
  const health = sm8Health(connection, reach, sync);
  /* The ask follows the owner's switch: the write permissions are on the
     list, and on the consent screen, only while sending is On or Paused (a
     pause keeps the permission, so switching back on needs no reconnect). */
  const asking = connection?.writeMode === "live" || connection?.writeMode === "paused";
  const asks = asking ? [...SM8_SCOPES, ...writeScopes] : SM8_SCOPES;
  const missing = connection?.missing ?? [];
  const short = asks.filter((s) => missing.includes(s.scope)).length;
  const writeCount = asks.length - SM8_SCOPES.length;
  const permsLine = `${SM8_SCOPES.length} reads${writeCount > 0 ? ` and ${writeCount} write${writeCount === 1 ? "" : "s"}` : ""}${
    connected ? (short > 0 ? `, ${short} not granted yet` : ", all granted") : ""
  }`;

  const syncNow = () =>
    act.run("sync", () => syncServiceM8NowAction(), (note) => note ?? "Synced with ServiceM8");

  const disconnect = () =>
    act.run(
      "disconnect",
      () => disconnectServiceM8Action(),
      () => null,
      (note) => {
        setGone(note ?? null);
        setDialog(null);
      },
    );

  return (
    <Group
      heading="ServiceM8"
      anchor="servicem8"
      tools={
        connected && sync ? (
          <Button kind="second" size={32} onClick={syncNow} disabled={act.busy}>
            {act.pending === "sync" ? "Syncing with ServiceM8" : "Sync now"}
          </Button>
        ) : undefined
      }
    >
      {notice && (notice.kind === "error" ? <Wrong>{notice.text}</Wrong> : <Said tone="good">{notice.text}</Said>)}
      {gone && <Said tone="info">{gone}</Said>}

      {connected ? (
        <Setting
          name={connection.tenantName ?? "Connected"}
          line={<ConnectionLine connection={connection} sync={sync ?? null} previousAccount={previousAccount} />}
        >
          {health && (
            <StateWord tone={health.tone} className="st2-int-word">
              {health.word}
            </StateWord>
          )}
        </Setting>
      ) : (
        <Setting name="Not connected">
          {ready && (
            <Button kind="main" size={32} onClick={() => setDialog("connect")}>
              Connect ServiceM8
            </Button>
          )}
        </Setting>
      )}
      {!ready && (
        <NotSwitchedOn
          label="ServiceM8"
          missing={[...(configured ? [] : ["SM8_CLIENT_ID / SM8_CLIENT_SECRET / APP_BASE_URL"]), ...(sealed ? [] : ["INTEGRATIONS_TOKEN_KEY"])]}
        />
      )}
      {act.error && dialog === null && <Wrong>{act.error}</Wrong>}

      {/* live updates from ServiceM8, only when they aren't working: the
          page hands the sentence over already written */}
      {connected && liveUpdates && <Said tone="look">{liveUpdates}</Said>}

      {/* Somebody else holds this same account. Stated, not blocked:
          sharing one account across workspaces is legitimate, but it must
          not be invisible to the person whose client book it is. */}
      {connected && elsewhere > 0 && (
        <Said tone="info">
          {`This ServiceM8 account is also connected to ${elsewhere} other HeyTiff workspace${elsewhere === 1 ? "" : "s"}. Each one mirrors its own copy of this account's data, and disconnecting here doesn't affect theirs. If that isn't expected, remove HeyTiff's access from inside ServiceM8.`}
        </Said>
      )}

      {/* the other direction: files, notes and bookings sent from a job */}
      {connected && writes && <Sm8Sending view={writes} />}

      <div className="st2-int-sub">
        <h3>What HeyTiff reads</h3>
      </div>
      {connected && sync && <MirrorRow sync={sync} />}
      {connected && people && <PeopleReview provider="servicem8" {...people} />}
      <Permissions
        line={permsLine}
        groups={[
          { label: "Reads", list: SM8_SCOPES },
          { label: "Writes, asked for while sending is On or Paused", list: asking ? writeScopes : [] },
        ]}
        connected={connected}
        missing={missing}
        open={!connected || attention}
      />

      {connected && (
        <div className="st2-int-foot">
          {ready && (
            <Button kind="second" size={32} onClick={() => setDialog("connect")}>
              Reconnect ServiceM8
            </Button>
          )}
          <Button kind="delete" size={32} onClick={() => setDialog("disconnect")}>
            Disconnect ServiceM8
          </Button>
        </div>
      )}

      {dialog === "connect" && (
        <ConnectDialog label="ServiceM8" startHref={START} accountName={connection?.tenantName ?? null} onClose={() => setDialog(null)} />
      )}
      {dialog === "disconnect" && (
        <DisconnectDialog
          label="ServiceM8"
          accountName={connection?.tenantName ?? null}
          consequences={[
            "HeyTiff's stored credentials for this account are deleted.",
            "Every mirrored row goes with them: clients, jobs, schedule, checklists and staff.",
            ...[sm8WaitingConsequence(waitingWrites, waitingNotes, waitingBookings, waitingLeave, waitingJobs, waitingCustomers, waitingQuotes)].filter(
              (c): c is string => c !== null,
            ),
            "Rows you created here stay, on the names they already captured.",
            "Reconnecting the same account rebuilds the mirror in a few minutes.",
          ]}
          note="ServiceM8 has no remote switch-off, so to fully revoke access afterwards, remove HeyTiff from that ServiceM8 account's add-ons."
          requirePhrase
          busy={act.pending === "disconnect"}
          error={act.error}
          onConfirm={disconnect}
          onClose={() => setDialog(null)}
        />
      )}
    </Group>
  );
}

/** "just now" / "4 min ago" / "3 hours ago": deliberately vague past a day,
    because a mirror that old is the story, not the minutes. IT READS THE
    CLOCK, so only the browser says it (ConnectionLine). */
function agoLabel(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms) || ms < 0) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return "over a day ago";
}

/** When Vercel's scheduler last ran the overnight sync, as an AU day and
    time: no clock is read, so the server and the browser write the same
    words. Null: it never has, which is what an unset CRON_SECRET looks
    like from here. */
function overnightLine(lastCron: string | null): string {
  if (lastCron === null || Number.isNaN(Date.parse(lastCron))) return "The overnight sync hasn't run.";
  return `Last overnight sync ${fmtAuWeekdayDayMonth(auDayOf(lastCron))}, ${fmtAuTime(new Date(lastCron))}.`;
}

/* THE CONNECTION'S LINE: who connected it and when, the account it
   replaced (its copy was cleared, so this is the one trace of which
   business it was), and when the mirror last moved.

   THE ONE PART THAT READS A CLOCK WAITS FOR THE BROWSER. The server once
   rendered "Last synced 4 min ago" and the client, a moment later across a
   minute boundary, "5 min ago": different text in the same node, which is
   React #418, and #418 took the whole screen's hydration down (prod,
   2026-09-01). Not suppressHydrationWarning, which keeps the server's
   stale words: the server sends the half of the sentence that cannot drift
   and the browser finishes it, the board chip's rule. */
function ConnectionLine({
  connection,
  sync,
  previousAccount,
}: {
  connection: ConnectionView;
  sync: Sm8SyncStatusView | null;
  previousAccount: { name: string | null; at: string } | null;
}) {
  const hydrated = useHydrated();
  const run = sync?.lastRun ?? null;
  const parts = [
    connection.status === "needs_reauth" ? connection.lastError ?? "This connection needs reconnecting." : null,
    connection.connectedAt
      ? `Connected ${fmtAuWeekdayDate(auDayOf(connection.connectedAt))}${connection.connectedByName ? ` by ${connection.connectedByName}` : ""}.`
      : null,
    previousAccount
      ? `It replaced ${previousAccount.name ?? "another ServiceM8 account"} on ${fmtAuWeekdayDate(auDayOf(previousAccount.at))}.`
      : null,
    /* a run happening now is the health word's to say */
    sync && !run?.running
      ? run?.finishedAt
        ? `Last synced${hydrated ? ` ${agoLabel(run.finishedAt)}` : ""}.${run.ok === false && run.note ? ` ${run.note}` : ""}`
        : "Waiting for the first sync."
      : null,
    sync && sync.lastCron !== undefined ? overnightLine(sync.lastCron) : null,
  ];
  return <>{parts.filter(Boolean).join(" ")}</>;
}

/* WHAT HAS BEEN READ, AS ONE ROW, opening to each kind of record.

   THE STATE THIS ROW MUST NOT KEEP SECRET: a first sync of a real account
   is not one event, it is a fortnight of runs. The engine's page budget
   caps a run, so ~25,000 attachments arrive over several, and between them
   the object carries `last_error: "Paused mid-walk"`. So each kind says
   which of four things is true (nothing yet, reading, read, or genuinely
   stuck), a reading one shows its running total (ServiceM8 hands back a
   cursor, never a count, so a climbing number is the only honest progress),
   and only a stuck one wears the colour that asks for a person. The row's
   own line is the news: what is stuck, else what is still being read. */
function MirrorRow({ sync }: { sync: Sm8SyncStatusView }) {
  const [open, setOpen] = useState(false);
  const total = sync.objects.reduce((n, o) => n + o.rowsPulled, 0);
  const blocked = sync.objects.filter((o) => o.phase === "blocked");
  const reading = sync.objects.filter((o) => o.phase === "reading");
  const readingRows = reading.reduce((n, o) => n + o.rowsPulled, 0);
  const kinds = sync.objects.length;
  const line =
    blocked.length > 0
      ? blocked.map((o) => `${o.label}: ${o.lastError}`).join(" ")
      : reading.length > 0
        ? `Still reading ${nameList(reading.map((o) => o.label))} across, ${num(readingRows)} row${readingRows === 1 ? "" : "s"} so far. Each sync picks up where the last one stopped.`
        : total === 0
          ? "Waiting for the first sync."
          : undefined;
  return (
    <>
      <Setting
        name={total > 0 ? `${num(total)} records, ${kinds} kind${kinds === 1 ? "" : "s"}` : "Nothing read yet"}
        line={line}
      >
        {kinds > 0 && (
          <Button kind="quiet" size={32} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? "Hide them" : "Show each"}
          </Button>
        )}
      </Setting>
      {open && (
        <div className="st2-int-open">
          {sync.objects.map((o) => (
            <Setting key={o.object} name={o.label}>
              <ObjectState o={o} />
            </Setting>
          ))}
        </div>
      )}
    </>
  );
}

/** One kind of record's state. `blocked` is the only one that asks for a
    look: the orange means somebody is needed, and nothing else wears it. */
function ObjectState({ o }: { o: Sm8ObjectStatus }) {
  if (o.phase === "blocked") return <StateWord tone="look">{o.lastError}</StateWord>;
  if (o.phase === "reading")
    return (
      <StateWord tone="good" className="st2-int-word st2-int-live">
        Reading, {num(o.rowsPulled)} so far
      </StateWord>
    );
  /* a ledger's count: the name beside it says what the rows are */
  if (o.phase === "done") return <span className="st2-int-count">{num(o.rowsPulled)}</span>;
  return (
    <StateWord tone="info" className="st2-int-word">
      First sync queued
    </StateWord>
  );
}
