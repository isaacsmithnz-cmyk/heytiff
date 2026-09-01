/* The rules for moving a sign-in address, as plain functions.

   Pure, and separate from the action, for the usual reason: the action needs
   a session and a live Auth0 tenant to run at all, so rules living inside it
   could only be tested through two mocks — and the rules are the half that
   can be WRONG in a way nobody notices until someone is locked out of their
   own account. */

/** The address, as it will be stored and compared.

    LOWERCASED, AND THAT IS A REAL DECISION rather than tidying. The local
    part of an address is case-SENSITIVE by RFC, so `Isaac@` and `isaac@` are
    two mailboxes in theory; in practice no provider anyone here uses
    distinguishes them, and Auth0's database connections treat addresses
    case-insensitively. Comparing raw would let "changing" an address to its
    own value in different case sail past the unchanged check and spend a real
    write marking a verified address unverified. */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Are these the same mailbox, as far as anything here is concerned? */
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normaliseEmail(a) === normaliseEmail(b);
}

/* DELIBERATELY NOT AN RFC 5322 PARSER. The full grammar admits quoted local
   parts, comments and bracketed literals; a regex claiming to implement it is
   always wrong somewhere, and the ONLY authority on whether an address works
   is whether mail arrives at it — which is what the verification step is
   for. This rejects what is obviously not an address and lets Auth0 and the
   inbox settle the rest. */
const SHAPED = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** 320 is the RFC ceiling (64 local + @ + 255 domain). Past it the value is
    not a long address, it is a paste of something else. */
const MAX = 320;

export type EmailVerdict = { ok: true; email: string } | { ok: false; error: string };

/** Is this a usable NEW sign-in address for someone currently at `current`?

    Every rejection is a sentence the person can act on. None of them mention
    a field name or a regex: what a reader needs is which of their two typed
    values was wrong and why. */
export function validateNewEmail(raw: unknown, current: string | null | undefined): EmailVerdict {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: "Enter the new email address." };
  }

  const email = normaliseEmail(raw);

  if (email.length > MAX) return { ok: false, error: "That address is too long." };
  if (!SHAPED.test(email)) return { ok: false, error: "That doesn’t look like an email address." };

  /* Caught here rather than sent, because Auth0 would ACCEPT it: patching a
     user to the address it already has succeeds, and succeeds having set
     `email_verified: false`. The person would be told it worked and would
     then be asked to re-verify an address that never moved. */
  if (sameEmail(email, current)) {
    return { ok: false, error: "That’s already your sign-in address." };
  }

  return { ok: true, email };
}

/** Do the two boxes agree?

    TYPED TWICE ON PURPOSE, and this is the only guard standing between a
    typo and a lockout. There is no verify-then-switch dance available — this
    app cannot send its own email — so the address changes the moment it is
    submitted, and the sign-in address is what a database-connection login
    uses as its username. Confirming against a second typing is cheap and
    catches the one mistake that costs an account. */
export function confirmationMatches(email: string, confirm: string): boolean {
  return sameEmail(email, confirm);
}
