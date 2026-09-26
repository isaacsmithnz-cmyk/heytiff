"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { keepWords } from "@/app/actions/workboard-notes";
import { navHref } from "@/components/shell/nav";
import { TiffBox, type BoxSave } from "@/components/tiff/modal/tiff-box";
import type { DeskArrival } from "@/lib/dashboard/desk-focus";
import { motionAllowed } from "@/lib/dashboard/day-flip";
import { diaryItemOf } from "@/lib/dashboard/diary-conversation";
import {
  DIARY_LIT_MS,
  entryUnder,
  entryWhen,
  type DeskDiary,
  type DiaryDoor,
} from "@/lib/dashboard/diary-doors";
import type { DiaryItem } from "@/lib/dashboard/diary-feed";
import type { DiaryEntry } from "@/lib/dashboard/journal";
import { HomeDiaryConversation } from "./home-diary-conversation";
import { useDiaryRefresh } from "./use-diary-refresh";

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
   not hold (a task ticked off today), opens it on the Tasks tab. One that
   no row on the page holds (`onPage`) is said, not drawn as a door. A
   Library entry and a kept note are screens, so those are links.

     SOMEONE WHO ASKED YOU SOMETHING in a ServiceM8 job note is a
     conversation in the same column, sorted by their newest message, so
     an answer to last week's ask comes up into Today
     (./home-diary-conversation, the job door and Reply included).

   A DOOR FROM ANOTHER FACE names an entry (the list's "from your diary", a
   task's Open in diary) or a conversation, by one of its notes (the task
   an ask made). It is scrolled to 16px under the face's top — smoothly
   only for a door a pointer pressed (law 8) — lit, and given the focus,
   since the door that was pressed may have gone with its face; and it is
   handed back once its light has gone. What an entry holds by way of light
   is the one wash, his prototype's: an entry you just saved here, a
   message from someone that is today's and unanswered, or one a door asked
   for, on his pale teal for three quarters of seven seconds, then fading
   (shell.css; a still tint under reduced motion).

   THE PAGE COMES AGAIN on its own for a diary that reads ServiceM8, so
   what was written there reaches it without a reload (./use-diary-refresh).
   A viewer without ServiceM8, or whom ServiceM8 doesn't know, gets their
   own entries alone. */

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
  item,
  entry,
  you,
  who,
  today,
  justNow,
  lit,
  onPage,
  onShowThings,
}: {
  /** Its key in the feed, which a door from another face finds it by. */
  item: string;
  entry: DiaryEntry;
  you: string;
  who: Who;
  today: boolean;
  justNow: boolean;
  lit: boolean;
  onPage: ReadonlySet<string>;
  onShowThings: (ids: readonly string[], pointer: boolean) => void;
}) {
  const { doors, lines } = entryUnder(entry, who, onPage);
  return (
    <li className="hd-dy-it" data-item={item} data-entry={entry.id}>
      {/* focusable by script alone: a door from another face lands here */}
      <div className="hd-dy-en" tabIndex={-1} data-lit={lit ? "" : undefined}>
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
  onPage,
  onShowThings,
}: {
  diary: DeskDiary;
  viewerStaffId: string | null;
  /** A door from another face. This face acts on `kind: "entry"` and
      `kind: "conversation"`. */
  focus: DeskArrival | null;
  /** What a door asked for has been shown, and its light has gone. */
  onFocusShown: () => void;
  /** Every task and issue a row on this page holds: where a door can land. */
  onPage: ReadonlySet<string>;
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
     given the focus, and handed back once the light has gone. The face
     scrolls, not this column (the frame's rule: only a face scrolls), so it
     is the face that is moved — measured here, after the commit that showed
     it. Asked for again while it is lit or after, its wash starts over. */
  const asked = focus?.kind === "entry" || focus?.kind === "conversation" ? focus : null;
  /* What it names, as the feed keys it — read afresh from each page the
     diary is given, so a page that comes again while it is lit keeps it. */
  const askedItem = useMemo(() => (asked ? diaryItemOf(feed, asked) : null), [asked, feed]);
  useEffect(() => {
    if (!asked) return;
    const el = [...(root.current?.querySelectorAll<HTMLElement>("[data-item]") ?? [])].find(
      (e) => askedItem !== null && e.dataset.item === askedItem,
    );
    const face = root.current?.closest<HTMLElement>(".hd-face");
    if (el && face) {
      const top = face.scrollTop + el.getBoundingClientRect().top - face.getBoundingClientRect().top - ENTRY_TOP_PX;
      /* no motion for a door pressed from the keyboard (law 8) */
      face.scrollTo?.({ top: Math.max(0, top), behavior: asked.pointer && motionAllowed() ? "smooth" : "auto" });
    }
    const wash = el?.querySelector<HTMLElement>(".hd-dy-en");
    for (const a of wash?.getAnimations?.() ?? []) {
      a.currentTime = 0;
      a.play();
    }
    wash?.focus({ preventScroll: true });
    const t = setTimeout(onFocusShown, DIARY_LIT_MS);
    return () => clearTimeout(t);
  }, [asked, askedItem, onFocusShown]);

  useDiaryRefresh(feed);

  const who: Who = { viewerStaffId, names };
  const item = (i: DiaryItem, today: boolean) =>
    i.kind === "entry" ? (
      <Entry
        key={i.key}
        item={i.key}
        entry={i.entry}
        you={you}
        who={who}
        today={today}
        justNow={justNow.includes(i.entry.id)}
        lit={saved.includes(i.entry.id) || askedItem === i.key}
        onPage={onPage}
        onShowThings={onShowThings}
      />
    ) : (
      <HomeDiaryConversation
        key={i.key}
        item={i.key}
        conversation={i.conversation}
        today={feed.day}
        you={you}
        asked={askedItem === i.key}
      />
    );

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
