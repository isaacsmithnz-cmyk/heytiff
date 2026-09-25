"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { keepWords } from "@/app/actions/workboard-notes";
import { navHref } from "@/components/shell/nav";
import { TiffBox, type BoxSave } from "@/components/tiff/modal/tiff-box";
import type { DeskFocus } from "@/lib/dashboard/desk-focus";
import { motionAllowed } from "@/lib/dashboard/day-flip";
import {
  DIARY_LIT_MS,
  entryUnder,
  entryWhen,
  type DeskDiary,
  type DiaryDoor,
} from "@/lib/dashboard/diary-doors";
import type { DiaryItem } from "@/lib/dashboard/diary-feed";
import type { DiaryEntry } from "@/lib/dashboard/journal";

/* THE DIARY — the new Home's Diary tab (docs/design.md, "Home is the day,
   three tabs and the list"). One column, newest first, as his prototype
   draws it (v12–v33):

     THE BOX at the top: "Add to the diary…", with the Tiff button at its
     end (components/tiff/modal/tiff-box, the one entry box). Save keeps
     the words as they were typed (`keepWords`), and the entry lands at the
     top of Today, lit; Sort it out and Enter take them to Tiff; the Tiff
     button on an empty box opens her listening, in the diary's room.
     TODAY, a quiet teal label over a rule, then today's entries, or
     "Nothing yet.". Everything older follows with no more dividers, and
     each entry says its own date.
     AN ENTRY is your initials, "You" and when, your words verbatim, and
     under them what they became: a door to each thing still there, a
     sentence for the rest (lib/dashboard/diary-doors decides the words).

   DOORS STAY ON THIS PAGE WHERE THEIR THING IS. A task or an issue is a
   row, so its door hands its ids to the frame (`onShowThings`), which
   lights them in the list beside this column — or, for one the list does
   not hold (a task already ticked off), opens it on the Tasks tab. A
   Library entry and a kept note are screens, so those are links.

   A DOOR FROM ANOTHER FACE (the list's "from your diary", a task's Open in
   diary) names an entry. It is scrolled to 16px under the face's top and
   lit, and handed back once its light has gone. What an entry holds by
   way of light is the one wash, his prototype's: an entry you just saved
   here, or one a door asked for, for seven seconds.

   Your own entries only, for now: the ServiceM8 notes that @mention you
   join this column with their conversations (desk-data says why they are
   not read yet). A viewer without ServiceM8 gets this same diary for
   good. */

/** How far under the face's top an entry a door asked for comes to rest. */
const ENTRY_TOP_PX = 16;

type Who = { viewerStaffId: string | null; names: Readonly<Record<string, string>> };

function DoorControl({
  door,
  onShowThings,
}: {
  door: DiaryDoor;
  onShowThings: (ids: readonly string[], pointer: boolean) => void;
}) {
  switch (door.to) {
    case "tasks":
    case "issue": {
      const ids = door.to === "tasks" ? door.ids : [door.id];
      return (
        /* A click with no pointer behind it came from the keyboard, and
           the frame moves nothing for a keyboard press (law 8). */
        <button type="button" className="hd-dy-door" onClick={(e) => onShowThings(ids, e.detail > 0)}>
          {door.text}
        </button>
      );
    }
    /* Asked for by name rather than written out: the nav is where the app
       says what a screen's route is. */
    case "kb":
      return (
        <Link className="hd-dy-door" href={`${navHref("tiffkb")}?doc=${encodeURIComponent(door.id)}`}>
          {door.text}
        </Link>
      );
    case "note":
      return (
        <Link className="hd-dy-door" href={navHref("mynotes")}>
          {door.text}
        </Link>
      );
  }
}

