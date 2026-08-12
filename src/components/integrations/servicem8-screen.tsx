"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { auDayOf, fmtAuWeekdayDate } from "@/lib/au-dates";
import { providerById, SM8_SCOPES } from "@/lib/integrations/providers";
import type { ConnectionView } from "@/lib/integrations/connection";
import type { Sm8SyncStatusView } from "@/lib/integrations/sm8-sync";
import { disconnectServiceM8Action, syncServiceM8NowAction } from "@/app/actions/integrations";
import { PeopleImportCard, type PeopleCardData } from "@/components/integrations/people-import-card";

/* The ServiceM8 connection screen — xero-screen's sibling, same two refusals
   to be vague (WHAT IT IS FOR, WHAT IT CAN SEE), same two-step disconnect.

   Differences that are real, not stylistic: one ServiceM8 account per grant
   (no organisation picker), and ServiceM8 has no revocation endpoint — so the
   disconnect copy tells the owner the one step that finishes the job on
   ServiceM8's side instead of implying we did it for them. */

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
};

/** "just now" / "4 min ago" / "3 hours ago" — the board's staleness language,
    deliberately vague past a day because a mirror that old is the story, not
    the minutes. */
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

export function Servicem8Screen({
  connection,
  configured,
  sealed,
  notice,
  reach,
  sync,
  people,
}: Servicem8ScreenProps) {
  const provider = providerById("servicem8")!;
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

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
        setConfirming(false);
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

            <div className="int-act">
              {ready && (
                /* A plain <a>, not <Link>: this is an API route, and a prefetch
                   on hover would mint an OAuth state per hover and overwrite the
                   one a half-finished flow depends on. */
                <a className={"pbtn " + (connected ? "ghost" : "primary")} href={START}>
                  <Icon name="plug" size={16} />
                  {connected ? "Reconnect" : "Connect to ServiceM8"}
                </a>
              )}
              {connected &&
                (confirming ? (
                  <>
                    <button className="pbtn danger" onClick={disconnect} disabled={busy}>
                      {busy ? "Disconnecting…" : "Yes, disconnect"}
                    </button>
                    <button
                      className="pbtn ghost"
                      onClick={() => setConfirming(false)}
                      disabled={busy}
                    >
                      Keep it
                    </button>
                  </>
                ) : (
                  <button className="pbtn ghost" onClick={() => setConfirming(true)}>
                    Disconnect
                  </button>
                ))}
            </div>
            {confirming && (
              <p className="int-hint">
                HeyTiff will drop its stored credentials and stop reading this account. ServiceM8
                itself has no remote switch-off, so to fully revoke access afterwards, remove
                HeyTiff from your ServiceM8 account&apos;s add-ons.
              </p>
            )}
          </div>

          {/* ── the mirror, object by object ── */}
          {connected && sync && (
            <div className="card2">
              <div className="c2h">
                <span className="ci">
                  <Icon name="sync" size={19} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <b>What&apos;s been read across</b>
                  <em>
                    {sync.lastRun?.running
                      ? "Syncing now…"
                      : sync.lastRun?.finishedAt
                        ? `Last synced ${agoLabel(sync.lastRun.finishedAt)}${
                            sync.lastRun.note ? ` — ${sync.lastRun.note}` : ""
                          }`
                        : "Waiting for the first sync."}
                  </em>
                </div>
              </div>
              <ul className="int-scopes">
                {sync.objects.map((o) => (
                  <li key={o.object}>
                    <div className="int-scopehead">
                      <code>{o.label}</code>
                      {o.lastError ? (
                        <span className="int-tag warn">{o.lastError}</span>
                      ) : o.backfillDone ? (
                        <span className="int-tag">
                          {o.rowsPulled} row{o.rowsPulled === 1 ? "" : "s"}
                        </span>
                      ) : (
                        <span className="int-tag warn">First sync queued</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="int-act">
                <button className="pbtn ghost" onClick={syncNow} disabled={busy}>
                  {busy ? "Syncing…" : "Sync now"}
                </button>
              </div>
            </div>
          )}

          {/* ── the people reconcile — import is a review, never a copy ── */}
          {connected && people && <PeopleImportCard provider="servicem8" {...people} />}

          {/* ── what it powers ── */}
          <div className="card2">
            <div className="c2h">
              <span className="ci">
                <Icon name="sync" size={19} />
              </span>
              <div>
                <b>What ServiceM8 powers here</b>
                <em>Connecting is step one — each of these lands as it&apos;s built.</em>
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
