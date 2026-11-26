import { mainJobsOnly } from "../main-jobs";

const at = (number: string | null, lat: number | null = -33.85, lng: number | null = 151.19) => ({ number, lat, lng });

describe("one job to a spot (3260, not its invoice job 3260A)", () => {
  it("drops the lettered job at its own job's spot", () => {
    expect(mainJobsOnly([at("3260A"), at("3260")]).map((p) => p.number)).toEqual(["3260"]);
  });
  it("keeps the lettered job when its own job isn't a place", () => {
    expect(mainJobsOnly([at("3260A"), at("3261")]).map((p) => p.number)).toEqual(["3260A", "3261"]);
  });
  it("keeps the lettered job somewhere else", () => {
    expect(mainJobsOnly([at("3260A", -33.9), at("3260")]).map((p) => p.number)).toEqual(["3260A", "3260"]);
  });
  it("leaves jobs without a letter alone", () => {
    expect(mainJobsOnly([at("3260"), at("3260"), at(null)]).length).toBe(3);
  });
});
