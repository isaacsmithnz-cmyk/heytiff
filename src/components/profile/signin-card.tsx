"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/shell/icon";
import { confirmationMatches, validateNewEmail } from "@/lib/account/email-change";
import type { EmailChangeOutcome } from "@/app/actions/account";
import { Detail, DetailPanel, DetailPanels } from "./detail";
import { TextInput } from "./fields";

/* SIGN-IN — your account, not your staff card.

   IT IS ITS OWN SECTION RATHER THAN A FIELD ON PERSONAL. Personal DOES show
   this same address — `header.email` is the account address, falling back to
   the card's `contact_email` only for a card nobody has claimed — but it
   shows it read-only, and `Detail` names the sign-in email as its example of
   a row that stays read-only in both modes. That was right: a row you can
   tab into and overwrite as part of a nine-field save is the wrong shape for
   the one value that can lock you out of the account.

   So the value is READ in two places and WRITTEN in one. Personal lists it
   among your details; this section is the only thing that can move it, and it
   is a tab rather than a row because it needs a warning and a confirmation
   field that a row has nowhere to put.

   IT DOES NOT USE SectionCard. Every other section on this screen is a slice
   of one staff-profile save: same action, same draft shape, same allowlist.
   This writes to the identity provider, cannot be batched with those, and
   needs a confirmation field none of them have. Borrowing the wrapper would
   have meant pretending it was a profile section, and the first person to
   add it to the save allowlist would find out it wasn't.

   THE SECOND BOX IS THE ONLY THING BETWEEN A TYPO AND A LOCKOUT. There is no
   verify-then-switch: this app cannot send email (see the Resend TODO in
   app/actions/invite.ts), so the address moves on submit, and for a database
   connection the sign-in address IS the username. Confirming against a second
   typing is the cheap guard, and it is checked before the network. */

export function SignInCard({
  email,
  onChange,
}: {
  email: string | null;
  /* HANDED IN, NOT IMPORTED, and it is the whole screen's convention rather
     than a preference: a client component that imports a `"use server"`
     module drags Next's server runtime into every jsdom suite that renders
     it, and five profile suites died proving it. `import type` above is
     erased at compile, so the shape can still be shared. */
  onChange: (next: string) => Promise<EmailChangeOutcome>;
}) {
  const [editing, setEditing] = useState(false);
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string; verificationSent: boolean } | null>(null);
  const [pending, start] = useTransition();

  /* WHAT THE CARD SHOWS AFTER A SUCCESSFUL CHANGE, and why it cannot be the
     prop. `email` comes from the Auth0 SESSION, and the session cookie is not
     reissued when the address moves — it still carries the old one until the
     next sign-in, and `revalidatePath` re-renders the server component with
     that same stale claim. Left alone the card printed the old address
     directly above its own message saying it was now the new one. Seen doing
     exactly that in the browser. */
  const shown = done?.email ?? email;

  const close = () => {
    setEditing(false);
    setNext("");
    setConfirm("");
    setError(null);
  };

  const submit = () => {
    setError(null);

    /* Checked here as well as on the server, and neither is redundant: this
       one gives the answer without a round trip, the server's is the one that
       actually holds — a Server Function is reachable by direct POST. */
    const verdict = validateNewEmail(next, shown);
    if (!verdict.ok) return setError(verdict.error);
    if (!confirmationMatches(verdict.email, confirm)) {
      return setError("The two addresses don’t match.");
    }

    start(async () => {
      const res = await onChange(next);
      if (!res.ok) return setError(res.error);
      setDone({ email: res.email, verificationSent: res.verificationSent });
      close();
    });
  };

  return (
    <div className="psec-body">
      <div className="psechd">
        <em>The address you sign in with — not where the business writes to you.</em>
        <span className="acts">
          {editing ? (
            <>
              <button className="pbtn ghost" type="button" onClick={close} disabled={pending}>
                Cancel
              </button>
              <button className="pbtn primary" type="button" onClick={submit} disabled={pending}>
                <Icon name="check" size={14} />
                {pending ? "Changing…" : "Change address"}
              </button>
            </>
          ) : (
            <button
              className="pbtn ghost"
              type="button"
              onClick={() => {
                setDone(null);
                setEditing(true);
              }}
            >
              <Icon name="edit" size={14} />
              Change
            </button>
          )}
        </span>
      </div>

      {!editing && (
        <DetailPanels>
          <DetailPanel title="Your account">
            <Detail label="Sign-in address" value={shown ?? "—"} small />
          </DetailPanel>
        </DetailPanels>
      )}

      {/* THE CONSEQUENCE, STATED BEFORE THE BOXES, because it is the whole
          reason this control is separate from every other field on the
          screen. Not a hint about how to use the form — a fact about what
          happens when you do. */}
      {editing && (
        <>
          <p className="pacct-warn">
            <Icon name="alert" size={14} />
            <span>
              This becomes the address you sign in with. You’ll need to be able to open
              its inbox — nothing here can undo it for you.
            </span>
          </p>
          <DetailPanels>
            <DetailPanel title="New address">
              {/* The ROW carries the label and ties it to the control by the
                  control's own `name` — see Detail. A bare TextInput here
                  would be an unlabelled box. */}
              <Detail
                label="New sign-in address"
                editing
                control={
                  <TextInput name="signin_email" value={next} onChange={setNext} type="email" />
                }
              />
              <Detail
                label="Type it again"
                editing
                control={
                  <TextInput
                    name="signin_email_confirm"
                    value={confirm}
                    onChange={setConfirm}
                    type="email"
                  />
                }
              />
            </DetailPanel>
          </DetailPanels>
        </>
      )}

      {error && <div className="carderr">{error}</div>}

      {done && (
        <p className="pacct-ok">
          <Icon name="check" size={14} />
          <span>
            Your sign-in address is now <b>{done.email}</b>.{" "}
            {done.verificationSent
              ? "Check that inbox for a message asking you to verify it."
              : "We couldn’t send the verification message, so verify it from Auth0 when you can."}{" "}
            You’ll use the new address next time you sign in.
          </span>
        </p>
      )}
    </div>
  );
}
