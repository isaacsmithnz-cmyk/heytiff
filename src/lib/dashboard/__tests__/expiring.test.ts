import { EXPIRY_KINDS, expiringItems, isExpiryChip } from "../expiring";
import type { ActionChip, ChipKind } from "../chips";

/* The morning email's expiry list is the bell's own chips, filtered to the
   ones about a date and ordered worst first. What is pinned here: the filter
   keeps every expiry kind and drops every pay kind, the order is the bell's,
   and the mapping carries nothing but what the letter prints. */

const chip = (over: Partial<ActionChip> & { kind: ChipKind }): ActionChip => ({
  key: over.kind,
  state: "warn",
  label: `${over.kind} label`,
  subject: "s",
  href: "/dashboard",
  urgency: 10_000,
  ...over,
});

describe("what counts as expiring", () => {
  it("keeps every kind that is about a date, and nothing under Pay", () => {
    for (const k of EXPIRY_KINDS) expect(isExpiryChip(chip({ kind: k }))).toBe(true);
    for (const k of ["expenses", "timesheet", "claim", "leave-queue", "leave-declined"] as ChipKind[]) {
      expect(isExpiryChip(chip({ kind: k }))).toBe(false);
    }
  });

  it("names the two business-paper kinds — the licence one never reached any nudge before", () => {
    expect(EXPIRY_KINDS.has("org-licence")).toBe(true);
    expect(EXPIRY_KINDS.has("org-insurance")).toBe(true);
  });
});

describe("the list", () => {
  it("merges self and team, drops pay, orders bad before warn and sooner before later", () => {
    const items = expiringItems({
      self: [
        chip({ kind: "licence", key: "mine-warn", state: "warn", urgency: 10_012, label: "White Card expires in 12 days" }),
        chip({ kind: "claim", key: "pay", state: "warn", label: "Your claim was declined" }),
      ],
      team: [
        chip({ kind: "org-licence", key: "arc", state: "bad", urgency: -3, label: "ARC authorisation expired 3 days ago", subject: "Business licence" }),
        chip({ kind: "rego", key: "van", state: "warn", urgency: 10_005, label: "Rego expires in 5 days", subject: "Hiace" }),
        chip({ kind: "expenses", key: "queue", state: "warn", label: "4 expense claims waiting" }),
      ],
    });
    expect(items.map((i) => i.label)).toEqual([
      "ARC authorisation expired 3 days ago",
      "Rego expires in 5 days",
      "White Card expires in 12 days",
    ]);
    expect(items[0]).toEqual({
      label: "ARC authorisation expired 3 days ago",
      subject: "Business licence",
      state: "bad",
      href: "/dashboard",
    });
  });

  it("is empty when nothing is inside the window", () => {
    expect(expiringItems({ self: [], team: [chip({ kind: "claim" })] })).toEqual([]);
  });
});
