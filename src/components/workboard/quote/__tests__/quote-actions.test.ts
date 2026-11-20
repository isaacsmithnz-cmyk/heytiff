import { panelFoot } from "../quote-actions";

/* The quote's own tab: the panel's foot is one button, the next step, and
   the rest move to the head's Actions (Isaac, 21 November 2026: "Yes, one
   button"). */

const base = {
  money: true,
  lines: 4,
  kept: false,
  variation: null,
  approved: false,
  sending: false,
  acceptable: false,
  accepted: false,
  update: false,
  paper: false,
};

describe("panelFoot", () => {
  it("is Mark ready to send until it's ready, with nothing moved", () => {
    expect(panelFoot(base)).toEqual({ step: "approve", moved: [] });
  });

  it("is Send to ServiceM8 once ready; Customer accepted and Update quote go to Actions", () => {
    expect(panelFoot({ ...base, approved: true, sending: true, acceptable: true, update: true })).toEqual({
      step: "send",
      moved: ["accept", "update"],
    });
  });

  it("is Customer accepted once it's sent", () => {
    expect(panelFoot({ ...base, approved: true, acceptable: true, update: true })).toEqual({ step: "accept", moved: ["update"] });
  });

  it("is Update quote once the customer accepted", () => {
    expect(panelFoot({ ...base, approved: true, acceptable: true, accepted: true, update: true })).toEqual({ step: "update", moved: [] });
  });

  it("offers no Update quote over the Proposal, as before", () => {
    expect(panelFoot({ ...base, approved: true, acceptable: true, accepted: true, update: true, paper: true })).toEqual({ step: null, moved: [] });
  });

  it("is a variation's approve, then its accept, with nothing moved", () => {
    const variation = { option: 2, n: 1, what: "", startedAt: "", approvedAt: null, acceptedAt: null } as never;
    expect(panelFoot({ ...base, variation })).toEqual({ step: "approve", moved: [] });
    expect(panelFoot({ ...base, variation: { ...(variation as object), approvedAt: "2026-11-21" } as never })).toEqual({ step: "accept", moved: [] });
  });

  it("is nothing to a tech, on an empty option, or on a kept version", () => {
    expect(panelFoot({ ...base, money: false }).step).toBeNull();
    expect(panelFoot({ ...base, lines: 0 }).step).toBeNull();
    expect(panelFoot({ ...base, kept: true }).step).toBeNull();
  });
});
