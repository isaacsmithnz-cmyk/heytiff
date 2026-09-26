/* THE NEW HOME'S FACES, AND THE ONE DOOR BETWEEN THEM.

   Three faces under one row of tabs, in the order Isaac set (2026-09-25,
   v32: "swap Tasks and calendar around"): Diary | Tasks | Calendar. The row
   never moves, and the body under it slides in that order — a tab to the
   right comes in from the right. The Calendar is a page of its own, so it
   slides across the whole body, the diary column and the list; Diary and
   Tasks share the list, so between those two only the column slides.

   ONE DOOR. The areas being built into this Home each reached for their own
   way of saying "go over there and show that": a task id to focus, a
   conversation to open, a flash of rows by id and count. They are one
   shape here — a face, what kind of thing, and which ones — and the face
   that receives it decides what showing means. Pure, so the order and the
   plan of every slide can be tested without a browser. */

export const DESK_FACES = ["diary", "tasks", "calendar"] as const;
export type DeskFace = (typeof DESK_FACES)[number];

/** You land on the diary: what you told Tiff, with the day above it. */
export const DEFAULT_FACE: DeskFace = "diary";

export const FACE_LABEL: Record<DeskFace, string> = {
  diary: "Diary",
  tasks: "Tasks",
  calendar: "Calendar",
};

/** What a door asks a face to show. */
export type DeskFocusKind = "entry" | "conversation" | "task" | "rows";

export type DeskFocus = {
  face: DeskFace;
  kind: DeskFocusKind;
  ids: readonly string[];
};

/** A door as the face it names is handed it: what it asks for, and whether
    a pointer pressed it. The face that shows it moves nothing for a door
    pressed from the keyboard — no smooth scroll, as no slide (law 8) — so
    the press travels with the door rather than being guessed at the far
    end. */
export type DeskArrival = DeskFocus & { pointer: boolean };

/** Where a door naming tasks or an issue lands (the diary's task and issue
    doors): lit in the list beside the diary, for those it holds; else
    chosen on the Tasks tab, the first it holds; else nowhere — and a door
    with nowhere to land is not drawn as a door (lib/dashboard/diary-doors
    says it as a sentence). `list` and `tasks` are the ids each has a row
    for. */
export function thingsDoor(
  ids: readonly string[],
  on: { list: ReadonlySet<string>; tasks: ReadonlySet<string> },
): DeskFocus | null {
  const here = ids.filter((id) => on.list.has(id));
  if (here.length > 0) return { face: "diary", kind: "rows", ids: here };
  const there = ids.find((id) => on.tasks.has(id));
  return there === undefined ? null : { face: "tasks", kind: "task", ids: [there] };
}

/** Isaac's slide, walked on the prototype (v30–v32). Longer than
    `--t-move` on his word — a named exemption in docs/design.md. */
export const FACE_SLIDE_MS = 280;

/** +1 when `to` stands to the right of `from` in the tab row, −1 to its
    left: the side the new face comes in from. */
export function slideDir(from: DeskFace, to: DeskFace): 1 | -1 {
  return DESK_FACES.indexOf(to) > DESK_FACES.indexOf(from) ? 1 : -1;
}

/** The four things that slide: the body under the tabs (the diary column
    and the list together), the Calendar's page, and the column's two
    faces. */
export type SlidePart = "main" | "calendar" | "diary" | "tasks";

export type SlidePlan = {
  /** What clips the slide and gives it its width. */
  box: "body" | "column";
  leaving: SlidePart;
  arriving: SlidePart;
  dir: 1 | -1;
};

/** Which part leaves, which arrives, across what — or null when there is
    nowhere to go. */
export function slidePlan(from: DeskFace, to: DeskFace): SlidePlan | null {
  if (from === to) return null;
  const dir = slideDir(from, to);
  if (from === "calendar" || to === "calendar") {
    return {
      box: "body",
      leaving: from === "calendar" ? "calendar" : "main",
      arriving: to === "calendar" ? "calendar" : "main",
      dir,
    };
  }
  return { box: "column", leaving: from, arriving: to, dir };
}

/** Whether a part is on the page: the face's own parts at rest, plus the
    face on its way out while it slides. The column keeps the face that was
    up as it slides away under the Calendar, and shows the face you asked
    for as it comes back. */
export function partShown(part: SlidePart, face: DeskFace, leaving: DeskFace | null): boolean {
  switch (part) {
    case "calendar":
      return face === "calendar" || leaving === "calendar";
    case "main":
      return face !== "calendar" || (leaving !== null && leaving !== "calendar");
    default:
      return face === part || leaving === part;
  }
}

/** The tab row's keys: Left and Right step and wrap, Home and End jump.
    Null for any other key, which the row leaves alone. */
export function stepFace(face: DeskFace, key: string): DeskFace | null {
  const at = DESK_FACES.indexOf(face);
  const n = DESK_FACES.length;
  switch (key) {
    case "ArrowRight":
      return DESK_FACES[(at + 1) % n]!;
    case "ArrowLeft":
      return DESK_FACES[(at - 1 + n) % n]!;
    case "Home":
      return DESK_FACES[0];
    case "End":
      return DESK_FACES[n - 1]!;
    default:
      return null;
  }
}
