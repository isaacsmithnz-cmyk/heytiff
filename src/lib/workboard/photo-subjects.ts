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

/* ── THE FAMILIES ──────────────────────────────────────────────────────────
   Ten subjects is the right vocabulary for a READER and the wrong one for a
   filter row. Drawn as one chip each they were eleven labels wrapping over
   three lines above the pictures — a wall of words you have to read in full
   before you can look at a single photograph, which is backwards for a
   gallery (Isaac: "it shows too many labels ... it should be broken down
   into broader tabs").

   So the row is now FIVE broad cuts, and the ten subjects moved into the
   filter behind them. Each family is a word somebody says out loud on a job:

     Equipment      the machines, and the plates that identify them
     Installation   the runs that connect them — duct, pipe, wiring
     Site           the building and the way in
     Faults         what was wrong
     Finished       what it looks like done

   FAULTS AND FINISHED STAYED APART, though a tidier grouping would have
   folded both into one "condition" family and given a round four. They are
   the two ends of a job and the two things people go looking for by name —
   the fault to explain a bill, the finished head to show a client — and a
   bucket that answers both questions answers neither. A family invented to
   make the row shorter is a label about this list, not about the work.

   THE FAMILY IS DERIVED, NEVER STORED. Nothing writes a family to a row: it
   is a view of the subject the reader already chose, so re-cutting the
   gallery tomorrow costs an edit here and no migration. */

export const PHOTO_FAMILIES = [
  "equipment",
  "installation",
  "site",
  "faults",
  "finished",
] as const;

export type PhotoFamily = (typeof PHOTO_FAMILIES)[number];

export const FAMILY_LABEL = {
  equipment: "Equipment",
  installation: "Installation",
  site: "Site",
  faults: "Faults",
  finished: "Finished",
} satisfies Record<PhotoFamily, string>;

/* `satisfies` again, for the reason above the labels: this map must fail to
   compile the day a subject is added and left unfiled, because the failure
   it prevents is a photograph reachable from no tab at all. */
export const SUBJECT_FAMILY = {
  "outdoor-unit": "equipment",
  "indoor-unit": "equipment",
  controller: "equipment",
  dataplate: "equipment",
  ductwork: "installation",
  pipework: "installation",
  electrical: "installation",
  site: "site",
  fault: "faults",
  finished: "finished",
} satisfies Record<PhotoSubject, PhotoFamily>;

/** The family's colour, taken from a member rather than invented, so a tab
    and the badges under it are visibly the same thing. */
export const FAMILY_COLOUR = {
  equipment: SUBJECT_COLOUR["outdoor-unit"],
  installation: SUBJECT_COLOUR.ductwork,
  site: SUBJECT_COLOUR.site,
  faults: SUBJECT_COLOUR.fault,
  finished: SUBJECT_COLOUR.finished,
} satisfies Record<PhotoFamily, string>;

export function isPhotoSubject(v: unknown): v is PhotoSubject {
  return typeof v === "string" && (PHOTO_SUBJECTS as readonly string[]).includes(v);
}

/** Which family a subject belongs to — null for an unread photo, and for a
    subject this build no longer knows. Both are "not filed", which is the
    honest answer and keeps such a photo out of a family it never chose. */
export function familyOf(subject: string | null): PhotoFamily | null {
  return subject && isPhotoSubject(subject) ? SUBJECT_FAMILY[subject] : null;
}

/** The subjects inside one family, in the vocabulary's own order. */
export function subjectsInFamily(family: PhotoFamily): PhotoSubject[] {
  return PHOTO_SUBJECTS.filter((s) => SUBJECT_FAMILY[s] === family);
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

/** How many starred photos sit under each family, in the family list's own
    order and skipping the empty ones — an empty tab is furniture, and a row
    that reshuffles as photos are read is a row you cannot aim at.

    Unread photos are NOT counted here, for the same reason they were never
    counted under a subject: a photo nobody has looked at has no family, and
    filing it under one would be inventing the answer. The gallery gives them
    their own way in. */
export function countByFamily(
  photos: readonly { subject: string | null }[]
): { family: PhotoFamily; count: number }[] {
  const counts = new Map<PhotoFamily, number>();
  for (const p of photos) {
    const f = familyOf(p.subject);
    if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return PHOTO_FAMILIES.filter((f) => counts.has(f)).map((f) => ({
    family: f,
    count: counts.get(f) as number,
  }));
}
