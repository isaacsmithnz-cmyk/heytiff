/* Read the job (slice 4.5): every note whole and once, oldest first, each a
   source to untick; past the budget the oldest give way, and it says so. */
import { BRIEF_BUDGET, briefOf, dayOf, jobSources } from "../job-sources";

const note = (id: string, at: string, text: string, by: string | null = "Luke Bennett") => ({ id, at, text, by });

it("lists the description, ServiceM8's quote and every note, oldest first and each once", () => {
  const { sources, left } = jobSources({
    description: "Ducted upstairs and down",
    sm8Quote: "As quoted in ServiceM8:\n1 × PEA-M125HAA",
    notes: [
      note("b", "2026-10-06 10:00:00", "Six floor grilles 350 x 150."),
      note("a", "2026-10-05 09:00:00", "Single phase, western side."),
      /* a HeyTiff note sent to ServiceM8 is both, word for word */
      note("c", "2026-10-06 10:01:00", "Six floor grilles  350 x 150.", null),
      note("d", "2026-10-06 11:00:00", "   "),
    ],
  });
  expect(sources.map((s) => s.label)).toEqual(["The job's description", "ServiceM8's quote", "Note, 5 Oct 2026, Luke Bennett", "Note, 6 Oct 2026, Luke Bennett"]);
  expect(left).toBe(0);
  expect(briefOf(sources, new Set(["description", "note:b"]))).toBe("[The job's description]\nDucted upstairs and down\n\n[Note, 6 Oct 2026, Luke Bennett]\nSix floor grilles 350 x 150.");
});

it("keeps the newest notes within the budget and counts the oldest left out", () => {
  const big = "x".repeat(BRIEF_BUDGET / 4);
  const { sources, left } = jobSources({ description: null, sm8Quote: null, notes: ["1", "2", "3", "4"].map((d) => note(d, `2026-10-0${d} 09:00:00`, `${d}${big}`)) });
  expect(sources.map((s) => s.id)).toEqual(["note:2", "note:3", "note:4"]);
  expect(left).toBe(1);
});

it("says a day as people do", () => {
  expect(dayOf("2026-10-06 09:12:00")).toBe("6 Oct 2026");
  expect(dayOf(null)).toBe("");
});
