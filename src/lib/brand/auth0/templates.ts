/* The seven letters HeyTiff actually sends, and why the other five are not
   here.

   AUTH0 SEEDS ELEVEN TEMPLATES INTO EVERY TENANT. Styling all eleven would
   read as thorough and be the opposite: four of them belong to flows this
   app does not run, so they would be brand-checked, reviewed, and never
   posted — and the next person would reasonably assume the flow exists
   because the letter does.

   NOT WRITTEN, DELIBERATELY:

     user_invitation   Auth0 Organizations invites — a flow this tenant does
                       not run. HeyTiff issues its own (`invitations` table,
                       `app/actions/invite.ts`) and now POSTS them itself
                       through `lib/email`, which renders the letter with the
                       shell next door. Dressing Auth0's version would still
                       be dressing a flow that has never fired.
     enrollment_email  MFA enrolment. No MFA in the tenant.
     mfa_oob_code      MFA codes. Same — and its Liquid variable is not in
                       Auth0's published table, so writing one would be
                       guessing at a vendor string.
     passwordless      No passwordless connection.

   THE VARIABLE NAMES ARE PER-TEMPLATE AND NOT INTERCHANGEABLE. Auth0's
   table gives `url` to Verification-link, Change-Password-link and Blocked
   Account; `code` to the two by-code variants; and `link` — a different
   name for the same idea — to MFA enrolment. Welcome and Password Breach get
   NEITHER, which is why their buttons point at the app's own front door
   instead of at a variable that does not exist. Getting this wrong renders a
   button whose href is the literal text `{{ url }}`.

   COPY IS FACTS, NOT INSTRUCTIONS. Each letter says what happened, what the
   button does, and what follows from ignoring it. Nothing tells the reader
   to press a button that is sitting right there. */

import { renderLetter, type Letter } from "./email-shell.ts";
import type { BrandAssets } from "./assets.ts";

/** Auth0's `templateName` path segment. Exactly the tenant's own spelling —
    a typo here is a 404 the script reports as "template not found". */
export type TemplateName =
  | "verify_email"
  | "verify_email_by_code"
  | "reset_email"
  | "reset_email_by_code"
  | "welcome_email"
  | "blocked_account"
  | "stolen_credentials";

export type EmailTemplate = {
  template: TemplateName;
  subject: string;
  body: string;
};

/** `baseUrl` is the app's own origin — the destination for the two letters
    Auth0 gives no link variable. */
export function heytiffEmailTemplates(
  assets: BrandAssets,
  baseUrl: string,
): EmailTemplate[] {
  const home = baseUrl.replace(/\/+$/, "");
  const signIn = `${home}/auth/login`;

  const letters: Record<TemplateName, { subject: string } & Letter> = {
    /* Fires on first sign-up AND on every sign-in-address change
       (`sendVerificationEmail`, lib/integrations/auth0-management.ts), so the
       copy has to be true of both. "Setting" is; "welcome" would not be. */
    verify_email: {
      subject: "Confirm your HeyTiff sign-in address",
      preheader: "One press and {{ user.email }} is confirmed.",
      heading: "Confirm this address",
      body: [
        "<strong>{{ user.email }}</strong> is being set as the address you sign in to HeyTiff with.",
      ],
      action: { label: "Confirm this address", href: "{{ url }}" },
      footnotes: [
        "Until it is confirmed, this address can't be used to sign in.",
        "If you didn't ask for this, ignore it — nothing changes.",
      ],
    },

    verify_email_by_code: {
      subject: "Your HeyTiff confirmation code",
      preheader: "Your code is inside.",
      heading: "Confirm this address",
      body: [
        "Enter this code to confirm <strong>{{ user.email }}</strong> as the address you sign in to HeyTiff with.",
      ],
      code: "{{ code }}",
      footnotes: [
        "Until it is confirmed, this address can't be used to sign in.",
        "If you didn't ask for this, ignore it — nothing changes.",
      ],
    },

    reset_email: {
      subject: "Reset your HeyTiff password",
      preheader: "Set a new password for {{ user.email }}.",
      heading: "Set a new password",
      body: [
        "Someone asked to reset the password on <strong>{{ user.email }}</strong>.",
      ],
      action: { label: "Set a new password", href: "{{ url }}" },
      footnotes: [
        "The current password keeps working until a new one is set.",
        "If it wasn't you, ignore this. Nobody can reset it without this link.",
      ],
    },

    reset_email_by_code: {
      subject: "Your HeyTiff password reset code",
      preheader: "Your code is inside.",
      heading: "Set a new password",
      body: [
        "Enter this code to set a new password on <strong>{{ user.email }}</strong>.",
      ],
      code: "{{ code }}",
      footnotes: [
        "The current password keeps working until a new one is set.",
        "If it wasn't you, ignore this. Nobody can reset it without this code.",
      ],
    },

    /* No `url` variable exists here — the destination is the app's own door. */
    welcome_email: {
      subject: "Your HeyTiff account is ready",
      preheader: "{{ user.email }} is confirmed.",
      heading: "You're in",
      body: [
        "<strong>{{ user.email }}</strong> is confirmed, and signs you in from here on.",
      ],
      action: { label: "Open HeyTiff", href: signIn },
    },

    /* A security notice, and the only letter carrying facts about WHERE the
       attempt came from. Auth0 supplies source_ip / city / country on this
       template alone. Written as one sentence rather than a table: a person
       reading this on a phone needs to recognise the place, not audit it. */
    blocked_account: {
      subject: "A HeyTiff sign-in was blocked",
      preheader: "Someone tried to sign in from an unrecognised place.",
      heading: "A sign-in was blocked",
      body: [
        "Someone tried to sign in to <strong>{{ user.email }}</strong> from {{ user.city }}, {{ user.country }} ({{ user.source_ip }}), and HeyTiff stopped it.",
      ],
      action: { label: "That was me — unblock", href: "{{ url }}" },
      footnotes: [
        "If it wasn't you, don't press anything. The block holds, and changing the password ends any access.",
      ],
    },

    /* Also no `url` variable. Auth0 sends this when the password matches a
       known public breach list; the only useful move is a new password, and
       that starts at the sign-in screen. */
    stolen_credentials: {
      subject: "Change your HeyTiff password",
      preheader: "This password has appeared in a public breach.",
      heading: "This password has been leaked",
      body: [
        "The password on <strong>{{ user.email }}</strong> appears in a public list of credentials taken from another site's breach.",
        "It is not safe on HeyTiff, or on anywhere else it was used.",
      ],
      action: { label: "Change your password", href: signIn },
      footnotes: [
        "HeyTiff was not breached. The password was, somewhere else.",
      ],
    },
  };

  return (Object.keys(letters) as TemplateName[]).map((template) => {
    const { subject, ...letter } = letters[template];
    return { template, subject, body: renderLetter(letter, assets) };
  });
}
