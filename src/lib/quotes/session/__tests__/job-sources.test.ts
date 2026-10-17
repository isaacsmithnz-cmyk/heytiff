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

/* Isaac, 2026-10-17: Tiff couldn't see the job's Studio design */
it("lists the job's Studio design as a source, saying read_design reads it", () => {
  const { sources } = jobSources({
    description: "Three bedrooms on a multi",
    sm8Quote: null,
    notes: [],
    designs: [
      { id: "dsn_new", name: "12 Example St", saved: "15 Oct 2026", systems: 2 },
      { id: "dsn_old", name: "12 Example St, first go", saved: "2 Oct 2026", systems: 1 },
    ],
  });
  expect(sources.map((s) => s.id)).toEqual(["description", "design"]);
  expect(sources[1]).toEqual({
    id: "design",
    kind: "design",
    label: "The Studio designs",
    text: "The business's own design of this job, newest first; read_design reads one by its id:\n- 12 Example St (dsn_new), saved 15 Oct 2026, 2 systems\n- 12 Example St, first go (dsn_old), saved 2 Oct 2026, 1 system",
    at: null,
  });
  const one = jobSources({ description: null, sm8Quote: null, notes: [], designs: [{ id: "dsn_new", name: "12 Example St", saved: "15 Oct 2026", systems: 1 }] }).sources;
  expect(one).toEqual([{ id: "design", kind: "design", label: "The Studio design", text: "The business's own design of this job; read_design reads it:\n- 12 Example St (dsn_new), saved 15 Oct 2026, 1 system", at: null }]);
  expect(jobSources({ description: null, sm8Quote: null, notes: [] }).sources).toEqual([]);
});

/* Isaac, 2026-10-11 (3343): quoted again with Tiff, nothing he told the old builder asked again */
it("brings what the person answered on the old builder, question by question", () => {
  const { sources } = jobSources({
    description: null,
    sm8Quote: null,
    notes: [],
    earlier: [
      { question: "Which outside wall do the outdoor unit brackets go on?", answer: "Rear wall, longer run" },
      { question: "How are the pipes concealed?", answer: "Under the floor" },
      { question: "", answer: "dropped" },
    ],
  });
  expect(sources).toEqual([
    { id: "earlier", kind: "earlier", label: "Your answers to the old builder", text: "- Which outside wall do the outdoor unit brackets go on? Rear wall, longer run\n- How are the pipes concealed? Under the floor", at: null },
  ]);
});
