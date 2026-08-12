"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/icon";

/* Connect / Reconnect / Disconnect — one component, both providers, because
   the two screens had near-identical copies of this block and the guards
   below are exactly the kind of thing that gets fixed in one and forgotten in
   the other.

   IT EXISTS BECAUSE THE FLOW WAS SILENT AT BOTH ENDS. On 2026-08-10 a live
   business ServiceM8 account was connected by accident: OAuth authorises
   whichever account the BROWSER is already signed into, and it never asks
   which one you meant. Nothing here warned beforehand, and the success notice
   said only "ServiceM8 is connected" — so the wrong account looked exactly
   like the right one, and 42,000 rows of a real client book synced before
   anybody noticed. Both halves of that are fixed: this warns before, and the
   page names the account after.

   DISCONNECT IS THE ONLY DESTRUCTIVE CONTROL in the integrations area. Every
   failure path — expired token, revoked add-on, billing, a 5xx — only ever
   flags the connection `needs_reauth` and leaves the data alone. So this is
   the one button worth spelling out and slowing down, and `confirmPhrase`
   asks for the account's own name where the delete is bulk. */

export type ConnectActionsProps = {
  /** "ServiceM8" / "Xero" — every sentence here is written from this. */
  label: string;
  /** The API route that begins consent. */
  startHref: string;
  connected: boolean;
  /** Whether the app credentials exist on this deployment. */
  ready: boolean;
  /** The connected account's name, when we know it — what a reconnect is
      being compared against, and what disconnect asks you to type. */
  accountName?: string | null;
  /** What disconnecting actually removes, in plain words. Provider-specific
      because the two are genuinely different: ServiceM8 drops a whole mirror,
      Xero drops credentials only. */
  consequences: string[];
  /** Require typing the account name to confirm. For a disconnect that
      deletes in bulk; a credentials-only disconnect doesn't earn it. */
  requirePhrase?: boolean;
  /** Extra sentence under the confirm, e.g. the no-revoke-endpoint note. */
  confirmNote?: string;
  /** How many OTHER HeyTiff workspaces hold this same provider account. A
      count, never names — see countConnectionsElsewhere for why this is
      surfaced rather than refused. */
  elsewhere?: number;
  busy: boolean;
  onDisconnect: () => void;
};

export function ConnectActions({
  label,
  startHref,
  connected,
  ready,
  accountName,
  consequences,
  requirePhrase = false,
  confirmNote,
  elsewhere = 0,
  busy,
  onDisconnect,
}: ConnectActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");

  /* Case- and space-insensitive: this is a "did you read which account this
     is" check, not a typing test, and a trailing space shouldn't refuse
     somebody who meant it. */
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
  const phraseOk = !requirePhrase || !accountName || norm(typed) === norm(accountName);

  const close = () => {
    setConfirming(false);
    setTyped("");
  };

  return (
    <>
      {/* The warning that would have prevented the accident — before the
          button, not after, and shown for a first connection as well as a
          reconnect. */}
      {ready && !confirming && (
        <div className="int-consent">
          <Icon name="alert" size={15} />
          <p>
            You&apos;ll be connected as whichever {label} account this browser is already signed
            in to — {label} won&apos;t ask you to choose. To use a different one, sign out of{" "}
            {label} first or open HeyTiff in a private window.
            {connected && accountName ? (
              <>
                {" "}
                This workspace is currently connected to <b>{accountName}</b>.
              </>
            ) : null}
          </p>
        </div>
      )}

      {/* Somebody else holds this same account. Stated, not blocked: sharing
          one account across workspaces is legitimate, but it must not be
          invisible to the person whose client book it is. */}
      {connected && elsewhere > 0 && !confirming && (
        <div className="int-consent">
          <Icon name="users" size={15} />
          <p>
            This {label} account is also connected to{" "}
            <b>
              {elsewhere} other HeyTiff workspace{elsewhere === 1 ? "" : "s"}
            </b>
            . Each one mirrors its own copy of this account&apos;s data, and disconnecting here
            doesn&apos;t affect theirs. If that isn&apos;t expected, remove HeyTiff&apos;s access
            from inside {label}.
          </p>
        </div>
      )}

      <div className="int-act">
        {ready && !confirming && (
          /* A plain <a>, not <Link>: this is an API route, and a prefetch on
             hover would mint an OAuth state per hover and overwrite the one a
             half-finished flow depends on. */
          <a className={"pbtn " + (connected ? "ghost" : "primary")} href={startHref}>
            <Icon name="plug" size={16} />
            {connected ? "Reconnect" : `Connect to ${label}`}
          </a>
        )}
        {connected && !confirming && (
          <button className="pbtn ghost" onClick={() => setConfirming(true)}>
            Disconnect
          </button>
        )}
      </div>

      {confirming && (
        <div className="int-danger">
          <b>
            Disconnect {accountName ? <>{label} — {accountName}</> : label}?
          </b>
          <ul>
            {consequences.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          {confirmNote && <p className="int-hint">{confirmNote}</p>}

          {requirePhrase && accountName && (
            <label className="int-typed">
              <span>
                Type <b>{accountName}</b> to confirm
              </span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={accountName}
                aria-label={`Type ${accountName} to confirm`}
                autoComplete="off"
              />
            </label>
          )}

          <div className="int-act">
            {/* Keeping it is the easy, default-looking choice; the
                destructive one has to be reached for. */}
            <button className="pbtn primary" onClick={close} disabled={busy}>
              Keep it
            </button>
            <button
              className="pbtn danger"
              onClick={onDisconnect}
              disabled={busy || !phraseOk}
            >
              {busy ? "Disconnecting…" : "Yes, disconnect"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