function Entry({
  entry,
  you,
  who,
  today,
  justNow,
  lit,
  onShowThings,
}: {
  entry: DiaryEntry;
  you: string;
  who: Who;
  today: boolean;
  justNow: boolean;
  lit: boolean;
  onShowThings: (ids: readonly string[], pointer: boolean) => void;
}) {
  const { doors, lines } = entryUnder(entry, who);
  return (
    <li className="hd-dy-it" data-entry={entry.id}>
      <div className="hd-dy-en" data-lit={lit ? "" : undefined}>
        <span className="hd-dy-av" aria-hidden="true">
          {you}
        </span>
        <div className="hd-dy-bd">
          <p className="hd-dy-m">
            <b>You</b>, {entryWhen(entry, { today, justNow })}
          </p>
          <p className="hd-dy-p">{entry.said}</p>
          {doors.length + lines.length > 0 && (
            <div className="hd-dy-doors">
              {doors.map((d, i) => (
                // by place: two doors may honestly say the same words
                <DoorControl key={i} door={d} onShowThings={onShowThings} />
              ))}
              {lines.map((l, i) => (
                <span key={`line${i}`} className="hd-dy-note">
                  {l}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export function HomeDiaryFeed({
  diary,
  viewerStaffId,
  focus,
  onFocusShown,
  onShowThings,
}: {
  diary: DeskDiary;
  viewerStaffId: string | null;
  /** A door from another face. This face acts on `kind: "entry"`. */
  focus: DeskFocus | null;
  /** The entry a door asked for has been shown, and its light has gone. */
  onFocusShown: () => void;
  /** A task or issue door: the frame shows those rows (see above). */
  onShowThings: (ids: readonly string[], pointer: boolean) => void;
}) {
  const { feed, you, names } = diary;
  const todayId = useId();
  const root = useRef<HTMLDivElement>(null);

  /* What was saved from this box since the page opened: "just now", for
     good, and lit while the wash lasts. Each light has its own clock, so a
     second save does not cut the first one's short. */
  const [justNow, setJustNow] = useState<readonly string[]>([]);
  const [saved, setSaved] = useState<readonly string[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
    };
  }, []);

  const save: BoxSave = async (text) => {
    const res = await keepWords(text, "diary");
    if (!res.ok) return { ok: false, error: res.error };
    const id = res.noteId;
    setJustNow((s) => (s.includes(id) ? s : [...s, id]));
    setSaved((s) => (s.includes(id) ? s : [...s, id]));
    const was = timers.current.get(id);
    if (was !== undefined) clearTimeout(was);
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        setSaved((s) => s.filter((x) => x !== id));
      }, DIARY_LIT_MS),
    );
    return { ok: true };
  };

  /* A door from another face: brought to 16px under the face's top, lit,
     and handed back once the light has gone. The face scrolls, not this
     column (the frame's rule: only a face scrolls), so it is the face that
     is moved — measured here, after the commit that showed it. */
  const asked = focus?.kind === "entry" ? focus : null;
  useEffect(() => {
    if (!asked) return;
    const id = asked.ids[0];
    const el = [...(root.current?.querySelectorAll<HTMLElement>("[data-entry]") ?? [])].find(
      (e) => e.dataset.entry === id,
    );
    const face = root.current?.closest<HTMLElement>(".hd-face");
    if (el && face) {
      const top = face.scrollTop + el.getBoundingClientRect().top - face.getBoundingClientRect().top - ENTRY_TOP_PX;
      face.scrollTo?.({ top: Math.max(0, top), behavior: motionAllowed() ? "smooth" : "auto" });
    }
    const t = setTimeout(onFocusShown, DIARY_LIT_MS);
    return () => clearTimeout(t);
  }, [asked, onFocusShown]);

  const who: Who = { viewerStaffId, names };
  const item = (i: DiaryItem, today: boolean) =>
    /* The conversations of those who @mention you come with their own
       read; none is asked for yet (desk-data). */
    i.kind === "entry" ? (
      <Entry
        key={i.key}
        entry={i.entry}
        you={you}
        who={who}
        today={today}
        justNow={justNow.includes(i.entry.id)}
        lit={saved.includes(i.entry.id) || (asked?.ids.includes(i.entry.id) ?? false)}
        onShowThings={onShowThings}
      />
    ) : null;

  return (
    <div className="hd-dy" ref={root}>
      <div className="hd-dy-box">
        <TiffBox room="diary" placeholder="Add to the diary…" save={save} />
      </div>
      <section aria-labelledby={todayId}>
        <h2 className="hd-dy-day" id={todayId}>
          Today
        </h2>
        {feed.today.length === 0 ? (
          <p className="hd-dy-none">Nothing yet.</p>
        ) : (
          <ul className="hd-dy-list">{feed.today.map((i) => item(i, true))}</ul>
        )}
      </section>
      {feed.earlier.length > 0 && (
        <ul className="hd-dy-list" aria-label="Earlier">
          {feed.earlier.map((i) => item(i, false))}
        </ul>
      )}
    </div>
  );
}
