import { arrive, newTab, openInTab, tabsSnapshot } from "../open-tabs";

/* Design's Open job (Isaac, 21 October 2026): the job's tab if one holds
   it, else a new tab, so the design keeps its own. */

beforeEach(() => sessionStorage.clear());

it("switches to the tab that already holds the job, whatever section it's on", () => {
  arrive("/dashboard/jobs/j1?tab=visits");
  newTab("/dashboard/jobs/j1?tab=visits");
  arrive("/dashboard/studio?design=d1");
  expect(openInTab("/dashboard/jobs/j1", "/dashboard/studio?design=d1")).toBe("/dashboard/jobs/j1?tab=visits");
  const s = tabsSnapshot();
  expect(s.tabs.find((t) => t.id === s.on)?.href).toBe("/dashboard/jobs/j1?tab=visits");
});

it("opens a new tab for the job when none holds it, and the design keeps its own", () => {
  arrive("/dashboard/studio?design=d2");
  const before = tabsSnapshot().tabs.length;
  expect(openInTab("/dashboard/jobs/j9", "/dashboard/studio?design=d2")).toBe("/dashboard/jobs/j9");
  arrive("/dashboard/jobs/j9");
  const s = tabsSnapshot();
  expect(s.tabs.length).toBe(before + 1);
  expect(s.tabs.some((t) => t.href === "/dashboard/studio?design=d2")).toBe(true);
});
