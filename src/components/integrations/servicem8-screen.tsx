"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { ScreenBand, ScreenPanel } from "@/components/shell/screen-band";
import { auDayOf, fmtAuTime, fmtAuWeekdayDate, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { useHydrated } from "@/lib/use-hydrated";
import { providerById, SM8_SCOPES, SM8_WRITE_SCOPES, type ScopeEntry } from "@/lib/integrations/providers";
import type { ConnectionView } from "@/lib/integrations/connection";
import type { Sm8ObjectStatus, Sm8SyncStatusView } from "@/lib/integrations/sm8-sync";
import { disconnectServiceM8Action, syncServiceM8NowAction } from "@/app/actions/integrations";
import { PeopleImportCard, type PeopleCardData } from "@/components/integrations/people-import-card";
import { ConnectActions } from "@/components/integrations/connect-actions";
import { Sm8WritesCard, type Sm8WritesView } from "@/components/integrations/sm8-writes-card";
import { nameList, sm8WaitingConsequence } from "@/lib/integrations/outcome";

/* The ServiceM8 connection screen — xero-screen's sibling, same two refusals
   to be vague (WHAT IT IS FOR, WHAT IT CAN SEE), and the shared ConnectActions
   for the connect/disconnect controls.

   Differences that are real, not stylistic: one ServiceM8 account per grant
   (no organisation picker), ServiceM8 has no revocation endpoint — so the
   disconnect copy names the one step that finishes the job on their side —
   and a disconnect here drops a whole MIRROR, not just credentials, which is
   why this screen is the one that asks for the account name. */

const START = "/api/integrations/servicem8/connect";

/* One live vendor.json read, resolved server-side on page load: proof the
   grant READS, plus the account identity. `null` means the read wasn't
   attempted (not connected, or ServiceM8 isn't set up here). */
export type Sm8Reach =
  | { ok: true; account: { name: string; timezoneName: string | null } }
  | { ok: false; error: string };

export type Servicem8ScreenProps = {
  connection: ConnectionView | null;
  /** Result of one live read; null when there was nothing to read through. */
  reach?: Sm8Reach | null;
  /** Per-object mirror progress; null until connected. */
  sync?: Sm8SyncStatusView | null;
  /** SM8_CLIENT_ID / SECRET / APP_BASE_URL are all present on this deployment. */
  configured: boolean;
  /** INTEGRATIONS_TOKEN_KEY is present — without it we refuse to store tokens. */
  sealed: boolean;
  /** Outcome of a round trip that just finished, if any. */
  notice: { kind: "ok" | "error"; text: string } | null;
  /** The people reconcile card's data; null until connected. */
  people?: PeopleCardData | null;
  /** Other HeyTiff workspaces holding this same ServiceM8 account. */
  elsewhere?: number;
  /** Sending files to ServiceM8 — null until connected, and on a
      deployment that can't write. */
  writes?: Sm8WritesView | null;
  /** Files still waiting to go to ServiceM8, which a disconnect cancels. */
  waitingWrites?: number;
  /** Notes still waiting, where the deployment sends notes. */
  waitingNotes?: number;
  /** Bookings still waiting, where the deployment sends bookings. */
  waitingBookings?: number;
  /** Leave still waiting, where the deployment sends leave. */
  waitingLeave?: number;
  /** New jobs still waiting, where the deployment sends them. */
  waitingJobs?: number;
  /** The write permissions the consent asks for beside the reads: the kinds
      the deployment allows that the owner has on (the page works them out,
      as the connect route does). Absent: the files permission alone. */
  writeScopes?: ScopeEntry[];
  /** The account this workspace was connected to before the current one,
      and when it was replaced; null when it never changed. */
  previousAccount?: { name: string | null; at: string } | null;
  /** Live updates from ServiceM8, when they aren't working: the one line
      that says so (sm8-hook-words). Absent while they work. */
  liveUpdates?: string | null;
};

/** The files permission alone — what a deployment that sends files asks. */
const FILES_SCOPES = SM8_WRITE_SCOPES.filter((s) => s.scope === "manage_attachments");

/** How many writes the asks line counts, by word. */
const WRITES = ["one write", "two writes", "three writes", "four writes", "five writes"];

/** What the asks list says of its writes: word for word as before with the
    files permission alone, and with files and notes. Bookings, with either
    or both, are said in the same pattern. */
function asksLine(writeScopes: readonly ScopeEntry[]): string {
  const files = writeScopes.some((s) => s.scope === "manage_attachments");
  const notes = writeScopes.some((s) => s.scope === "publish_job_notes");
  /* a booking needs manage_jobs as well; manage_schedule alone is leave */
  const bookings = writeScopes.some((s) => s.scope === "manage_jobs");
  const leaveOnly = !bookings && writeScopes.some((s) => s.scope === "manage_schedule");
  /* new jobs ask create_jobs, and only they do */
  const jobs = writeScopes.some((s) => s.scope === "create_jobs");
  const tail = "The list below is exactly what the consent screen will show.";
  if (bookings || leaveOnly || jobs) {
    const parts = [
      ...(files ? ["the files somebody sends from a job"] : []),
      ...(notes ? ["the notes people write here"] : []),
      ...(bookings ? ["the bookings people make here"] : leaveOnly ? ["the leave approved here"] : []),
      ...(jobs ? ["the jobs people start here"] : []),
    ];
    const said = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
    return `Reads, and ${WRITES[parts.length - 1]}: adding ${said}. ${tail}`;
  }
  if (files && notes) return `Reads, and two writes: adding the files somebody sends from a job, and the notes people write here. ${tail}`;
  if (notes) return `Reads, and one write: adding the notes people write here. ${tail}`;
  return `Reads, and one write: adding the files somebody sends from a job. ${tail}`;
}

/** "just now" / "4 min ago" / "3 hours ago" — the board's staleness language,
    deliberately vague past a day because a mirror that old is the story, not
    the minutes.

    IT READS THE CLOCK, so whatever renders it must wait for the browser —
    see `MirrorCard`. The board's own chip learned this the hard way and wrote
    it down (components/workboard/board/sm8-chip); this screen had the same
    helper and never got the same treatment, so it threw React #418 on every
    load and took the whole page's hydration with it. A blank admin screen is
    what that looks like from the outside. */
function agoLabel(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms) || ms < 0) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return "over a day ago";
}

