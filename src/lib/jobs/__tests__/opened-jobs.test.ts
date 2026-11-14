/** @jest-environment jsdom */
import { noteJobOpened, openedJobs } from "../opened-jobs";

/* The jobs last opened on this browser, which New design's job picker shows
   first (Isaac, 14 November 2026: "Recent jobs at top"). */
describe("the jobs last opened here", () => {
  beforeEach(() => window.localStorage.clear());

  it("is empty until a job's page opens", () => {
    expect(openedJobs()).toEqual([]);
  });

  it("puts the newest first, and a job opened again goes to the front once", () => {
    noteJobOpened("a");
    noteJobOpened("b");
    noteJobOpened("a");
    expect(openedJobs()).toEqual(["a", "b"]);
  });

  it("keeps ten", () => {
    for (let i = 0; i < 14; i++) noteJobOpened(`job-${i}`);
    expect(openedJobs()).toHaveLength(10);
    expect(openedJobs()[0]).toBe("job-13");
  });

  it("ignores a page with no job, and a store that isn't a list", () => {
    noteJobOpened(null);
    noteJobOpened("");
    expect(openedJobs()).toEqual([]);
    window.localStorage.setItem("heytiff.jobs.opened", '{"not":"a list"}');
    expect(openedJobs()).toEqual([]);
    window.localStorage.setItem("heytiff.jobs.opened", "not json");
    expect(openedJobs()).toEqual([]);
  });
});
