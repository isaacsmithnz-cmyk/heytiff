/* The demo fixture's guard rails. It is throwaway scaffolding, but it renders
   on a real production board, so the two things that stop it doing harm — who
   may see it, and that its rows can't be clicked into nothing — are pinned
   here. Delete this file with demo.ts. */

import { demoAllowedFor, demoOrgIds, demoProjects, demoRadar, isDemoId } from "../demo";
import { maintenanceVitals, projectVitals } from "../vitals";
import { READINESS_KEYS } from "../visit-schedule";

const TODAY = "2026-07-29";
const MINE = "91e33ca2-4847-408d-8ec5-c7cc0fa7a576";

describe("who may see the fixture", () => {
  it("allows the listed orgs and nobody else", () => {
    expect(demoAllowedFor(MINE)).toBe(true);
    // a real customer's org — an empty board is their first morning, not a
    // stage to dress
    expect(demoAllowedFor("f6b55523-5bb9-4b18-bb50-4ab398b12cd3")).toBe(false);
  });

  it("refuses a missing org rather than defaulting to on", () => {
    expect(demoAllowedFor(null)).toBe(false);
    expect(demoAllowedFor(undefined)).toBe(false);
    expect(demoAllowedFor("")).toBe(false);
  });

  it("takes an override list, trimming the way a pasted env var arrives", () => {
    expect(demoOrgIds(" org-a , org-b ")).toEqual(["org-a", "org-b"]);
    expect(demoAllowedFor("org-b", "org-a,org-b")).toBe(true);
    expect(demoAllowedFor(MINE, "org-a,org-b")).toBe(false);
  });

  it("switches off entirely on an explicitly empty override", () => {
    expect(demoOrgIds("")).toEqual([]);
    expect(demoAllowedFor(MINE, "")).toBe(false);
  });
});

describe("the fixture itself", () => {
  it("prefixes every id, which is what stops the screen linking it", () => {
    for (const r of demoRadar(TODAY)) {
      expect(isDemoId(r.visitId)).toBe(true);
      expect(isDemoId(r.agreementId)).toBe(true);
    }
    for (const p of demoProjects(TODAY)) expect(isDemoId(p.id)).toBe(true);
  });

  it("moves with today, so it never goes stale or drifts out of the window", () => {
    const early = demoRadar("2026-01-05");
    const late = demoRadar("2027-11-20");
    expect(early[0].dueDate).toBe("2025-12-27"); // 9 days before
    expect(late[0].dueDate).toBe("2027-11-11");
    expect(early[0].bucket).toBe("overdue");
    expect(late[0].bucket).toBe("overdue");
  });

  it("counts its own readiness off the whitelist rather than by hand", () => {
    for (const r of demoRadar(TODAY)) {
      expect(r.readyTotal).toBe(READINESS_KEYS.length);
      expect(r.ready).toBe(READINESS_KEYS.filter((k) => r.readiness[k]).length);
    }
  });

  it("puts every state the board can paint on screen at once", () => {
    // The whole reason it exists: judging a layout needs one of each.
    const mv = maintenanceVitals(demoRadar(TODAY), TODAY);
    expect(mv.urgent.length).toBeGreaterThan(0);
    expect(mv.attention.length).toBeGreaterThan(0);
    expect(mv.all.some((r) => r.ready === r.readyTotal)).toBe(true);

    const pv = projectVitals(demoProjects(TODAY), TODAY);
    expect(pv.urgent).toHaveLength(1);
    expect(pv.attention).toHaveLength(1);
    expect(pv.all).toHaveLength(3);
  });
});