/** 24996 → "24,996". A real account's first sync reaches five figures, and an
    unseparated run of digits is the one place a number stops being read. */
const num = (n: number) => n.toLocaleString("en-AU");

export function Servicem8Screen({
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
  writeScopes = FILES_SCOPES,
  previousAccount = null,
  liveUpdates = null,
}: Servicem8ScreenProps) {
  const provider = providerById("servicem8")!;
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const ready = configured && sealed;
  const connected = connection !== null;
  const attention =
    connection !== null &&
    (connection.status === "needs_reauth" || connection.missing.length > 0);
  /* The ask follows the owner's switch: the write permission is on the list,
     and on the consent screen, only while sending is On or Paused (a pause
     keeps the permission, so switching back on needs no reconnect). The
     status line says HeyTiff adds files only while it is On. */
  const writing = connection?.writeMode === "live";
  const asking = writing || connection?.writeMode === "paused";
  /* only the permissions this deployment asks for, and the owner has on:
     never the notes permission on a deployment that sends files alone */
  const asks = asking ? [...SM8_SCOPES, ...writeScopes] : SM8_SCOPES;

  const disconnect = () => {
    setError(null);
    setNote(null);
    start(async () => {
      const res = await disconnectServiceM8Action();
      if (res.ok) {
        if (res.note) setNote(res.note);
        router.refresh();
      } else setError(res.error);
    });
  };

  const syncNow = () => {
    setError(null);
    setNote(null);
    start(async () => {
      const res = await syncServiceM8NowAction();
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };


  /* The permissions fold to one line once connected and whole (2026-09-28,
     "way too much information displayed"). Before connecting the list is the
     preview of the consent screen, and a grant short of what is asked is the
     thing to read, so both of those open it. */
  const missingCount = asks.filter((s) => connection?.missing.includes(s.scope)).length;
  const [permsOpen, setPermsOpen] = useState(!connected || attention);
  const readCount = SM8_SCOPES.length;
  const writeCount = asks.length - readCount;
  /* THE CONNECTION'S HEALTH, AS ONE WORD IN ITS STATE'S COLOUR (Isaac,
     2026-09-28: "some sort of green signalling to show that it is connected,
     and working"). Green is earned, not assumed: it needs the grant whole,
     the live read to have worked, and the last sync to have finished. Each
     way short of that says which, in the colour that asks for a person. */
  const health: { tone: "ok" | "warn" | "bad"; word: string } | null = !connected
    ? null
    : connection.status === "needs_reauth"
      ? { tone: "bad", word: "Needs reconnecting" }
      : reach && !reach.ok
        ? { tone: "warn", word: "Connected, but can't be read" }
        : connection.missing.length > 0
          ? { tone: "warn", word: "Connected, missing access" }
          : sync?.lastRun?.running
            ? { tone: "ok", word: "Connected, syncing now" }
            : sync?.lastRun && sync.lastRun.ok === false
              ? { tone: "warn", word: "Connected, last sync didn't finish" }
              : { tone: "ok", word: "Connected and working" };

  const permsLine = [
    `${readCount} reads${writeCount > 0 ? ` and ${writeCount} write${writeCount === 1 ? "" : "s"}` : ""}${
      connected ? (missingCount > 0 ? `, ${missingCount} not granted yet.` : ", all granted.") : "."
    }`,
    `Powers the ${nameList(provider.uses.map((u) => u.area))}.`,
  ].join(" ");

  /* ── the ask, in full, folded to one line ──

     "What ServiceM8 powers here" was a section of its own, two paragraphs
     an owner reads once; it is the line's second sentence now. Beside the
     people once connected, under the connection before. */
  const permsCard = (
    <details
      className="card2 int-perms"
      open={permsOpen}
      onToggle={(e) => setPermsOpen(e.currentTarget.open)}
    >
      <summary>
        <b>Permissions</b>
        <span>{permsLine}</span>
        <i>
          {permsOpen ? "Hide" : "Show each"}
          <Icon name={permsOpen ? "chevU" : "chevD"} size={15} />
        </i>
      </summary>
      <p className="int-perms-ask">
        {asking ? asksLine(writeScopes) : "Read-only, every one of them. Nothing here writes to ServiceM8, and the list below is exactly what the consent screen will show."}
      </p>
      {[
        { head: "Reads", list: SM8_SCOPES },
        { head: "Writes, asked for while sending is On or Paused", list: asking ? writeScopes : [] },
      ]
        .filter((g) => g.list.length > 0)
        .map((g) => (
          <div key={g.head}>
            <h3 className="int-perms-head">{g.head}</h3>
            <ul className="int-perm-rows">
              {g.list.map((s) => {
                const missing = connection?.missing.includes(s.scope) ?? false;
                return (
                  <li key={s.scope} className={missing ? "missing" : undefined}>
                    <code>{s.scope}</code>
                    <p>{s.why}</p>
                    {missing ? (
                      <span className="int-tag warn">Not granted yet</span>
                    ) : connected ? (
                      <span className="int-tag ok">Granted</span>
                    ) : (
                      <span />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
    </details>
  );

  return (
    /* Paper to the frame, the title in the band and the way back above it
       (2026-09-20). Laid out to one screen at 1440 (2026-09-28): the
       connection across the top, what goes out and what came in side by
       side, the people and the permissions each folded to a line. */
    <div className="page in full">
      <div className="wrap">
        <div className="stg">
          <ScreenBand
            crumb={
              <Link href="/dashboard/admin/integrations" className="int-back">
                <Icon name="chevL" size={15} />
                Integrations
              </Link>
            }
            title="ServiceM8"
          />
          <ScreenPanel>
          <div className="int-sm8">

          {notice && (
            <div className={"int-note " + (notice.kind === "ok" ? "ok" : "bad")}>{notice.text}</div>
          )}
          {error && <div className="int-note bad">{error}</div>}
          {note && <div className="int-note bad">{note}</div>}

          {/* ── status ──

              Two columns (2026-09-28, "make use of as much of the screen as
              possible"): who and when on the left, the controls and the
              warning that goes with them on the right. The facts are one
              line: "Access granted" was the permissions line's count said
              twice, and the account's name was said three times. */}
          <div className="card2 int-conn">
            <div className="c2h int-connhead">
              <div style={{ minWidth: 0 }}>
                <div className="int-connname">
                  <b>{connected ? connection.tenantName ?? "Connected" : "Not connected"}</b>
                  {health && (
                    <span className={`int-health ${health.tone}`}>
                      {/* the dot is the same news as the word, for the eye
                          that scans the page before it reads it */}
                      <i aria-hidden="true" />
                      {health.word}
                    </span>
                  )}
                </div>
                <em>
                  {connected
                    ? attention
                      ? connection.status === "needs_reauth"
                        ? connection.lastError ?? "This connection needs reconnecting."
                        : "Connected, but missing some of the access HeyTiff now asks for."
                      : writing
                        ? "HeyTiff can read this ServiceM8 account, and add files to its jobs."
                        : "HeyTiff can read this ServiceM8 account."
                    : provider.blurb}
                </em>
                {connected && (
                  <dl className="int-connfacts">
                    <div>
                      <dt>Connected</dt>
                      {/* a timestamptz, so it resolves to an AU day before it is
                          formatted — see the note on fmtAuDayMonth */}
                      <dd>
                        {connection.connectedAt ? fmtAuWeekdayDate(auDayOf(connection.connectedAt)) : "—"}
                        {connection.connectedByName ? `, by ${connection.connectedByName}` : ""}
                      </dd>
                    </div>
                    {/* The account this one replaced. Its copy was cleared, so this
                        line is the one trace of which business it was. */}
                    {previousAccount && (
                      <div>
                        <dt>Previous account</dt>
                        <dd>
                          {previousAccount.name ?? "Another ServiceM8 account"}, until{" "}
                          {fmtAuWeekdayDate(auDayOf(previousAccount.at))}
                        </dd>
                      </div>
                    )}
                    {/* Proof the grant READS, not just that it exists. A connection
                        revoked from ServiceM8's own add-ons screen still has a row
                        and unexpired-looking tokens — this is where that shows. The
                        name it reads is the title's, so the fact is its clock. */}
                    {reach && (reach.ok ? reach.account.timezoneName !== null : true) && (
                      <div>
                        <dt>{reach.ok ? "Timezone" : "Account"}</dt>
                        <dd className={reach.ok ? undefined : "warn"}>
                          {reach.ok ? reach.account.timezoneName : "Couldn't read"}
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
              </div>
            </div>

            {/* when the mirror last moved: the card's width, under both columns */}
            {connected && sync && <SyncLine sync={sync} />}

            {/* live updates from ServiceM8, only when they aren't working:
                one sentence, the screen's own state word in the warning's
                colour. Nothing at all while they work. */}
            {connected && liveUpdates && <p className="int-tag warn">{liveUpdates}</p>}

            {!ready && (
              <div className="int-blocked">
                <b>ServiceM8 connections aren&apos;t switched on yet</b>
                <p>
                  Nothing for you to set up — this is on HeyTiff&apos;s side, and the button will
                  appear here once it&apos;s live.
                </p>
                {/* Dev-only detail, for whoever deploys HeyTiff — never env-var
                    names at a business owner. Next inlines NODE_ENV, so this
                    branch is dropped from a prod bundle. */}
                {process.env.NODE_ENV !== "production" && (
                  <ul>
                    {!configured && (
                      <li>
                        dev: no <code>SM8_CLIENT_ID</code> / <code>SM8_CLIENT_SECRET</code> /{" "}
                        <code>APP_BASE_URL</code>.
                      </li>
                    )}
                    {!sealed && (
                      <li>
                        dev: no <code>INTEGRATIONS_TOKEN_KEY</code>, and tokens are never stored
                        unencrypted.
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )}

            <ConnectActions
              label="ServiceM8"
              startHref={START}
              connected={connected}
              ready={ready}
              accountName={connection?.tenantName ?? null}
              elsewhere={elsewhere}
              /* the which-account warning opens on Reconnect, not before */
              warnOnReconnect
              /* Sync now beside Reconnect and Disconnect: the mirror's one
                 control, next to the sentence it changes */
              extraActions={
                connected && sync ? (
                  <button className="pbtn ghost" onClick={syncNow} disabled={busy}>
                    {busy ? "Syncing…" : "Sync now"}
                  </button>
                ) : null
              }
              /* Everything the wipe takes, named — this is the only control in
                 the integrations area that deletes anything. */
              consequences={[
                "HeyTiff's stored credentials for this account are deleted.",
                "Every mirrored row goes with them — clients, jobs, schedule, checklists and staff.",
                ...[sm8WaitingConsequence(waitingWrites, waitingNotes, waitingBookings, waitingLeave, waitingJobs)].filter(
                  (c): c is string => c !== null
                ),
                "Workboard rows you created here stay, on the names they already captured.",
                "Reconnecting the same account rebuilds the mirror in a few minutes.",
              ]}
              requirePhrase
              confirmNote="ServiceM8 has no remote switch-off, so to fully revoke access afterwards, remove HeyTiff from that ServiceM8 account's add-ons."
              busy={busy}
              onDisconnect={disconnect}
            />
          </div>

          {/* ── what goes out beside what came in ──
              Each card is the grid's own item, so the columns follow the
              width: sending, the mirror and the people in three at a wide
              screen, the mirror over the people at a laptop's. */}
          {connected ? (
            <div className={"int-sm8-grid" + (writes ? "" : " solo")}>
              {/* the other direction: files, notes and bookings sent from a job */}
              {writes && <Sm8WritesCard view={writes} />}
              {/* the mirror, object by object */}
              {sync && <MirrorCard sync={sync} />}
              <div className="int-sm8-people">
                {/* the people reconcile — import is a review, never a copy */}
                {people && <PeopleImportCard provider="servicem8" folded {...people} />}
                {permsCard}
              </div>
            </div>
          ) : (
            permsCard
          )}

          </div>
          </ScreenPanel>
        </div>
      </div>
    </div>
  );
}

/* ── when the mirror last moved ──

   THE ONLY BRANCH BELOW THAT READS A CLOCK WAITS FOR THE BROWSER. The
   server rendered "Last synced 4 min ago" and the client, a moment later
   across a minute boundary, rendered "5 min ago" — different text in the
   same node, which is React #418, and #418 does not fail politely: it takes
   the whole tree's hydration down, so THIS ENTIRE ADMIN SCREEN RENDERED
   BLANK. Found on prod 2026-09-01, and it is why nobody could reach the
   people card to link themselves to the crew.

   Not `suppressHydrationWarning` — that hides the error and keeps the
   SERVER's text until something else re-renders, so the line would sit
   there lying about how fresh the mirror is. The server sends the half of
   the sentence that cannot drift and the browser finishes it, which is the
   board chip's rule verbatim.

   It lives on the connection card (2026-09-28): whether the account is
   still being read is a fact about the connection. Sync now is in the
   card's controls, beside Reconnect. */
function SyncLine({ sync }: { sync: Sm8SyncStatusView }) {
  const hydrated = useHydrated();
  const reading = sync.objects.filter((o) => o.phase === "reading");
  const readingRows = reading.reduce((n, o) => n + o.rowsPulled, 0);

  /* Precedence: a run happening RIGHT NOW beats everything, then an unfinished
     backfill — which is the state that lasts for days and the one the card
     used to hide — then the ordinary "last synced" line. */
  const subtitle = sync.lastRun?.running
    ? "Syncing now…"
    : reading.length > 0
      ? `Still reading ${nameList(reading.map((o) => o.label))} across — ${num(readingRows)} row${
          readingRows === 1 ? "" : "s"
        } so far. Each sync picks up where the last one stopped.`
      : sync.lastRun?.finishedAt
        ? `Last synced${hydrated ? ` ${agoLabel(sync.lastRun.finishedAt)}` : ""}${
            sync.lastRun.note ? `. ${sync.lastRun.note}` : "."
          }`
        : "Waiting for the first sync.";

  return (
    <p className="int-syncline">
      <span>{subtitle}</span>
      {sync.lastCron !== undefined && <>{" "}<span>{overnightLine(sync.lastCron)}</span></>}
    </p>
  );
}

/* ── the mirror, object by object ──

   THE STATE THIS CARD KEPT SECRET: a first sync of a real account is not one
   event, it is a fortnight of runs. The engine's page budget caps a run at
   25,000 rows, so ServiceM8's ~25,000 attachments arrive over several — and
   between them the object's row carries `last_error: "Paused mid-walk"`, which
   this card rendered in the WARNING colour while saying nothing about the rows
   already read. The one object doing the most work looked like the one thing
   that had failed.

   So the row says which of four things is true — nothing yet, reading, read,
   or genuinely stuck — and a reading row shows its running total, which is
   the only honest progress signal available: ServiceM8's pagination hands
   back a cursor, never a count, so there is no denominator to show. A number
   that climbs each sync is the proof; a percentage would be invented.

   A ledger in two columns (2026-09-28): a read object is a name and a count.
   Anything still moving or stuck takes the whole width, because its tag is a
   sentence. */
function MirrorCard({ sync }: { sync: Sm8SyncStatusView }) {
  const done = sync.objects.filter((o) => o.phase === "done");
  const moving = sync.objects.filter((o) => o.phase !== "done");
  const all = sync.objects.length;
  const rows = done.reduce((n, o) => n + o.rowsPulled, 0);
  /* Folded to its sum on a laptop (2026-09-28, "without having to
     scroll"): what is still reading or stuck stays in view, because that is
     the news; what has been read is a count behind Show each. A wide screen
     has the room, and shows every row. */
  const [open, setOpen] = useState(false);
  return (
    <div className="card2 int-mirrorcard">
      <div className="c2h">
        <b style={{ flex: 1 }}>Read from ServiceM8</b>
        <span className={"int-tag" + (done.length === all ? " ok" : "")}>
          {done.length === all ? `All ${all} read` : `${done.length} of ${all} read`}
        </span>
      </div>
      {moving.length > 0 && (
        <ul className="int-mirror">
          {moving.map((o) => (
            <li key={o.object} className="wide">
              <span>{o.label}</span>
              <ObjectTag o={o} />
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <>
          <div className="int-foldrow">
            <span>
              {num(rows)} row{rows === 1 ? "" : "s"} across {done.length === 1 ? done[0].label : `${done.length} kinds of record`}
            </span>
            <button type="button" className="int-foldbtn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? "Hide" : "Show each"}
              <Icon name={open ? "chevU" : "chevD"} size={15} />
            </button>
          </div>
          {/* folded by a class, not left out: where the grid has three
              columns there is room for every row, and the sheet opens it */}
          <ul className={"int-mirror int-mirror-done" + (open ? "" : " folded")}>
            {done.map((o) => (
              <li key={o.object}>
                <span>{o.label}</span>
                <ObjectTag o={o} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** When Vercel's scheduler last ran the overnight sync, as an AU day and
    time: no clock is read, so the server and the browser write the same
    words (see MirrorCard). Null: it never has — what an unset CRON_SECRET
    looks like from here. */
function overnightLine(lastCron: string | null): string {
  if (lastCron === null || Number.isNaN(Date.parse(lastCron))) return "The overnight sync hasn't run.";
  return `Last overnight sync: ${fmtAuWeekdayDayMonth(auDayOf(lastCron))}, ${fmtAuTime(new Date(lastCron))}`;
}

/** One object's state as one tag. `blocked` is the only one that warns — which
    is the whole point of the split: the warning colour now means somebody is
    needed, and nothing else wears it. */
function ObjectTag({ o }: { o: Sm8ObjectStatus }) {
  if (o.phase === "blocked") return <span className="int-tag warn">{o.lastError}</span>;

  if (o.phase === "reading")
    return (
      <span className="int-tag live">
        {/* aria-hidden: the dot is the same news as the words beside it, and a
            screen reader announcing a decoration twice is noise. */}
        <i className="int-pulse" aria-hidden="true" />
        Reading, {num(o.rowsPulled)} so far
      </span>
    );

  /* the ledger's count: the name beside it says what the rows are */
  if (o.phase === "done") return <span className="int-tag">{num(o.rowsPulled)}</span>;

  return <span className="int-tag">First sync queued</span>;
}
