"use client";

import { useState } from "react";
import { Dialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Field, TextInput } from "@/components/parts/field";
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

   On the Dialog part (old-modals mock, 27 October 2026), which portals to
   <body> and darkens the page like every other.

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
  /* where it went wrong: the new address itself, the second box, or the server */
  const [error, setError] = useState<{ at: "next" | "confirm" | "server"; words: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const commit = async () => {
    setError(null);

    /* Checked here as well as on the server, and neither is redundant: this
       one answers without a round trip, the server's is the one that holds —
       a Server Function is reachable by direct POST. */
    const verdict = validateNewEmail(next, current);
    if (!verdict.ok) return setError({ at: "next", words: verdict.error });
    if (!confirmationMatches(verdict.email, confirm)) {
      return setError({ at: "confirm", words: "The two don’t match" });
    }

    setBusy(true);
    await withCleanup(
      async () => {
        const res = await onChange(next);
        if (!res.ok) {
          setError({ at: "server", words: res.error });
          return;
        }
        onChanged(res.email, res.verificationSent);
        onClose();
      },
      () => setBusy(false),
    );
  };

  return (
    <Dialog
      heading="Change your sign-in address"
      width={560}
      onClose={onClose}
      foot={
        <>
          <Button kind="quiet" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button kind="main" disabled={busy || !next.trim() || !confirm.trim()} onClick={() => void commit()}>
            {busy ? "Changing the address" : "Change address"}
          </Button>
        </>
      }
    >
      <form
        className="mk-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && next.trim() && confirm.trim()) void commit();
        }}
      >
        {/* THE CONSEQUENCE, BEFORE THE BOXES. Not a hint about how to fill
            the form in — a fact about what happens when you do, and the
            reason this is a dialog instead of a field. */}
        <p className="rcw-sentence">
          {current ? `You sign in as ${current}. ` : ""}
          The new address becomes the one you sign in with, so you’ll need to be able to open its inbox. Nothing here
          can undo it for you.
        </p>
        <div className="mk-pair">
          <Field label="New sign-in address" error={error?.at === "next" ? error.words : null}>
            <TextInput
              name="signin_email"
              type="email"
              autoComplete="off"
              data-autofocus
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="you@example.com"
            />
          </Field>
          <Field label="Type it again" error={error?.at === "confirm" ? error.words : null}>
            <TextInput
              name="signin_email_confirm"
              type="email"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="you@example.com"
            />
          </Field>
        </div>
        {error?.at === "server" && <p className="mk-error">{error.words}</p>}
      </form>
    </Dialog>
  );
}
