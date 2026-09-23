import { renderLetter, escapeHtml, type Letter } from "@/lib/brand/auth0/email-shell";
import { brandAssets } from "@/lib/brand/auth0/assets";

/* The letter documents leave a job in — a customer asked for our insurance,
   the builder wants the certificate of compliance, and the office ticks them
   on the job card and sends.

   THE SAME ENVELOPE AS THE INVITATION (invite-letter.ts has the argument), and
   the same rule at its edge: everything variable here was typed by somebody —
   the message, the business's name, the file names — so it is escaped here,
   because the shell interpolates body copy raw.

   THE MESSAGE IS THE PERSON'S, the list is ours. What they typed goes first,
   paragraph for paragraph and line for line; the files follow under their own
   heading so a reader can check nothing is missing without opening the
   attachments; and the footnote says who a reply reaches, because the letter
   comes from an address nobody reads. */

export type DocumentsLetterInput = {
  /** Where the app is served — the brand assets are absolute URLs. */
  baseUrl: string;
  /** Trading name, or null for an org that has not set one. */
  business: string | null;
  /** The person sending, as a name — who a reply reaches. */
  sender: string | null;
  /** As typed. Plain text; blank lines are paragraphs. */
  message: string;
  /** The names the files arrive under, in order. */
  files: readonly string[];
};

export function documentsLetter(input: DocumentsLetterInput): string {
  const business = input.business?.trim() || null;
  const sender = input.sender?.trim() || null;
  const paragraphs = input.message
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => escapeHtml(p).replace(/\n/g, "<br />"));
  const count = input.files.length === 1 ? "1 document" : `${input.files.length} documents`;

  const letter: Letter = {
    preheader: business ? `${count} from ${escapeHtml(business)}, attached.` : `${count}, attached.`,
    heading: business ? `Documents from ${escapeHtml(business)}` : "Your documents",
    body: [...paragraphs, `<b>Attached</b><br />${input.files.map(escapeHtml).join("<br />")}`],
    footnotes: [
      sender
        ? `Reply to this email to reach ${escapeHtml(sender)}.`
        : "Reply to this email to reach the person who sent it.",
    ],
  };
  return renderLetter(letter, brandAssets(input.baseUrl));
}
