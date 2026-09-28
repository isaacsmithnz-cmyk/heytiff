import { openName, parseMove } from "../moves";
import { ALL_SCREENS, SCREEN_ALIASES, squash } from "@/components/shell/nav";

/* The spec's table (docs/universal-tiff-phase-1-spec.md, PR 1C), both ways.
   The note rows are the point: each is a real site instruction that a looser
   rule would have sent to the ask loop and never filed. */
const MOVES: [string, ReturnType<typeof parseMove>][] = [
  ["Take me to the workboard", { kind: "screen", label: "Workboard" }],
  ["Tiff, can you take me to the work board please", { kind: "screen", label: "Workboard" }],
  ["Can you bring me to the workboard screen?", { kind: "screen", label: "Workboard" }],
  ["open my timesheet", { kind: "screen", label: "Timesheet" }],
  ["take me to time and pay", { kind: "screen", label: "Time & Pay" }],
  ["take me home", { kind: "screen", label: "Home" }],
  ["take me back to the dashboard", { kind: "screen", label: "Home" }],
  ["go to the workboard screen", { kind: "screen", label: "Workboard" }],
  ["Open Dane's card", { kind: "record" }],
  ["pull up the Meridian job", { kind: "record" }],
  ["open job 1044", { kind: "record" }],
];

const NOTES = [
  "go to the workboard",
  "go to the toolbox",
  "go to Smith St and pick up the grilles",
  "go to the Meridian job and check the filters",
  "open a task for Lyle to order grilles",
  "open the grilles box on the ute",
  "take Lyle to the Smith St job",
  "Open up the ceiling and finish the job",
  "Pull up the old flex on the Meridian job",
  "Bring up the ladder for the Crown project",
  "Open the boxes for the job",
  "Pull up the carpet at Dane's job",
  "Open Dane's ute and grab the grilles for the job",
  "Bring up the Meridian project",
  "Bring up the expenses",
  "Lyle needs to order the grilles for Smith St by Friday",
  "can you order the grilles",
];

describe("parseMove", () => {
  it.each(MOVES)("%s is a move", (text, want) => {
    expect(parseMove(text)).toEqual(want);
  });

  it.each(NOTES)("%s stays a note", (text) => {
    expect(parseMove(text)).toBeNull();
  });

  it("knows every screen by its own name", () => {
    for (const n of ALL_SCREENS) expect(parseMove(`take me to ${n.label}`)).toEqual({ kind: "screen", label: n.label });
  });

  it("keeps the squashed names unique, so one word never means two screens", () => {
    const labels = ALL_SCREENS.map((n) => squash(n.label));
    expect(new Set(labels).size).toBe(labels.length);
    for (const [alias, label] of Object.entries(SCREEN_ALIASES)) {
      const clash = ALL_SCREENS.find((n) => squash(n.label) === alias && n.label !== label);
      expect(clash).toBeUndefined();
    }
  });
});

describe("openName, the name in an open request", () => {
  /* Looser than parseMove, because nothing acts on it alone: it opens only
     on one exact match (registry/screens' openByName). */
  it.each([
    ["Open up Isaac Smith.", "isaac smith"],
    ["open Lyle", "lyle"],
    ["can you pull up Meridian Data please", "meridian data"],
    ["show me Dane's card", "dane"],
    ["open the Harbour Rd project", "harbour rd"],
    ["bring up job 1044", "job 1044"],
    ["take me to Lily Pilly", "lily pilly"],
  ])("%s → %s", (said, name) => {
    expect(openName(said)).toBe(name);
  });

  it.each([
    "open up the ceiling at Smith St",
    "bring up the ladder and the drill",
    "Lyle needs to order grilles",
    "open",
    "open up the roof hatch on the north side of the building near the plant room",
  ])("%s gives no name", (said) => {
    expect(openName(said)).toBeNull();
  });

  it("a one-word site noun still gives a name, and names nothing unless a record is called exactly that", () => {
    expect(openName("open up the ceiling")).toBe("ceiling");
  });
});
