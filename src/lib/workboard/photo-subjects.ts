/* What a starred photo can be OF — the closed set the showcase filters by.
   Pure and client-safe: the gallery draws these and the reader validates
   against them, so both ends agree on the vocabulary.

   WHY A CLOSED SET AND NOT FREE TEXT. A free-text category fragments the
   moment it meets real photographs: "outdoor unit", "condenser", "outdoor
   unit on brackets" and "ODU" are four spellings of one filter, and a filter
   that misses a third of its own members is worse than no filter — it tells
   you the set is empty when it isn't. So the model CHOOSES from this list,
   and anything it wants to say beyond the choice goes in `tags`, which is
   searched rather than filtered.

   WHY THESE TEN. They are the frames a tradesperson actually photographs on
   an HVAC job, and — more to the point — the ones somebody later goes looking
   for: the dataplate when they need a model number, the ductwork when they
   are briefing a second crew, the finished head when they are showing a
   client what the work looks like. The list is deliberately about the SUBJECT
   of the frame, never a judgement of it: "Damage or fault" is what is in the
   picture, not a claim that somebody did something wrong.

   ADDING ONE IS CHEAP AND REMOVING ONE IS NOT. A subject already written to a
   row survives this list — `subjectLabel` falls back to the stored string
   rather than dropping the photo out of the gallery, because a photo that
   vanishes when a constant changes is the worst version of this. */

export const PHOTO_SUBJECTS = [
  "outdoor-unit",
  "indoor-unit",
  "ductwork",
  "pipework",
  "electrical",
  "controller",
  "dataplate",
  "site",
  "fault",
  "finished",
] as const;

export type PhotoSubject = (typeof PHOTO_SUBJECTS)[number];

/* `satisfies`, not a `Record<string, …>` annotation — the annotation would
   widen the key type back to `string` and take `keyof` with it, which is the
   trap that costs a real exhaustiveness check every time it is written. */
export const SUBJECT_LABEL = {
  "outdoor-unit": "Outdoor unit",
  "indoor-unit": "Indoor unit",
  ductwork: "Ductwork",
  pipework: "Pipework & drainage",
  electrical: "Electrical",
  controller: "Controller",
  dataplate: "Dataplate",
  site: "Site & access",
  fault: "Damage or fault",
  finished: "Finished work",
} satisfies Record<PhotoSubject, string>;

/** What each subject means, in the words the reader is given. One source for
    the prompt and for anything that ever explains the filter to a person. */
export const SUBJECT_MEANING = {
  "outdoor-unit": "a condenser or outdoor unit, on the ground, a roof or brackets",
  "indoor-unit": "an indoor head, cassette, bulkhead or ducted fan coil",
  ductwork: "flexible or rigid duct, plenums, grilles, diffusers or boots",
  pipework: "refrigerant pipe, insulation, condensate or drainage",
  electrical: "switchboard, isolator, cabling, conduit or wiring terminations",
  controller: "a wall controller, thermostat, zone panel or its screen",
  dataplate: "a rating plate, serial label, barcode or model sticker",
  site: "the building, room, roof or access route, with no equipment as the subject",
  fault: "damage, a leak, corrosion, a blockage or something visibly wrong",
  finished: "completed work presented tidily — the frame you would show a client",
} satisfies Record<PhotoSubject, string>;

/** The gallery's colour per subject. Deliberately NOT the page accent and
    NOT a semantic state colour: a subject is a kind of thing, not a warning
    and not a success. Distinct hues so a wall of chips reads at a glance. */
export const SUBJECT_COLOUR = {
  "outdoor-unit": "#2E68FF",
  "indoor-unit": "#00A8E0",
  ductwork: "#7A5AF8",
  pipework: "#0E9F9F",
  electrical: "#F5B400",
  controller: "#B14AED",
  dataplate: "#5B6B7F",
  site: "#8A8F98",
  fault: "#E0264F",
  finished: "#00A389",
} satisfies Record<PhotoSubject, string>;

export function isPhotoSubject(v: unknown): v is PhotoSubject {
  return typeof v === "string" && (PHOTO_SUBJECTS as readonly string[]).includes(v);
}

/** A subject's label — falling back to the stored string for anything this
    build no longer knows, so retiring a subject never hides a photograph. */
export function subjectLabel(subject: string | null): string {
  if (!subject) return "Not read yet";
  return isPhotoSubject(subject) ? SUBJECT_LABEL[subject] : subject;
}

export function subjectColour(subject: string | null): string {
  return subject && isPhotoSubject(subject) ? SUBJECT_COLOUR[subject] : "#8A8F98";
}

/** How many starred photos sit under each subject, in the list's own order so
    the filter row never reshuffles under the reader's cursor. Photos not read
    yet are counted separately by the caller — an unread photo has no subject
    and must not be quietly filed under one. */
export function countBySubject(
  photos: readonly { subject: string | null }[]
): { subject: PhotoSubject; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of photos) {
    if (p.subject) counts.set(p.subject, (counts.get(p.subject) ?? 0) + 1);
  }
  return PHOTO_SUBJECTS.filter((s) => counts.has(s)).map((s) => ({
    subject: s,
    count: counts.get(s) as number,
  }));
}
