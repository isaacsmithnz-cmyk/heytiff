import { agreementCardOf, visitCardOf } from "../maintenance-cards";
import type { BoardAgreement, BoardVisit, MaintenanceBoardData } from "../board-query";

/* A VISIT'S CARD, OFF THE BOARD'S OWN DATA. The card opened where you are
   must be the board's card: the same History, last-done and site facts the
   board hands its sheet, and nothing when the board does not hold it. */

const visit = (over: Partial<BoardVisit>): BoardVisit => ({ id: "v", agreementId: "a-1", status: "upcoming", ...over }) as BoardVisit;
const agreement = (over: Partial<BoardAgreement>): BoardAgreement =>
  ({
    id: "a-1",
    label: "Bayview HVAC",
    clientName: "Bayview",
    siteAddress: "14 Bayview Rd",
    siteRequirements: "Induction at the gate",
    equipment: [{ id: "u-1" }],
    lastDone: "2026-07-01",
    ...over,
  }) as BoardAgreement;

const board: MaintenanceBoardData = {
  visits: [
    visit({ id: "v-now" }),
    visit({ id: "v-done", status: "done" }),
    visit({ id: "v-skipped", status: "skipped" }),
    visit({ id: "v-other", agreementId: "a-2", status: "done" }),
  ],
  agreements: [agreement({}), agreement({ id: "a-2", label: "Elsewhere" })],
  staff: [{ id: "s-1", name: "Dane" }],
  tagPool: [{ id: "t-1", name: "Gate code", color: "grey" }],
  categories: [{ id: "c-1", name: "Strata", accent: "blue" }],
  tasks: [],
};

describe("a visit's card", () => {
  it("carries what the board hands its sheet", () => {
    const card = visitCardOf(board, "v-now", "2026-10-11", true)!;
    expect(card.visit.id).toBe("v-now");
    expect(card.history.map((v) => v.id)).toEqual(["v-done"]);
    expect(card).toMatchObject({
      today: "2026-10-11",
      connected: true,
      lastDone: "2026-07-01",
      siteAddress: "14 Bayview Rd",
      siteRequirements: "Induction at the gate",
      staff: board.staff,
      tagPool: board.tagPool,
    });
    expect(card.equipment).toEqual([{ id: "u-1" }]);
  });

  it("is nothing when the board does not hold the visit", () => {
    expect(visitCardOf(board, "v-gone", "2026-10-11", true)).toBeNull();
  });
});

describe("an agreement's card", () => {
  it("carries the agreement and what its sheet offers", () => {
    const card = agreementCardOf(board, "a-2", "2026-10-11")!;
    expect(card.agreement.label).toBe("Elsewhere");
    expect(card.categories).toBe(board.categories);
    expect(card.tagPool).toBe(board.tagPool);
  });

  it("is nothing when the board does not hold it", () => {
    expect(agreementCardOf(board, "a-gone", "2026-10-11")).toBeNull();
  });
});
