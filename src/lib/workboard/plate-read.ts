/* A UNIT'S RATING PLATE, READ FROM ITS PHOTO (Isaac, 2026-10-06: "serial
   numbers etc. can be read from there using photos").

   What Claude is asked, and what we'll believe back: the model and the
   serial, copied as printed, or left empty. The serial goes on the
   compliance certificate, so a guessed character is worse than none. Pure:
   the server sends the photo. */

export const PLATE_SCHEMA = {
  type: "object",
  properties: {
    model: { type: "string" },
    serial: { type: "string" },
  },
  required: ["model", "serial"],
  additionalProperties: false,
} as const;

export const PLATE_PROMPT =
  "This is a photo taken on an Australian air-conditioning job, meant to be a unit's rating plate (its data plate).\n\n" +
  "Copy two things exactly as they are printed:\n" +
  '- model: the model number, for example "PEFY-P25VMX-A" or "MSZ-AP35VGKD", without markings in angle brackets such as <H> or <BS>.\n' +
  '- serial: the serial number, often labelled "SERIAL No.", "S/N" or "MFG No.".\n\n' +
  "Copy every character as printed; never correct, complete or guess one. Leave a field empty when it isn't on the plate or can't be read clearly. If the photo isn't a rating plate, leave both empty.";

const MAX = 60;
/** A plate's code as printed — what was read, or a person's own correction:
    one line, its own case, nothing that isn't a code's character. */
export const plateCode = (v: unknown): string =>
  typeof v === "string"
    ? v
        /* a marking in angle brackets (<H>, <BS>) is no part of the code */
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9\-/. ]/g, "")
        .trim()
        .slice(0, MAX)
    : "";

/** What was read, or null when nothing was. */
export function parsePlate(raw: unknown): { model: string; serial: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const model = plateCode(o.model);
  const serial = plateCode(o.serial);
  return model || serial ? { model, serial } : null;
}

/** Whether the plate's model is the quote's: the same code, spaces and case
    aside. */
export function sameModel(read: string | null | undefined, quoted: string | null | undefined): boolean {
  const k = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[\s]/g, "");
  return !!k(read) && k(read) === k(quoted);
}
