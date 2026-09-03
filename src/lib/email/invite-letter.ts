import { renderLetter, escapeHtml, type Letter } from "@/lib/brand/auth0/email-shell";
import { brandAssets } from "@/lib/brand/auth0/assets";
import { auDayOf, fmtAuWeekdayDateLong } from "@/lib/au-dates";

/* The invitation letter — the app's first email of its own.

   IT BORROWS THE ENVELOPE, NOT THE FOLDER. `brand/auth0/email-shell` is
   provider-neutral despite where it sits ("one envelope, seven letters"): the
   nested tables, the mobile override, the light-scheme lock and the PNG
   lockup are the brand's answer to mail clients, and rebuilding any of that
   here would be a second copy to drift. Only the seven Auth0 templates live
   in that folder; this letter is the app's, and lives with the mailer.

   EVERYTHING VARIABLE HERE WAS TYPED BY SOMEBODY. The company name comes off
   the Organisation screen and the inviter's name off their identity provider,
   and the shell interpolates body copy raw so Auth0's Liquid survives. So
   this module escapes at its own edge — see escapeHtml's note. The URL is
   ours and carries no user input, so it goes in whole.

   A COLD INVITATION HAS TO SURVIVE BEING READ BY A SCEPTIC. Somebody who was
   not told this was coming is looking at mail from a no-reply address asking
   them to click a link and sign in. So the letter names the person who sent
   it, names the company, says what the app is for in one line, and sets a
   real reply-to. The footnotes carry the three rules that are invisible from
   the recipient's side: when it dies, which address it is bound to, and what
   ignoring it costs. */

export type InviteLetterInput = {
  /** Where the app is served — the accept link and the brand assets are both
      absolute, because a mail client fetches them from its own machine. */
  baseUrl: string;
  token: string;
  /** Trading name, or null for an org that has not set one yet. */
  company: string | null;
  /** The inviter, as a person — or NULL when nobody could give us a name that
      is a name. Never their address standing in for one: the first invitation
      ever sent read "isaacsmithnz1@gmail.com has invited you", auto-linked,
      beside a reply-to holding a different address. Never "your administrator"
      either — that is the wording that makes a real letter read as a phish. */
  inviterName: string | null;
  inviterEmail: string | null;
  /** "Admin" or "Staff", already in the spelling the screens use. */
  role: string;
  /** The address the invite is bound to. Must be signed in with. */
  email: string;
  /** The invitee, as a person — typed by whoever invited them, or NULL for
      every invitation written before a name could ride along. Same rule as
      `inviterName` and for a sharper reason: this letter goes to someone who
      may never have heard of HeyTiff, and a stranger who knows your name is
      the one signal a bulk phish cannot cheaply fake. Never their address —
      it is already on the line that says which address to sign in with, and
      putting it where a name goes is the defect this field exists to end. */
  inviteeName: string | null;
  /** ISO timestamp from invitations.expires_at. */
  expiresAt: string;
};

/** Subject and HTML, ready for the transport. */
export function inviteLetter(input: InviteLetterInput): { subject: string; html: string } {
  const home = input.baseUrl.replace(/\/+$/, "");
  const company = input.company?.trim() || null;
  /* The fallback names HeyTiff rather than inventing a company: an org with no
     trading name is a real state (the owner skipped setup), and "join null" or
     an empty gap is worse than naming the product they are joining on. */
  const companyText = company ?? "a team on HeyTiff";
  /* Blank AND an address both mean "no name" by the time it gets here — the
     action drops anything with an @ in it — but this restates the emptiness
     check because a letter is the last place to discover a null. */
  const inviterText = input.inviterName?.trim() || null;
  const inviteeText = input.inviteeName?.trim() || null;

  /* TWO SPELLINGS OF EVERY NAME, and they are not interchangeable. The body
     is HTML and must be escaped; the SUBJECT is not, and an escaped one puts
     a literal "Smith &amp; Sons" in the inbox. Real trade names contain
     ampersands often enough that this is the common case, not the edge. */
  const named = escapeHtml(companyText);
  const inviter = inviterText ? escapeHtml(inviterText) : null;
  const invitee = inviteeText ? escapeHtml(inviteeText) : null;
  const role = escapeHtml(input.role);

  const expiryDay = fmtAuWeekdayDateLong(auDayOf(input.expiresAt));

  const letter: Letter = {
    /* The inbox preview line. It must not repeat the heading — two identical
       lines stacked in a list is the design failing to use the space. */
    preheader: `Accept and you're in — the link is good until ${expiryDay || "it expires"}.`,
    heading: company ? `Join ${named} on HeyTiff` : "You've been invited to HeyTiff",
    body: [
      /* WITH NO NAME, THE COMPANY IS THE ACTOR — not an address wearing one.
         "You've been invited to join Diamond Air Solutions" is true, complete
         and says nothing it cannot stand behind; the human is still reachable,
         because reply-to carries their real address either way. */
      /* THE GREETING IS FOLDED IN, not stacked above. "Hi Dan," on its own
         line is a paragraph carrying one word, and this letter's rule is that
         every line earns its place. Read aloud, the joined version is also
         the sentence a person would actually say. */
      invitee
        ? inviter
          ? `Hi ${invitee} — ${inviter} has invited you to join ${named} as <b>${role}</b>.`
          : `Hi ${invitee} — you've been invited to join ${named} as <b>${role}</b>.`
        : inviter
          ? `${inviter} has invited you to join ${named} as <b>${role}</b>.`
          : `You've been invited to join ${named} as <b>${role}</b>.`,
      /* One line of what the thing IS. A recipient who has never heard of
         HeyTiff cannot tell an invitation from a phish without it. */
      `HeyTiff is where the team's jobs, timesheets, photos and documents live.`,
    ],
    action: { label: "Accept invitation", href: `${home}/invite/accept?token=${input.token}` },
    footnotes: [
      // "them" needs an antecedent the reader can see; without a name, the
      // person who sent it is the only honest way to refer to them
      expiryDay
        ? `This invitation expires on ${expiryDay}. After that, ask ${inviter ?? "the person who invited you"} to renew it.`
        : `Ask ${inviter ?? "the person who invited you"} to renew this invitation if it stops working.`,
      /* THE RULE THAT COSTS THE MOST WHEN IT IS UNSAID. The accept route
         refuses a signed-in identity whose address is not this one, and the
         person hitting that refusal has no way to know it was a rule rather
         than a broken link. */
      `It only works for <b>${escapeHtml(input.email)}</b> — sign in with that address.`,
      `If you weren't expecting this, ignore it. Nothing happens until you accept.`,
    ],
  };

  return {
    subject:
      company && inviterText
        ? `${inviterText} invited you to ${companyText} on HeyTiff`
        : company
          ? `You've been invited to ${companyText} on HeyTiff`
          : "You've been invited to HeyTiff",
    html: renderLetter(letter, brandAssets(home)),
  };
}
