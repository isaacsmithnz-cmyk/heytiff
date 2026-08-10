/* Arranging a connected system's PEOPLE against this workspace's cards —
   provider-neutral, pure, and the only place that arrangement is decided.

   linking.ts describes the same correspondence from the STAFF side (every
   card, with its link state and drift). This describes it from the REMOTE
   side: every person over there, and whether they're already someone here.
   Both directions exist because they answer different questions — "is this
   card matched?" versus "does this person need importing?" — and both run on
   the one matcher, so they can never disagree about who somebody is.

   THE ACCEPT RULE: this module's output is the review. Every field a card
   WOULD receive is in the candidate, visible before anything is written; the
   action then writes exactly what the human left ticked. Nothing here writes,
   and nothing here decides.

   A provider joins by mapping its own shape to ImportCandidate (see
   sm8-people.ts, xero-people.ts) — no provider field reaches this file, or
   provider-specific cleverness creeps in and the rules stop being identical. */

import { suggestMatches, type StaffCandidate, type SuggestionReason } from "./match";
import type { IntegrationLink } from "./links";

/** One person in a connected system, reduced to what import may see. Money
    is deliberately absent everywhere: wages and pay basis are HeyTiff's own,
    settled in the drift lane, never copied in by an import. */
export type ImportCandidate = {
  /** The provider's stable id — what a link's remote_id stores. */
  id: string;
  first: string | null;
  last: string | null;
  /** Display name, joined by the provider's own mapper. */
  name: string;
  jobTitle: string | null;
  email: string | null;
  /** Null for providers whose people list carries no number. */
  phone: string | null;
  /** False for a leaver or a disabled login — imported as an Inactive card. */
  active: boolean;
};

/** The staff side: the matcher's candidate, plus what a row needs to SAY who
    a card is. */
export type ImportStaffCandidate = StaffCandidate & {
  name: string;
  status: "Active" | "Inactive";
};

export type PersonRow =
  /** A saved decision — shown so re-entry reads as done, never re-offered. */
  | { kind: "linked"; person: ImportCandidate; staffProfileId: string; staffName: string }
  /** One confident candidate here, with the reason. A human still presses it. */
  | {
      kind: "suggested";
      person: ImportCandidate;
      staffProfileId: string;
      staffName: string;
      reason: SuggestionReason;
    }
  /** Nobody here corresponds — importable as a new (unclaimed) card. */
  | { kind: "new"; person: ImportCandidate };

/** Arrange every remote person against this workspace, in the input's order —
    grouping and sorting are the screen's decisions.

    The matcher runs STAFF-first (email across everyone before any name), the
    same direction as the linking screen, so one shared discipline decides
    both. Cards already holding a link of this kind, and people already
    claimed by one, are excluded from suggestion on both sides — a saved
    decision is settled, not re-litigated. */
export function buildPeopleRows(
  people: ImportCandidate[],
  staff: ImportStaffCandidate[],
  links: IntegrationLink[]
): PersonRow[] {
  const linkByRemote = new Map(links.map((l) => [l.remoteId, l]));
  const linkedStaffIds = new Set(links.map((l) => l.staffProfileId));
  const staffById = new Map(staff.map((s) => [s.staffProfileId, s]));

  const unlinkedPeople = people.filter((p) => !linkByRemote.has(p.id));
  const unlinkedStaff = staff.filter((s) => !linkedStaffIds.has(s.staffProfileId));

  const { suggestions } = suggestMatches(
    unlinkedStaff,
    unlinkedPeople.map((p) => ({ id: p.id, name: p.name, email: p.email }))
  );
  const suggestionByRemote = new Map(suggestions.map((s) => [s.remoteId, s]));

  return people.map((person) => {
    const link = linkByRemote.get(person.id);
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

    const suggestion = suggestionByRemote.get(person.id);
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
