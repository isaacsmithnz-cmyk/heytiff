import { cameFrom, noteRoute, resetTrail } from "../came-from";
import { backLabel } from "@/components/jobs/way-back";

jest.mock("@/components/notes/tiff-button", () => ({ TiffButton: () => null }));

beforeEach(() => resetTrail());

describe("where a job was opened from", () => {
  it("is the screen before, and a change of tab on the job is no step", () => {
    noteRoute("/dashboard/jobs?status=won");
    noteRoute("/dashboard/jobs/j-1");
    noteRoute("/dashboard/jobs/j-1?tab=billing");
    expect(cameFrom("/dashboard/jobs/j-1")).toBe("/dashboard/jobs?status=won");
  });

  it("is nowhere after a refresh or a link: the trail starts at the job", () => {
    noteRoute("/dashboard/jobs/j-1");
    expect(cameFrom("/dashboard/jobs/j-1")).toBeNull();
  });

  it("walks back with the browser's Back, so the word is where Back would land", () => {
    noteRoute("/dashboard");
    noteRoute("/dashboard/jobs/j-1");
    noteRoute("/dashboard/jobs/j-1/quote");
    window.dispatchEvent(new PopStateEvent("popstate"));
    noteRoute("/dashboard/jobs/j-1");
    expect(cameFrom("/dashboard/jobs/j-1")).toBe("/dashboard");
  });

  it("says a place by its own name", () => {
    expect(backLabel("/dashboard")).toBe("Home");
    expect(backLabel("/dashboard/jobs?status=won")).toBe("Jobs");
    expect(backLabel("/dashboard/schedule")).toBe("Schedule");
    expect(backLabel("/dashboard/jobs/j-2", { "/dashboard/jobs/j-2": { label: "3209 Richards" } })).toBe("3209 Richards");
  });
});
