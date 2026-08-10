/* The ServiceM8 people screen's pure half — shaping raw staff.json rows and
   arranging them against this workspace's cards. linking.ts's sibling, and
   the same posture: this module DESCRIBES (linked / looks-like / new), it
   never decides, and it never writes. Import and link are separate deliberate
   acts through the gated actions in app/actions/staff-import.ts.

   THE ACCEPT RULE, restated for import: a provider value never lands on a
   card except through an explicit human accept. This module's output is the
   review — every field a person WOULD receive, visible before anything is
   written. The action then writes exactly what the human left ticked, and
   nothing else.

   Email and mobile appear here transiently (the live read) and are persisted
   only onto cards a human chooses to create — the sm8_staff mirror stays
   names-and-titles, its PII posture untouched. */

import { suggestMatches, type StaffCandidate, type SuggestionReason } from "./match";
import type { IntegrationLink } from "./links";

export type Sm8Person = {
  /** ServiceM8's stable id — what a link's remote_id stores. */
  uuid: string;
  first: string | null;
  last: string | null;
  /** Display name, joined from the halves. Nameless rows are dropped in
      shaping — a person no picker can show is a person no one can link. */
  name: string;
  jobTitle: string | null;
  email: string | null;
  mobile: string | null;
  /** ServiceM8's active flag — 0 is a leaver or a disabled login. */
  active: boolean;
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const orNull = (v: unknown): string | null => str(v) || null;

/** One raw staff row → our shape, or null when it can't be shown or linked.
    Same two drops as Xero's shapeEmployee, for the same reasons: no uuid
    means nothing to store in remote_id, no name means an unusable row. */
export function shapeSm8Person(raw: unknown): Sm8Person | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const uuid = str(r.uuid);
  if (!uuid) return null;

  const first = orNull(r.first);
  const last = orNull(r.last);
  const name = [first, last].filter(Boolean).join(" ");
  if (!name) return null;

  return {
    uuid,
    first,
    last,
    name,
    jobTitle: orNull(r.job_title),
    email: orNull(r.email),
    mobile: orNull(r.mobile),
    // ServiceM8 sends active as 1/0; anything unreadable counts as inactive
    // rather than surfacing a ghost as an importable person.
    active: r.active === 1 || r.active === "1",
  };
}

/** The staff side of the arrangement — the matcher's candidate plus what the
    rows need to SAY who a card is. */
export type ImportStaffCandidate = StaffCandidate & {
  name: string;
  status: "Active" | "Inactive";
};

export type Sm8PersonRow =
  /** A saved decision — shown so re-entry reads as done, never re-offered. */
  | { kind: "linked"; person: Sm8Person; staffProfileId: string; staffName: string }
  /** One confident candidate here, with the reason. A human still presses it. */
  | { kind: "suggested"; person: Sm8Person; staffProfileId: string; staffName: string; reason: SuggestionReason }
  /** Nobody here corresponds — importable as a new (unclaimed) card. */
  | { kind: "new"; person: Sm8Person };

/** Arrange every ServiceM8 person against this workspace, in the input's
    order — grouping and sorting are the screen's decisions.

    The matcher runs STAFF-first (email across everyone before any name), the
    same direction as the Xero screen, so one shared discipline decides both.
    Cards already holding an sm8 link and people already claimed by one are
    excluded from suggestion on both sides — a saved decision is settled. */
export function buildSm8PeopleRows(
  people: Sm8Person[],
  staff: ImportStaffCandidate[],
  links: IntegrationLink[]
): Sm8PersonRow[] {
  const linkByRemote = new Map(links.map((l) => [l.remoteId, l]));
  const linkedStaffIds = new Set(links.map((l) => l.staffProfileId));
  const staffById = new Map(staff.map((s) => [s.staffProfileId, s]));

  const unlinkedPeople = people.filter((p) => !linkByRemote.has(p.uuid));
  const unlinkedStaff = staff.filter((s) => !linkedStaffIds.has(s.staffProfileId));

  const { suggestions } = suggestMatches(
    unlinkedStaff,
    unlinkedPeople.map((p) => ({ id: p.uuid, name: p.name, email: p.email }))
  );
  const suggestionByRemote = new Map(suggestions.map((s) => [s.remoteId, s]));

  return people.map((person) => {
    const link = linkByRemote.get(person.uuid);
    if (link) {
      return {
        kind: "linked" as const,
        person,
        staffProfileId: link.staffProfileId,
        // The card is the truth for who they are NOW; the label the link
        // captured is only the fallback for a card that has since gone.
        staffName: staffById.get(link.staffProfileId)?.name ?? link.remoteLabel ?? "a removed card",
      };
    }

    const suggestion = suggestionByRemote.get(person.uuid);
    if (suggestion) {
      const card = staffById.get(suggestion.staffProfileId);
      if (card) {
        return {
          kind: "suggested" as const,
          person,
          staffProfileId: suggestion.staffProfileId,
          staffName: card.name,
          reason: suggestion.reason,
        };
      }
    }

    return { kind: "new" as const, person };
  });
}
