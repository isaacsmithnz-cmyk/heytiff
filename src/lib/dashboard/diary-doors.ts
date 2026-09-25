/* THE DIARY'S ENTRIES, SAID — pure. What the new Home's Diary tab writes
   under each of your entries and over it, decided here where a test can see
   it (the face is components/dashboard/home-diary-feed).

   OVER THE WORDS, who and when: "You, 2:17 pm" today, "You, Mon 8 Sept,
   8:42 pm" before today, and "You, just now" for what you filed from this
   page since you opened it. Every date is the entry's own, on the clock the
   diary sorts by (journal-query's listDiaryEntries); nothing here reads a
   clock.

   UNDER THE WORDS, what they became: DOORS to the things that are still
   there, and QUIET LINES for the rest.

     Tasks go by whose they are, one door each: "2 tasks for Luke",
     "1 task for Lorenzo", and just "1 task" when it is yours (or nobody's:
     a task on no one is nobody else's either; nor is one on a card the
     workspace no longer names). The door carries every task
     it counts, so pressing it shows them all. The one-chip-per-task titles
     the old diary drew (journal's describeAppliedResolved) are counted
     here instead: the diary is a column of what you said, and a title
     repeats what you said.
     A Library entry, a kept note and an issue keep the door they have
     always had, wearing what describeAppliedResolved named them.
     Everything with nowhere to go is a sentence: "1 line kept.", "2 flags.",
     "1 task removed." — what the entry really made, that really isn't
     there to open.
     "Nothing filed." is Tiff's read that made nothing, and only that: a
     Save files the words as typed and routes nothing, so it says nothing
     under them at all. */

import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { DiaryFeed } from "./diary-feed";
import type { DiaryEntry } from "./journal";

/** The Diary tab's part of the new Home's data (desk-data's `loadDesk`). */
export type DeskDiary = {
  /** Your entries, newest first, with Today split off (./diary-feed). */
  feed: DiaryFeed;
  /** Your initials, for your own avatar, from the name your staff card
      goes by. */
  you: string;
  /** Staff id → first name, for the people this diary's tasks are on and
      nobody else: "2 tasks for Luke". */
  names: Record<string, string>;
};

/** How long an entry that has just landed, or that a door asked for, stays
    lit: his prototype's wash (v12). */
export const DIARY_LIT_MS = 7000;

/** Where a door under an entry goes. The face decides how: tasks and an
    issue are rows on this page (the list beside the diary, or the Tasks
    tab), a Library entry and a kept note are screens. */
export type DiaryDoor =
  | { to: "tasks"; text: string; ids: string[] }
  | { to: "issue"; text: string; id: string }
  | { to: "kb"; text: string; id: string }
  | { to: "note"; text: string; id: string };

export type EntryUnder = {
  doors: DiaryDoor[];
  /** Sentences, each with its full stop. */
  lines: string[];
};

export const NOTHING_FILED = "Nothing filed.";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What an entry became: its doors, then its quiet lines. `viewerStaffId`
    is whose tasks need no name; `names` is staff id → first name. */
export function entryUnder(
  entry: DiaryEntry,
  who: { viewerStaffId: string | null; names: Readonly<Record<string, string>> },
): EntryUnder {
  const doors: DiaryDoor[] = [];
  const lines: string[] = [];
  /* One door per person, standing where that person's first task stood. */
  const tasksOf = new Map<string, Extract<DiaryDoor, { to: "tasks" }>>();

  for (const o of entry.outcomes) {
    const go = o.go;
    if (!go) {
      lines.push(`${o.text}.`);
      continue;
    }
    switch (go.type) {
      case "task": {
        const owner = entry.taskFor[go.id] ?? null;
        const first = owner !== null && owner !== who.viewerStaffId ? (who.names[owner] ?? null) : null;
        const key = first ?? "";
        let door = tasksOf.get(key);
        if (!door) {
          door = { to: "tasks", text: "", ids: [] };
          tasksOf.set(key, door);
          doors.push(door);
        }
        door.ids.push(go.id);
        door.text = `${plural(door.ids.length, "task", "tasks")}${first ? ` for ${first}` : ""}`;
        break;
      }
      case "issue":
      case "kb":
      case "note":
        doors.push({ to: go.type, text: o.text, id: go.id });
        break;
    }
  }

  if (entry.routed && entry.outcomes.length === 0) lines.push(NOTHING_FILED);
  return { doors, lines };
}

/** "just now", "2:17 pm" or "Mon 8 Sept, 8:42 pm" — said after "You, ". */
export function entryWhen(entry: DiaryEntry, at: { today: boolean; justNow: boolean }): string {
  if (at.justNow) return "just now";
  if (at.today) return entry.at;
  const day = fmtAuWeekdayDayMonth(entry.day);
  return day ? `${day}, ${entry.at}` : entry.at;
}

/** The staff this feed's tasks are on — whose first names the diary needs,
    and nobody else's. */
export function taskOwners(feed: DiaryFeed): string[] {
  const out = new Set<string>();
  for (const item of [...feed.today, ...feed.earlier]) {
    if (item.kind !== "entry") continue;
    for (const owner of Object.values(item.entry.taskFor)) if (owner) out.add(owner);
  }
  return [...out];
}
