"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { auDayOf, fmtAuWeekdayDate } from "@/lib/au-dates";
import { useHydrated } from "@/lib/use-hydrated";
import { providerById, SM8_SCOPES } from "@/lib/integrations/providers";
import type { ConnectionView } from "@/lib/integrations/connection";
import type { Sm8ObjectStatus, Sm8SyncStatusView } from "@/lib/integrations/sm8-sync";
import { disconnectServiceM8Action, syncServiceM8NowAction } from "@/app/actions/integrations";
import { PeopleImportCard, type PeopleCardData } from "@/components/integrations/people-import-card";
import { ConnectActions } from "@/components/integrations/connect-actions";

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
};

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

/** "Attachments", "Attachments and Jobs", "Attachments, Jobs and 2 more". */
function nameList(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels[0]}, ${labels[1]} and ${labels.length - 2} more`;
}

export function Servicem8Screen({
  connection,
  configured,
  sealed,
  notice,
  reach,
  sync,
  people,
  elsewhere = 0,
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

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg" style={{ maxWidth: 760 }}>
          <div className="v2head" style={{ marginBottom: 18 }}>
            <div>
              <Link href="/dashboard/admin/integrations" className="int-back">
                <Icon name="chevL" size={15} />
                Integrations
              </Link>
              <h1 style={{ margin: "10px 0 0" }}>
                ServiceM8
              </h1>
            </div>
          </div>

          {notice && (
            <div className={"int-note " + (notice.kind === "ok" ? "ok" : "bad")}>{notice.text}</div>
          )}
          {error && <div className="int-note bad">{error}</div>}
          {note && <div className="int-note bad">{note}</div>}

          {/* ── status ── */}
          <div className="card2">
            <div className="c2h">
              <span
                className="ci"
                style={{ background: provider.accent + "1a", color: provider.accent }}
              >
                <Icon name="servicem8" size={20} />
              </span>
              <div style={{ minWidth: 0 }}>
                <b>{connected ? connection.tenantName ?? "Connected" : "Not connected"}</b>
                <em>
                  {connected
                    ? attention
                      ? connection.status === "needs_reauth"
                        ? connection.lastError ?? "This connection needs reconnecting."
                        : "Connected, but missing some of the access HeyTiff now asks for."
                      : "HeyTiff can read this ServiceM8 account."
                    : provider.blurb}
                </em>
              </div>
            </div>

            {connected && (
              <dl className="int-facts">
                <div>
                  <dt>Connected</dt>
                  {/* a timestamptz, so it resolves to an AU day before it is
                      formatted — see the note on fmtAuDayMonth */}
                  <dd>
                    {connection.connectedAt
                      ? fmtAuWeekdayDate(auDayOf(connection.connectedAt))
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Connected by</dt>
                  <dd>{connection.connectedByName ?? "—"}</dd>
                </div>
                <div>
                  <dt>Access granted</dt>
                  <dd>
                    {connection.scopes.length} permission
                    {connection.scopes.length === 1 ? "" : "s"}
                  </dd>
                </div>
                {/* Proof the grant READS, not just that it exists. A connection
                    revoked from ServiceM8's own add-ons screen still has a row
                    and unexpired-looking tokens — this is where that shows. */}
                {reach && (
                  <div>
                    <dt>Account</dt>
                    <dd>
                      {reach.ok
                        ? reach.account.timezoneName
                          ? `${reach.account.name} · ${reach.account.timezoneName}`
                          : reach.account.name
                        : "Couldn't read"}
                    </dd>
                  </div>
                )}
              </dl>
            )}

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
              /* Everything the wipe takes, named — this is the only control in
                 the integrations area that deletes anything. */
              consequences={[
                "HeyTiff's stored credentials for this account are deleted.",
                "Every mirrored row goes with them — clients, jobs, schedule, checklists and staff.",
                "Workboard rows you created here stay, on the names they already captured.",
                "Reconnecting the same account rebuilds the mirror in a few minutes.",
              ]}
              requirePhrase
              confirmNote="ServiceM8 has no remote switch-off, so to fully revoke access afterwards, remove HeyTiff from that ServiceM8 account's add-ons."
              busy={busy}
              onDisconnect={disconnect}
            />
          </div>

          {/* ── the mirror, object by object ── */}
          {connected && sync && <MirrorCard sync={sync} busy={busy} onSync={syncNow} />}

          {/* ── the people reconcile — import is a review, never a copy ── */}
          {connected && people && <PeopleImportCard provider="servicem8" {...people} />}

          {/* ── what it powers ── */}
          <div className="card2">
            <div className="c2h">
              <span className="ci">
                <Icon name="sync" size={19} />
              </span>
              <div>
                {/* NO SUBTITLE. It read "Connecting is step one — each of
                    these lands as it's built", which is a roadmap in a
                    settings screen: it told an owner deciding whether to
                    connect that some of the list below does not exist yet,
                    without saying which. The heading names the card and the
                    list is the answer. */}
                <b>What ServiceM8 powers here</b>
              </div>
            </div>
            <div className="int-uses">
              {provider.uses.map((u) => (
                <div className="int-use" key={u.area}>
                  <b>{u.area}</b>
                  <p>{u.detail}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── the ask, in full ── */}
          <div className="card2">
            <div className="c2h">
              <span className="ci">
                <Icon name="shield" size={19} />
              </span>
              <div>
                <b>What HeyTiff asks ServiceM8 for</b>
                <em>
                  Read-only, every one of them. Nothing here writes to ServiceM8, and the list
                  below is exactly what the consent screen will show.
                </em>
              </div>
            </div>
            <ul className="int-scopes">
              {SM8_SCOPES.map((s) => {
                const missing = connection?.missing.includes(s.scope) ?? false;
                return (
                  <li key={s.scope} className={missing ? "missing" : undefined}>
                    <div className="int-scopehead">
                      <code>{s.scope}</code>
                      {s.area && <span className="int-tag">{s.area}</span>}
                      {missing && <span className="int-tag warn">Not granted yet</span>}
                    </div>
                    <p>{s.why}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
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

   So the row now says which of four things is true — nothing yet, reading,
   read, or genuinely stuck — and a reading row shows its running total, which
   is the only honest progress signal available: ServiceM8's pagination hands
   back a cursor, never a count, so there is no denominator to show. A number
   that climbs each sync is the proof; a percentage would be invented. */
function MirrorCard({
  sync,
  busy,
  onSync,
}: {
  sync: Sm8SyncStatusView;
  busy: boolean;
  onSync: () => void;
}) {
  /* THE ONLY BRANCH BELOW THAT READS A CLOCK WAITS FOR THE BROWSER. The
     server rendered "Last synced 4 min ago" and the client, a moment later
     across a minute boundary, rendered "5 min ago" — different text in the
     same node, which is React #418, and #418 does not fail politely: it takes
     the whole tree's hydration down, so THIS ENTIRE ADMIN SCREEN RENDERED
     BLANK. Found on prod 2026-09-01, and it is why nobody could reach the
     people card to link themselves to the crew.

     Not `suppressHydrationWarning` — that hides the error and keeps the
     SERVER's text until something else re-renders, so the card would sit
     there lying about how fresh the mirror is. The server sends the half of
     the sentence that cannot drift and the browser finishes it, which is the
     board chip's rule verbatim. */
  const hydrated = useHydrated();
  const reading = sync.objects.filter((o) => o.phase === "reading");
  const readingRows = reading.reduce((n, o) => n + o.rowsPulled, 0);

  /* Precedence: a run happening RIGHT NOW beats everything, then an unfinished
     backfill — which is the state that lasts for days and the one this card
     used to hide — then the ordinary "last synced" line. */
  const subtitle = sync.lastRun?.running
    ? "Syncing now…"
    : reading.length > 0
      ? `Still reading ${nameList(reading.map((o) => o.label))} across — ${num(readingRows)} row${
          readingRows === 1 ? "" : "s"
        } so far. Each sync picks up where the last one stopped.`
      : sync.lastRun?.finishedAt
        ? `Last synced${hydrated ? ` ${agoLabel(sync.lastRun.finishedAt)}` : ""}${
            sync.lastRun.note ? ` — ${sync.lastRun.note}` : ""
          }`
        : "Waiting for the first sync.";

  return (
    <div className="card2">
      <div className="c2h">
        <span className="ci">
          <Icon name="sync" size={19} />
        </span>
        <div style={{ minWidth: 0 }}>
          <b>What&apos;s been read across</b>
          <em>{subtitle}</em>
        </div>
      </div>
      <ul className="int-scopes">
        {sync.objects.map((o) => (
          <li key={o.object}>
            <div className="int-scopehead">
              <code>{o.label}</code>
              <ObjectTag o={o} />
            </div>
          </li>
        ))}
      </ul>
      <div className="int-act">
        <button className="pbtn ghost" onClick={onSync} disabled={busy}>
          {busy ? "Syncing…" : "Sync now"}
        </button>
      </div>
    </div>
  );
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
        Reading · {num(o.rowsPulled)} so far
      </span>
    );

  if (o.phase === "done")
    return (
      <span className="int-tag">
        {num(o.rowsPulled)} row{o.rowsPulled === 1 ? "" : "s"}
      </span>
    );

  return <span className="int-tag">First sync queued</span>;
}
