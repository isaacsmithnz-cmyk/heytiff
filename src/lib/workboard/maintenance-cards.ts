/* A VISIT OR A SERVICE AGREEMENT, AS ITS CARD NEEDS IT, off the board's data.

   The maintenance board draws a visit's sheet with facts it already holds
   for every visit: the agreement's other finished visits (History), when it
   last ran, the site's address and its "before you go", the units on site,
   and the people and tags the sheet offers. A card opened where you are
   (components/records) has no board under it, so it asks for the same facts
   by the visit's id — built here from the same dataset the board reads, so
   the card is the same card whichever way it was reached.

   Pure: the board's data in, one card out, or null when the board does not
   hold it (a paused agreement's visits, history past the board's window). */

import type {
  BoardAgreement,
  BoardCategory,
  BoardEquipment,
  BoardTag,
  BoardTech,
  BoardVisit,
  MaintenanceBoardData,
} from "./board-query";

export type VisitCard = {
  visit: BoardVisit;
  today: string;
  staff: BoardTech[];
  tagPool: BoardTag[];
  /** ServiceM8 is connected, so the sheet offers what goes through it. */
  connected: boolean;
  /** This agreement's other finished visits, in the board's done window. */
  history: BoardVisit[];
  lastDone: string | null;
  siteAddress: string | null;
  siteRequirements: string | null;
  equipment: BoardEquipment[];
};

export type AgreementCard = {
  agreement: BoardAgreement;
  today: string;
  categories: BoardCategory[];
  tagPool: BoardTag[];
};

export function visitCardOf(
  board: MaintenanceBoardData,
  visitId: string,
  today: string,
  connected: boolean,
): VisitCard | null {
  const visit = board.visits.find((v) => v.id === visitId);
  if (!visit) return null;
  const agreement = board.agreements.find((a) => a.id === visit.agreementId) ?? null;
  return {
    visit,
    today,
    staff: board.staff,
    tagPool: board.tagPool,
    connected,
    history: board.visits.filter(
      (v) => v.agreementId === visit.agreementId && v.status === "done" && v.id !== visit.id,
    ),
    lastDone: agreement?.lastDone ?? null,
    siteAddress: agreement?.siteAddress ?? null,
    siteRequirements: agreement?.siteRequirements ?? null,
    equipment: agreement?.equipment ?? [],
  };
}

export function agreementCardOf(
  board: MaintenanceBoardData,
  agreementId: string,
  today: string,
): AgreementCard | null {
  const agreement = board.agreements.find((a) => a.id === agreementId);
  if (!agreement) return null;
  return { agreement, today, categories: board.categories, tagPool: board.tagPool };
}
