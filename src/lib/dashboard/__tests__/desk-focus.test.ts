import {
  DEFAULT_FACE,
  DESK_FACES,
  FACE_LABEL,
  FACE_SLIDE_MS,
  partShown,
  slideDir,
  slidePlan,
  stepFace,
  thingsDoor,
  type DeskFace,
  type SlidePart,
} from "../desk-focus";

/* The new Home's faces, in Isaac's order, and the plan of every slide
   between them (2026-09-25: "Calendar should slide across"; v32: "swap
   Tasks and calendar around"). */

describe("the faces", () => {
  it("stand Diary, Tasks, Calendar — his order — and land on the diary", () => {
    expect(DESK_FACES.map((f) => FACE_LABEL[f])).toEqual(["Diary", "Tasks", "Calendar"]);
    expect(DEFAULT_FACE).toBe("diary");
  });

  it("slide in his 280 ms", () => {
    expect(FACE_SLIDE_MS).toBe(280);
  });
});

describe("which way a face comes in", () => {
  it("from the right for a tab to the right, from the left for one to the left", () => {
    expect(slideDir("diary", "tasks")).toBe(1);
    expect(slideDir("diary", "calendar")).toBe(1);
    expect(slideDir("tasks", "calendar")).toBe(1);
    expect(slideDir("calendar", "tasks")).toBe(-1);
    expect(slideDir("calendar", "diary")).toBe(-1);
    expect(slideDir("tasks", "diary")).toBe(-1);
  });
});

describe("what slides, across what", () => {
  it("slides only the diary column between Diary and Tasks — they share the list", () => {
    expect(slidePlan("diary", "tasks")).toEqual({ box: "column", leaving: "diary", arriving: "tasks", dir: 1 });
    expect(slidePlan("tasks", "diary")).toEqual({ box: "column", leaving: "tasks", arriving: "diary", dir: -1 });
  });

  it("slides the whole body, column and list, to and from the Calendar", () => {
    expect(slidePlan("diary", "calendar")).toEqual({ box: "body", leaving: "main", arriving: "calendar", dir: 1 });
    expect(slidePlan("tasks", "calendar")).toEqual({ box: "body", leaving: "main", arriving: "calendar", dir: 1 });
    expect(slidePlan("calendar", "diary")).toEqual({ box: "body", leaving: "calendar", arriving: "main", dir: -1 });
    expect(slidePlan("calendar", "tasks")).toEqual({ box: "body", leaving: "calendar", arriving: "main", dir: -1 });
  });

  it("has nowhere to go for the face already up", () => {
    for (const f of DESK_FACES) expect(slidePlan(f, f)).toBeNull();
  });
});

describe("what is on the page", () => {
  const PARTS: SlidePart[] = ["main", "diary", "tasks", "calendar"];
  const on = (face: DeskFace, leaving: DeskFace | null) => PARTS.filter((p) => partShown(p, face, leaving));

  it("shows the face's own parts at rest, and nothing else", () => {
    expect(on("diary", null)).toEqual(["main", "diary"]);
    expect(on("tasks", null)).toEqual(["main", "tasks"]);
    expect(on("calendar", null)).toEqual(["calendar"]);
  });

  it("keeps the face on its way out on the page while it slides", () => {
    expect(on("tasks", "diary")).toEqual(["main", "diary", "tasks"]);
    expect(on("diary", "tasks")).toEqual(["main", "diary", "tasks"]);
  });

  it("carries the column's own face under the Calendar as it goes, and the one you asked for as it comes back", () => {
    // Tasks up, then Calendar: the body leaves holding Tasks, never the diary
    expect(on("calendar", "tasks")).toEqual(["main", "tasks", "calendar"]);
    // Calendar up, then Diary: the body arrives holding the diary
    expect(on("diary", "calendar")).toEqual(["main", "diary", "calendar"]);
    expect(on("tasks", "calendar")).toEqual(["main", "tasks", "calendar"]);
  });
});

describe("the tab row's keys", () => {
  it("steps and wraps on the arrows, jumps on Home and End, and leaves every other key alone", () => {
    expect(stepFace("diary", "ArrowRight")).toBe("tasks");
    expect(stepFace("calendar", "ArrowRight")).toBe("diary");
    expect(stepFace("diary", "ArrowLeft")).toBe("calendar");
    expect(stepFace("tasks", "Home")).toBe("diary");
    expect(stepFace("diary", "End")).toBe("calendar");
    expect(stepFace("diary", "ArrowDown")).toBeNull();
    expect(stepFace("diary", "Enter")).toBeNull();
  });
});

/* A diary door naming tasks or an issue lands where a row holds it: the
   list beside the diary first, then the Tasks tab — and nowhere else, so
   the Tasks tab is never opened on a thing it does not have, where it
   would show its first row instead. */
describe("thingsDoor", () => {
  const on = { list: new Set(["t1", "i1"]), tasks: new Set(["t1", "t2", "t3", "i1"]) };

  it("lights in the list what the list holds, and only that", () => {
    expect(thingsDoor(["t9", "t1", "i1"], on)).toEqual({ face: "diary", kind: "rows", ids: ["t1", "i1"] });
  });

  it("chooses on the Tasks tab the first the Tasks tab holds, when the list holds none", () => {
    expect(thingsDoor(["t9", "t3", "t2"], on)).toEqual({ face: "tasks", kind: "task", ids: ["t3"] });
  });

  it("goes nowhere for what neither holds: a task ticked off long ago, a resolved issue", () => {
    expect(thingsDoor(["t9", "i9"], on)).toBeNull();
    expect(thingsDoor([], on)).toBeNull();
  });
});
