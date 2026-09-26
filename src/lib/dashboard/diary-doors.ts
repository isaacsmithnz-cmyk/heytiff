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

     Tasks go by whose they are — by the staff card, never by the name on
     it — one door each: "2 tasks for Luke", "1 task for Lorenzo", and just
     "1 task" when it is yours, or nobody's (a task on no one is nobody
     else's either). Two people who share a first name are two doors, each
     with the whole name (`ownerNames`); a card the workspace no longer
     names is a door of its own that names nobody, never counted in with
     yours. The door carries every task
     it counts, so pressing it shows them all. The one-chip-per-task titles
     the old diary drew (journal's describeAppliedResolved) are counted
     here instead: the diary is a column of what you said, and a title
     repeats what you said.
     A Library entry, a kept note and an issue keep the door they have
     always had, wearing what describeAppliedResolved named them.
     Everything with nowhere to go is a sentence: "1 line kept.", "2 flags.",
     "1 task removed." — what the entry really made, that really isn't
     there to open. So is a task or an issue that is still there but that
     no row on this page holds (a task ticked off long ago, an issue
     resolved): "1 task for Luke." A door that opened on something else
     would be worse than none.
     "Nothing filed." is Tiff's read that made nothing, and only that: a
     Save files the words as typed and routes nothing, so it says nothing
     under them at all. Nor does an entry Undo took back: what it made has
     gone, and Tiff's line under the words says so ("1 task taken back.").

   TIFF'S LINE is her last turn in the conversation the entry came out of
   (journal-query reads it off the row), said after "Tiff: " — nothing when
   she never answered. */

import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { DiaryFeed } from "./diary-feed";
import { firstNames } from "./home-list";
import type { DiaryEntry } from "./journal";

/** The Diary tab's part of the new Home's data (desk-data's `loadDesk`). */
export type DeskDiary = {
  /** Your entries and your ServiceM8 conversations, newest first, with
      Today split off (./diary-feed). */
  feed: DiaryFeed;
  /** Your initials, for your own avatar, from the name your staff card
      goes by. */
  you: string;
  /** Staff id → what to call them, for the people this diary's tasks are
      on and nobody else: "2 tasks for Luke" (`ownerNames`). */
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

/** Words said as a sentence: with a full stop, unless they already end on
    one (an issue's summary may). */
const sentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);

/** What an entry became: its doors, then its quiet lines. `viewerStaffId`
    is whose tasks need no name; `names` is staff id → what to call them
    (`ownerNames`). `onPage`, when given, is every task and issue a row on
    this page holds (the list beside the diary, and the Tasks tab): a task
    door none of whose tasks is there, or an issue that isn't, is said as a
    sentence instead of drawn as a door. */
export function entryUnder(
  entry: DiaryEntry,
  who: { viewerStaffId: string | null; names: Readonly<Record<string, string>> },
  onPage?: ReadonlySet<string>,
): EntryUnder {
  const doors: DiaryDoor[] = [];
  const lines: string[] = [];
  /* Taken back: what it made has gone, and Tiff's line says so. */
  if (entry.undone) return { doors, lines };
  /* One door per staff card, standing where that card's first task stood.
     Keyed by the card, not the name on it: two Lukes are two people. */
  const tasksOf = new Map<string, Extract<DiaryDoor, { to: "tasks" }>>();

  for (const o of entry.outcomes) {
    const go = o.go;
    if (!go) {
      lines.push(sentence(o.text));
      continue;
    }
    switch (go.type) {
      case "task": {
        const owner = entry.taskFor[go.id] ?? null;
        /* yours and nobody's need no name, and are counted together */
        const theirs = owner !== null && owner !== who.viewerStaffId ? owner : null;
        const name = theirs === null ? null : (who.names[theirs] ?? null);
        const key = theirs ?? "";
        let door = tasksOf.get(key);
        if (!door) {
          door = { to: "tasks", text: "", ids: [] };
          tasksOf.set(key, door);
          doors.push(door);
        }
        door.ids.push(go.id);
        door.text = `${plural(door.ids.length, "task", "tasks")}${name ? ` for ${name}` : ""}`;
        break;
      }
      case "issue":
      case "kb":
      case "note":
        doors.push({ to: go.type, text: o.text, id: go.id });
        break;
    }
  }

  /* A Library entry and a kept note are screens of their own, always there
     to open. A task or an issue opens on a row of this page, or nowhere. */
  const landed = onPage
    ? doors.filter((d) => {
        const ids = d.to === "tasks" ? d.ids : d.to === "issue" ? [d.id] : null;
        if (ids === null || ids.some((id) => onPage.has(id))) return true;
        lines.push(sentence(d.text));
        return false;
      })
    : doors;

  if (entry.routed && entry.outcomes.length === 0) lines.push(NOTHING_FILED);
  return { doors: landed, lines };
}

/** Staff id → what the diary calls the people its tasks are on: their
    first name ("2 tasks for Luke"), or the whole name their card goes by
    when another of them shares the first (as diary-feed says a mention's
    names), so two people never read as one. Nobody else is named. */
export function ownerNames(feed: DiaryFeed, names: ReadonlyMap<string, string>): Record<string, string> {
  const known = new Map<string, string>();
  for (const id of taskOwners(feed)) {
    const name = names.get(id);
    if (name !== undefined) known.set(id, name);
  }
  const first = firstNames(known);
  const sharing = new Map<string, number>();
  for (const f of Object.values(first)) sharing.set(f, (sharing.get(f) ?? 0) + 1);
  const out: Record<string, string> = {};
  for (const [id, f] of Object.entries(first)) {
    out[id] = (sharing.get(f) ?? 0) > 1 ? (known.get(id) ?? f).trim().replace(/\s+/g, " ") : f;
  }
  return out;
}

/** "just now", "2:17 pm" or "Mon 8 Sept, 8:42 pm" — said after "You, ". */
export function entryWhen(entry: DiaryEntry, at: { today: boolean; justNow: boolean }): string {
  if (at.justNow) return "just now";
  if (at.today) return entry.at;
  const day = fmtAuWeekdayDayMonth(entry.day);
  return day ? `${day}, ${entry.at}` : entry.at;
}

/** The staff this feed's tasks are on — an entry's, and a ServiceM8 ask's
    (one given to Leo since is "1 task for Leo") — whose first names the
    diary needs, and nobody else's. */
export function taskOwners(feed: DiaryFeed): string[] {
  const out = new Set<string>();
  for (const item of [...feed.today, ...feed.earlier]) {
    if (item.kind === "entry") {
      for (const owner of Object.values(item.entry.taskFor)) if (owner) out.add(owner);
    } else {
      for (const t of item.conversation.tasks) if (t.ownerId) out.add(t.ownerId);
    }
  }
  return [...out];
}
