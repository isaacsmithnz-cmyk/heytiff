"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonClass } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Field, TextInput } from "@/components/parts/field";
import { Dot, StateWord, stateTone, type Tone } from "@/components/parts/state";
import { useToast } from "@/components/parts/toast";
import { Setting, Wrong } from "@/components/settings/parts";
import type { ScopeEntry } from "@/lib/integrations/providers";
import type { IntegrationResult } from "@/app/actions/integrations";

/* THE PIECES BOTH APPS' GROUPS SHARE in Settings › Integrations (v2, 25
   October 2026): a sentence in a state's colour, the action runner, the
   permissions list, and the two dialogs that guard a connection, Connect
   and Disconnect. One copy for both apps, because the guards below are
   exactly the kind of thing that gets fixed in one and forgotten in the
   other.

   THE GUARDS EXIST BECAUSE THE FLOW WAS SILENT AT BOTH ENDS. On 2026-08-10
   a live business ServiceM8 account was connected by accident: OAuth
   authorises whichever account the BROWSER is already signed into, and it
   never asks which one you meant. Nothing warned beforehand, and the
   success notice named nothing, so the wrong account looked exactly like
   the right one. Both halves are fixed: Connect says so before anything
   leaves for the app, and the page names the account after.

   DISCONNECT IS THE ONLY DESTRUCTIVE CONTROL here. Every failure path (an
   expired token, a revoked add-on, billing, a 5xx) only ever flags the
   connection `needs_reauth` and leaves the data alone. So it is the one
   control worth spelling out and slowing down, and where the delete is bulk
   it asks for the account's own name. */

/** A sentence in a state's colour, with its dot (rule 17): good in green,
    needs a look in orange, for your information in grey. Never a pill or a
    box. What went wrong is the frame's Wrong (rule 42). */
export function Said({ tone, children }: { tone: Exclude<Tone, "wrong">; children: ReactNode }) {
  return (
    <p className={`st2-int-said st2-int-said--${tone}`}>
      <Dot hue={stateTone(tone)} />
      <span>{children}</span>
    </p>
  );
}

/* AN ACTION ON A CONNECTION. One at a time; while it is out its control
   says what it's doing. A refusal is said under its own row and nothing is
   reloaded, so the page never looks as though it took; a success says so
   in a toast, where there is something to say, and reloads what the page
   shows. */
