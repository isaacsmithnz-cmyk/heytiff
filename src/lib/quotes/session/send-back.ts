/* SENT BACK BEFORE SHE ANSWERS. A rule in her prompt is weighed against
   everything else she's working through; a few she's skipped even when
   told, so the turn checks them in code as she goes to answer, and sends
   her back once with what she missed. What a person reads never shows it.

   Asked about the heat load, she runs room_load. On 3465 (re-run 10
   November 2026) Isaac said "have a look at the heat load"; twice she
   looked at the plan close, called it "a sketch with no scale" though it
   prints a 7440 along the bottom, and answered without a load. Told to
   measure off the 7440, she sized six rooms and ran it: 19.2 kW, 13.5 kW
   zoned, under the 14 kW (Isaac, 10 November 2026: "Yes", to sending her
   back when asked about the heat load and she hasn't run it). Pure. */

/** The person asked about the load, or whether a size covers it. */
const ASKED_LOAD =
  /\b(heat|cooling|room)[ -]?loads?\b|\bload calc|\b(big|large) enough\b|\benough (kw|kilowatts?|capacity)\b|\b(check|confirm|work out)\b[^.?!\n]{0,40}\b(sizing|capacity)\b|\bwill (it|that|the [\w.]+ ?(kw|kilowatt)s?) (cover|handle)\b/i;

export const LOAD_SEND_BACK =
  "Before you answer: you were asked about the heat load and haven't run room_load. Run it on the rooms now: with their sizes off the plan where it prints them, or measured with measure_plan against a printed dimension or the scale bar. A hand sketch with a dimension printed on it is measured too. Only where there's no plan, or none with a printed figure or a scale bar, say which room sizes you need instead. Then answer as you would have, with what the load says. Don't mention this note.";

/** What sends her back as she goes to answer `message`, having run `ran` this turn; none, she answers. */
export function sendBack(message: string, ran: readonly string[]): string | null {
  /* only what the person said: the job's brief rides with the first message */
  const said = message.includes("says:\n") ? message.slice(message.lastIndexOf("says:\n")) : message;
  if (ASKED_LOAD.test(said) && !ran.includes("room_load")) return LOAD_SEND_BACK;
  return null;
}
