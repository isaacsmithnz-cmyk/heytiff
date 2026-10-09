import { longDay } from "@/lib/certs/mechanical";
import { EMPTY_BODY, normaliseBody, type LetterBody } from "./body";

/* ONE LETTER — what the person writes in Admin → Letters, as it is stored
   (public.letters) and as a save reads it back. Pure: the editor and the
   server agree on what a valid letter is. */

export type Letter = {
  id: string;
  /** What the list calls it; the "Re:" line when empty. */
  title: string;
  /** yyyy-mm-dd, or "" to leave the date off. */
  date: string;
  /** Who it is to, a line each. */
  recipient: string;
  subject: string;
  body: LetterBody;
  signerStaffId: string | null;
  /** The signer's drawn signature goes on. Only the signer can say so. */
  withSignature: boolean;
  createdById: string | null;
  updatedAt: string;
};

/** What the editor sends to be saved. */
export type LetterInput = Omit<Letter, "id" | "createdById" | "updatedAt"> & { id: string | null };

export const MAX_TITLE = 120;
export const MAX_RECIPIENT = 600;
export const MAX_SUBJECT = 200;

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function normaliseLetterInput(raw: unknown): LetterInput {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const recipient =
    typeof o.recipient === "string"
      ? o.recipient
          .replace(/\r\n?/g, "\n")
          .split("\n")
          .map((l) => l.replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .slice(0, 8)
          .join("\n")
          .slice(0, MAX_RECIPIENT)
      : "";
  return {
    id: typeof o.id === "string" && o.id.trim() ? o.id.trim().slice(0, 80) : null,
    title: text(o.title, MAX_TITLE),
    date: typeof o.date === "string" && ISO_DAY.test(o.date) ? o.date : "",
    recipient,
    subject: text(o.subject, MAX_SUBJECT),
    body: normaliseBody(o.body),
    signerStaffId: typeof o.signerStaffId === "string" && o.signerStaffId.trim() ? o.signerStaffId.trim().slice(0, 80) : null,
    withSignature: o.withSignature === true,
  };
}

/** What a letter is called in the list. */
export function titleOf(l: Pick<Letter, "title" | "subject">): string {
  return l.title.trim() || l.subject.trim() || "Untitled letter";
}

/** The recipient as the paper prints it, a line each. */
export const recipientLines = (recipient: string): string[] => recipient.split("\n").map((l) => l.trim()).filter(Boolean);

/** "9 October 2026"; "" for no date. */
export const letterDate = (iso: string): string => (iso ? longDay(iso) : "");

/** A new letter, dated today, signed by whoever is writing it. */
export function blankLetter(today: string, staffId: string | null): LetterInput {
  return { id: null, title: "", date: today, recipient: "", subject: "", body: EMPTY_BODY, signerStaffId: staffId, withSignature: !!staffId };
}

/** The PDF's file name: the letter's own name, safe for a file. */
export function letterFileName(l: Pick<Letter, "title" | "subject">, business: string): string {
  const name = `${titleOf(l)}${business ? ` – ${business}` : ""}`.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${name}.pdf`;
}