export function useIntegrationAct() {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (
    key: string,
    act: () => Promise<IntegrationResult>,
    /** what the toast says, from the action's own note */
    said: (note: string | undefined) => string | null,
    after?: (note: string | undefined) => void,
  ) => {
    if (busy) return;
    setError(null);
    setPending(key);
    /* no try/finally: the compiler can't lower one, even in a callback */
    start(async () => {
      const res = await act().catch(() => null);
      setPending(null);
      if (!res) {
        setError("Couldn't reach HeyTiff. Check your connection and try again.");
        return;
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const text = said(res.note);
      if (text) toast({ text });
      after?.(res.note);
      router.refresh();
    });
  };

  return { run, busy, pending, error };
}

/* WHAT HEYTIFF ASKS THE APP FOR, rendered from the same list the consent
   URL is built from, so the list and the ask can only diverge in one file.
   Folded to one row once connected and whole (2026-09-28, "way too much
   information displayed"); before connecting it is the preview of the
   consent screen, and a grant short of what is asked is the thing to read,
   so both of those open it. */
export function Permissions({
  line,
  groups,
  connected,
  missing,
  open: startOpen,
}: {
  line: string;
  groups: readonly { label: string; list: readonly ScopeEntry[] }[];
  connected: boolean;
  missing: readonly string[];
  open: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  return (
    <>
      <Setting name="Permissions" line={line}>
        <Button kind="quiet" size={32} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Hide them" : "Show each"}
        </Button>
      </Setting>
      {open && (
        <div className="st2-int-open">
          {groups
            .filter((g) => g.list.length > 0)
            .map((g) => (
              <div className="st2-int-part" key={g.label}>
                <p className="st2-int-cap">{g.label}</p>
                {g.list.map((s) => {
                  const short = missing.includes(s.scope);
                  return (
                    <Setting key={s.scope} name={s.scope} line={s.area ? `${s.area}. ${s.why}` : s.why}>
                      {connected &&
                        (short ? (
                          <StateWord tone="look" className="st2-int-word">
                            Not granted yet
                          </StateWord>
                        ) : (
                          <StateWord tone="good" className="st2-int-word">
                            Granted
                          </StateWord>
                        ))}
                    </Setting>
                  );
                })}
              </div>
            ))}
        </div>
      )}
    </>
  );
}

/** A connection that isn't switched on for this deployment: ours to finish,
    never a job the owner has been handed. The env names are for whoever
    deploys HeyTiff, and Next drops the branch from a production bundle. */
export function NotSwitchedOn({ label, missing }: { label: string; missing: readonly string[] }) {
  return (
    <>
      {/* one string: JSX drops the space between {label} and text holding an entity */}
      <Said tone="info">
        {`${label} connections aren't switched on here yet. Nothing for you to set up: it's on HeyTiff's side, and Connect appears here once it's live.`}
      </Said>
      {process.env.NODE_ENV !== "production" && missing.length > 0 && (
        <p className="st2-int-dev">dev: no {missing.join(", ")}.</p>
      )}
    </>
  );
}

/* CONNECT, AND RECONNECT. The warning that would have prevented the
   accident, at the moment it is for: after the press, before anything
   leaves for the app, with the way on a second, deliberate press. The way
   on is a plain <a>, not next/link: it is an API route, and a prefetch would
   mint an OAuth state per hover and overwrite the one a half-finished flow
   depends on. */
export function ConnectDialog({
  label,
  startHref,
  accountName,
  onClose,
}: {
  label: string;
  startHref: string;
  /** what this workspace is connected to now, on a reconnect */
  accountName: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      heading={accountName ? `Reconnect ${label}` : `Connect ${label}`}
      onClose={onClose}
      width={560}
      foot={
        <>
          <Button kind="second" size={36} onClick={onClose} data-autofocus>
            Cancel
          </Button>
          <a className={buttonClass("main", 36)} href={startHref}>
            <span className="pt-btn__word">Continue to {label}</span>
          </a>
        </>
      }
    >
      <p>
        {`You'll be connected as whichever ${label} account this browser is already signed in to. ${label} won't ask you to choose. To use a different one, sign out of ${label} first or open HeyTiff in a private window.`}
      </p>
      {accountName && (
        <p>
          This workspace is currently connected to <b>{accountName}</b>.
        </p>
      )}
    </Dialog>
  );
}

/* DISCONNECT. Everything it takes, named, and keeping it is the easy
   choice: Keep it has the focus, the red block has to be reached for. Where
   the delete is bulk the account's name is typed, case- and
   space-insensitively: a "did you read which account this is" check, not a
   typing test. */
export function DisconnectDialog({
  label,
  accountName,
  consequences,
  note,
  requirePhrase = false,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  label: string;
  accountName: string | null;
  consequences: readonly string[];
  /** one more sentence under the list, e.g. ServiceM8's no-revoke step */
  note?: string;
  requirePhrase?: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
  const asks = requirePhrase && !!accountName;
  const phraseOk = !asks || norm(typed) === norm(accountName ?? "");
  return (
    <Dialog
      heading={`Disconnect ${accountName ?? label}?`}
      onClose={onClose}
      width={560}
      foot={
        <>
          <Button kind="second" size={36} onClick={onClose} data-autofocus>
            Keep it
          </Button>
          <Button kind="danger" size={36} onClick={onConfirm} disabled={busy || !phraseOk}>
            {busy ? `Disconnecting ${label}` : `Disconnect ${label}`}
          </Button>
        </>
      }
    >
      <ul className="st2-int-dlist">
        {consequences.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      {note && <p>{note}</p>}
      {asks && (
        <Field label={`Type ${accountName} to confirm`}>
          <TextInput value={typed} placeholder={accountName ?? ""} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
        </Field>
      )}
      {error && <Wrong>{error}</Wrong>}
    </Dialog>
  );
}
