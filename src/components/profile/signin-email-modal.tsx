"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { confirmationMatches, validateNewEmail } from "@/lib/account/email-change";
import { withCleanup } from "@/lib/ui/with-cleanup";
import type { EmailChangeOutcome } from "@/app/actions/account";

/* Changing the address you sign in with.

   IT WAS A WHOLE TAB, AND THAT WAS WRONG (Isaac, 2026-09-01). A section
   called "Sign-in" sat beside Personal, holding one read-only row and a
   button — while Personal ALREADY showed the same address, because
   `header.email` is the account address. One fact with two homes, one of
   which existed only to hold a form. Nobody builds it that way: an email
   lives with your details, and changing it opens something focused.

   So the row stays where it always was and this is what the row opens.

   PORTALLED TO <body>, like every dashboard modal — `.page.in` keeps
   `will-change`, which makes it a containing block for position:fixed, so a
   modal rendered inside the page anchors to the page and lands halfway down
   the scroll. The `.fg` wrapper is display:contents: no box, but the tokens
   and field styles still reach inside.

   THE SECOND BOX IS THE ONLY THING BETWEEN A TYPO AND A LOCKOUT, and it is
   why this is a modal rather than an inline field. There is no
   verify-then-switch: the app cannot send email (see the Resend TODO in
   app/actions/invite.ts), so the address moves on submit, and for a database
   connection it IS the login username. A row you can tab through is the wrong
   shape for that; a panel that says what happens and asks twice is the right
   one. Same argument as the owner-transfer modal next door, at the size this
   one deserves. */

export function SignInEmailModal({
  current,
  onChange,
  onClose,
  onChanged,
}: {
  current: string | null;
  onChange: (next: string) => Promise<EmailChangeOutcome>;
  onClose: () => void;
  /** Handed the new address so the card behind can stop showing the old one
      before the session catches up. */
  onChanged: (email: string, verificationSent: boolean) => void;
}) {
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const commit = async () => {
    setError(null);

    /* Checked here as well as on the server, and neither is redundant: this
       one answers without a round trip, the server's is the one that holds —
       a Server Function is reachable by direct POST. */
    const verdict = validateNewEmail(next, current);
    if (!verdict.ok) return setError(verdict.error);
    if (!confirmationMatches(verdict.email, confirm)) {
      return setError("The two addresses don’t match.");
    }

    setBusy(true);
    await withCleanup(
      async () => {
        const res = await onChange(next);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        onChanged(res.email, res.verificationSent);
        onClose();
      },
      () => setBusy(false),
    );
  };

  return createPortal(
    <div className="fg" style={{ display: "contents" }}>
      <div className="fl-ov" onClick={onClose}>
        <div
          className="fl-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Change your sign-in address"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="fl-mh">
            <div>
              <b>Change your sign-in address</b>
              <em>{current ? `You sign in as ${current}` : "The address you sign in with"}</em>
            </div>
            <button className="fl-x" type="button" aria-label="Close" onClick={onClose}>
              <Icon name="x" size={18} />
            </button>
          </div>

          <div className="fl-mb">
            {/* THE CONSEQUENCE, BEFORE THE BOXES. Not a hint about how to fill
                the form in — a fact about what happens when you do, and the
                reason this is a dialog instead of a field. */}
            <p className="pacct-warn">
              <Icon name="alert" size={14} />
              <span>
                This becomes the address you sign in with. You’ll need to be able to open
                its inbox — nothing here can undo it for you.
              </span>
            </p>

            <div className="lv-form">
              <div className="lv-frow">
                <label className="mts-f" style={{ flex: 1 }}>
                  <span>New sign-in address</span>
                  <input
                    name="signin_email"
                    type="email"
                    autoComplete="off"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    placeholder="you@example.com"
                  />
                </label>
                <label className="mts-f" style={{ flex: 1 }}>
                  <span>Type it again</span>
                  <input
                    name="signin_email_confirm"
                    type="email"
                    autoComplete="off"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="you@example.com"
                  />
                </label>
              </div>
            </div>

            {error && <div className="carderr">{error}</div>}

            <div className="fl-foot">
              <button className="fl-btn ghost" type="button" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                className="fl-btn primary"
                type="button"
                disabled={busy || !next.trim() || !confirm.trim()}
                onClick={commit}
              >
                <Icon name="check" size={15} />
                {busy ? "Changing…" : "Change address"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
