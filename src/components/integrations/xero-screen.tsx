"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { auDayOf, fmtAuWeekdayDate } from "@/lib/au-dates";
import { providerById, XERO_SCOPES } from "@/lib/integrations/providers";
import type { ConnectionView } from "@/lib/integrations/connection";
import { disconnectXeroAction, setXeroTenantAction } from "@/app/actions/integrations";
import { PeopleImportCard, type PeopleCardData } from "@/components/integrations/people-import-card";
import { ConnectActions } from "@/components/integrations/connect-actions";

/* The Xero connection screen.

   Two things this page refuses to be vague about, because a person is about to
   hand over their accounting system:

   WHAT IT IS FOR — the three areas Xero feeds here, named before the button.
   WHAT IT CAN SEE — every scope, with the sentence explaining why, rendered
   from the same list the consent URL is built from. If the list and the ask
   ever diverge it is a bug in one file, not a discrepancy between a marketing
   page and a request.

   Disconnect is two-step rather than a browser confirm(): the second click is
   the confirmation, in the page's own language, and it stays reversible right
   up until it isn't. */

const START = "/api/integrations/xero/connect";

/* What the grant can actually SEE, resolved server-side on page load.

   This is deliberately not a count we could compute from our own tables: it is
   the answer to a real call to Xero, so a connection that looks healthy but
   can't read anything says so here rather than at the first sync. `null` means
   the read wasn't attempted (not connected, or Xero isn't set up). */
export type XeroReach = { ok: true; employees: number } | { ok: false; error: string };

export type XeroScreenProps = {
  connection: ConnectionView | null;
  /** The people reconcile card's data; null until connected. */
  people?: PeopleCardData | null;
  /** Result of one live read; null when there was nothing to read through. */
  reach?: XeroReach | null;
  /** XERO_CLIENT_ID / SECRET / APP_BASE_URL are all present on this deployment. */
  configured: boolean;
  /** INTEGRATIONS_TOKEN_KEY is present — without it we refuse to store tokens. */
  sealed: boolean;
  /** Outcome of a round trip that just finished, if any. */
  notice: { kind: "ok" | "error"; text: string } | null;
};

export function XeroScreen({
  connection,
  configured,
  sealed,
  notice,
  reach,
  people,
}: XeroScreenProps) {
  const provider = providerById("xero")!;
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tenantPick, setTenantPick] = useState(connection?.tenantId ?? "");

  const ready = configured && sealed;
  const connected = connection !== null;
  const attention =
    connection !== null &&
    (connection.status === "needs_reauth" || connection.missing.length > 0);

  const disconnect = () => {
    setError(null);
    setNote(null);
    start(async () => {
      const res = await disconnectXeroAction();
      if (res.ok) {
        if (res.note) setNote(res.note);
        router.refresh();
      } else setError(res.error);
    });
  };

  const switchTenant = () => {
    setError(null);
    setNote(null);
    start(async () => {
      const res = await setXeroTenantAction(tenantPick);
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
                Xero
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
                <Icon name="xero" size={20} />
              </span>
              <div style={{ minWidth: 0 }}>
                <b>{connected ? connection.tenantName ?? "Connected" : "Not connected"}</b>
                <em>
                  {connected
                    ? attention
                      ? connection.status === "needs_reauth"
                        ? connection.lastError ?? "This connection needs reconnecting."
                        : "Connected, but missing some of the access HeyTiff now asks for."
                      : "HeyTiff can read this Xero organisation."
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
                    can be stored, unexpired and useless — revoked from Xero's
                    own Connected Apps screen — and this is where that shows,
                    rather than at the first sync somebody depends on. */}
                {reach && (
                  <div>
                    <dt>Payroll</dt>
                    <dd>
                      {reach.ok
                        ? `${reach.employees} employee${reach.employees === 1 ? "" : "s"} visible`
                        : "Couldn't read"}
                    </dd>
                  </div>
                )}
              </dl>
            )}

            {connection && reach?.ok && reach.employees > 0 && (
              <p className="int-hint" style={{ marginTop: 0, marginBottom: 18 }}>
                Match them to the people in this workspace in{" "}
                <Link href="/dashboard/timepay" className="ro-link">
                  Time &amp; Pay settings
                </Link>
                .
              </p>
            )}

            {!ready && (
              <div className="int-blocked">
                <b>Xero connections aren&apos;t switched on yet</b>
                <p>
                  Nothing for you to set up — this is on HeyTiff&apos;s side, and the button will
                  appear here once it&apos;s live.
                </p>
                {/* The missing-variable detail is for whoever DEPLOYS HeyTiff, not
                    for the business owner reading this — naming env vars at them
                    reads as "you must supply these", which is the one thing this
                    integration deliberately doesn't ask of a customer. Next inlines
                    NODE_ENV, so this whole branch is dropped from a prod bundle. */}
                {process.env.NODE_ENV !== "production" && (
                  <ul>
                    {!configured && (
                      <li>
                        dev: no <code>XERO_CLIENT_ID</code> / <code>XERO_CLIENT_SECRET</code> /{" "}
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
              label="Xero"
              startHref={START}
              connected={connected}
              ready={ready}
              accountName={connection?.tenantName ?? null}
              /* Credentials only — no mirror to lose, and the staff↔employee
                 matches deliberately survive so a reconnect restores them.
                 That's why this one doesn't ask for the name. */
              consequences={[
                "HeyTiff's stored credentials are deleted, and Xero is told the authorisation is finished.",
                "Nothing in Xero itself changes — the integration only ever reads.",
                "Staff matched to payroll employees stay matched, so reconnecting the same organisation restores them.",
              ]}
              busy={busy}
              onDisconnect={disconnect}
            />
          </div>

          {/* ── which organisation, when the grant covers more than one ── */}
          {connected && connection.tenants.length > 1 && (
            <div className="card2">
              <div className="c2h">
                <span className="ci">
                  <Icon name="hexagon" size={19} />
                </span>
                <div>
                  <b>Xero organisation</b>
                  <em>This login covers more than one — pick the books this workspace uses.</em>
                </div>
              </div>
              <div className="int-tenants">
                {connection.tenants.map((t) => (
                  <label key={t.tenantId} className="int-tenant">
                    <input
                      type="radio"
                      name="tenant"
                      value={t.tenantId}
                      checked={tenantPick === t.tenantId}
                      onChange={() => setTenantPick(t.tenantId)}
                    />
                    <span>{t.tenantName}</span>
                  </label>
                ))}
              </div>
              <div className="int-act">
                <button
                  className="pbtn primary"
                  onClick={switchTenant}
                  disabled={busy || !tenantPick || tenantPick === connection.tenantId}
                >
                  {busy ? "Switching…" : "Use this organisation"}
                </button>
              </div>
            </div>
          )}

          {/* ── the people reconcile — import is a review, never a copy ── */}
          {connected && people && <PeopleImportCard provider="xero" {...people} />}

          {/* ── what it powers ── */}
          <div className="card2">
            <div className="c2h">
              <span className="ci">
                <Icon name="sync" size={19} />
              </span>
              <div>
                <b>What Xero powers here</b>
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
                <b>What HeyTiff asks Xero for</b>
                <em>
                  Read-only, every one of them. Nothing here writes to Xero, and the list below is
                  exactly what the consent screen will show.
                </em>
              </div>
            </div>
            <ul className="int-scopes">
              {XERO_SCOPES.map((s) => {
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
