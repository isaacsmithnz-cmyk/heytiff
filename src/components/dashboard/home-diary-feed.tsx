"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { deleteDiaryEntry, editDiaryEntry } from "@/app/actions/diary";
import { keepWords, undoNote, type UndoResult } from "@/app/actions/workboard-notes";
import { navHref } from "@/components/shell/nav";
import { TiffBox, type BoxSave } from "@/components/tiff/modal/tiff-box";
import { useTiff, type TiffLanded } from "@/components/tiff/modal/tiff-context";
import { NOT_REACHED } from "@/components/tiff/modal/use-conversation";
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
import { conversationOf, lastTiff, type EarlierTurn } from "@/lib/workboard/note-turns";
import { Confirm } from "./home-confirm";
import { HomeDiaryConversation } from "./home-diary-conversation";
import { HomeDiaryReplyLine } from "./home-diary-reply";
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

   WHAT TIFF MADE OF THEM (H23). An entry that came out of a conversation
   with her says her last word under yours, "Tiff: Done. …", and that line
   is the door back into the conversation: the modal opens on it again,
   what was said already there, waiting on the reply box, so the next thing
   you say is read by it. The words land at the top of Today when the modal
   closes, "just now" and lit, like a Save.

   YOUR ENTRY IS YOURS TO EDIT OR DELETE, and somebody else's conversation
   yours to hide (Isaac, 2026-09-26: "you should only be able to delete
   your own entries or edit. with the option to hide/archive other
   peoples"; actions/diary). Edit and Delete sit at the end of the line
   that says when, shown while the pointer is on the entry or the keyboard
   is in it (law 24). Edit turns the words into a box of the same words —
   Save or Enter keeps them, Cancel or Escape leaves them — and is not
   offered for a note ServiceM8 holds too (`inSm8`), which is changed
   there. Delete asks twice, as Delete task does, since nothing brings it
   back; what the entry made stays. Gone, the keyboard lands on the entry
   under it, or the one above.

   UNDO sits at the end of what an entry made, while it can take it back —
   until someone acts on a row it filed (Isaac's call, 2026-09-25). The
   page's read asks the rule the server refuses on (a task ticked off,
   given on, moved or answered "Got it", a flag cleared, an issue counted
   again, a line bought, the job's notes edited, or everything it made
   deleted since), so Undo is offered only where a press would not be
   refused; one that is anyway (somebody acted in the meantime) says why
   in Undo's place. Taken back — by this press, by one whose answer was
   lost, or by somebody else's at the same moment — the entry keeps your
   words, and Tiff's line says what went. The
   keyboard stays where it was pressed while it is out, and lands on what
   answered: Tiff's line when it worked, the entry when it was refused.

   DOORS STAY ON THIS PAGE WHERE THEIR THING IS. A task or an issue is a
   row, so its door hands its ids to the frame (`onShowThings`), which
   lights them in the list beside this column — or, for one the list does
   not hold (a task ticked off today), opens it on the Tasks tab. One that
   no row on the page holds (`onPage`) is said, not drawn as a door. A
   Library entry and a kept note are screens, so those are links.

     SOMEONE WHO ASKED YOU SOMETHING in a ServiceM8 job note is a
     conversation in the same column, sorted by their newest message, so
     an answer to last week's ask comes up into Today
     (./home-diary-conversation: the job door, the one task the ask made,
     which is a row like any other task door's, and Reply). A reply of
     yours sent from HeyTiff is drawn there, in its thread, not again here
     as an entry — unless no conversation holds the note it answers; then
     it is your entry, saying where it stands with ServiceM8 all the same
     (lib/dashboard/diary-reply).

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

/** An edit or a delete whose answer never came back: pressed again, the
    server says so if the first one landed. */
const DIDNT_GO = "That didn't go through. Try again.";

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
  const tiff = useTiff();
  /* EDIT AND DELETE (above). What an edit kept is drawn at once, and the
     page's own read says the same once it comes round; a delete that went
     in takes the entry off at once. A refusal is said under the words, and
     what was pressed stands as it was. */
  const [mode, setMode] = useState<"read" | "edit" | "delete">("read");
  const [draft, setDraft] = useState("");
  const [kept, setKept] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [changing, setChanging] = useState(false);
  const [changeSaid, setChangeSaid] = useState<string | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLLIElement>(null);
  /** Where focus goes once the words are drawn again: back to the button
      that opened the edit or the question. */
  const backTo = useRef<"edit" | "delete" | null>(null);
  useLayoutEffect(() => {
    if (mode === "edit") {
      const box = editRef.current;
      box?.focus({ preventScroll: true });
      box?.setSelectionRange(box.value.length, box.value.length);
    } else if (mode === "read" && backTo.current) {
      const to = backTo.current === "edit" ? editButton.current : deleteButton.current;
      backTo.current = null;
      to?.focus({ preventScroll: true });
    }
  }, [mode]);
  const words = kept ?? entry.said;
  /* A page that brings the words the edit kept lets go of the edit's copy. */
  if (kept !== null && entry.said === kept) setKept(null);

  const openEdit = () => {
    setDraft(words);
    setChangeSaid(null);
    setMode("edit");
  };
  const closeEdit = () => {
    backTo.current = "edit";
    setChangeSaid(null);
    setMode("read");
  };
  const saveEdit = async () => {
    const next = draft.trim();
    if (changing) return;
    if (next === words.trim()) return closeEdit();
    setChanging(true);
    setChangeSaid(null);
    let res: { ok: true } | { ok: false; error: string };
    try {
      res = await editDiaryEntry(entry.id, next);
    } catch {
      res = { ok: false, error: DIDNT_GO };
    }
    setChanging(false);
    if (!res.ok) return setChangeSaid(res.error);
    setKept(next);
    closeEdit();
  };
  const onEditKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeEdit();
    } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void saveEdit();
    }
  };
  const remove = async () => {
    if (changing) return;
    setChanging(true);
    setChangeSaid(null);
    let res: { ok: true } | { ok: false; error: string };
    try {
      res = await deleteDiaryEntry(entry.id);
    } catch {
      res = { ok: false, error: DIDNT_GO };
    }
    setChanging(false);
    if (!res.ok) return setChangeSaid(res.error);
    /* the keyboard goes to the entry under it, or the one above */
    const li = itemRef.current;
    const next = (li?.nextElementSibling ?? li?.previousElementSibling)?.querySelector<HTMLElement>(".hd-dy-en");
    next?.focus({ preventScroll: true });
    setGone(true);
  };

  /* UNDO, PRESSED HERE. What it took back is held on the entry at once —
     the page's own read says the same once it has come round — and a
     sentence it said stays under the entry: a refusal in Undo's place, for
     good (someone acted on a row, and that will not come right later), or
     an answer that never came back beside it, to press again. */
  const [taken, setTaken] = useState<EarlierTurn[] | null>(null);
  const [undoSaid, setUndoSaid] = useState<{ text: string; again: boolean } | null>(null);
  const [undoing, setUndoing] = useState(false);
  /** A second press before the first one's render is not a second Undo. */
  const busy = useRef(false);
  /* WHERE THE KEYBOARD GOES once Undo has answered, if it was still on Undo
     (or nowhere): the Undo it pressed is gone, or going. Moved after the
     render that draws what answered, so Tiff's line already says what went
     when it takes the focus. */
  const enRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const landOn = useRef<"line" | "entry" | "undo" | null>(null);
  useEffect(() => {
    const to = landOn.current;
    if (!to) return;
    landOn.current = null;
    const el = to === "line" ? lineRef.current : to === "undo" ? undoRef.current : null;
    (el ?? enRef.current)?.focus({ preventScroll: true });
  });

  const shown: DiaryEntry = taken ? { ...entry, turns: taken, undo: false, undone: true } : entry;
  const { doors, lines } = entryUnder(shown, who, onPage);
  const line = lastTiff(shown.turns);
  const canUndo = shown.undo && (undoSaid === null || undoSaid.again);
  const opener = `hd-dy-tiff-${entry.id}`;

  const undo = async () => {
    if (busy.current) return;
    busy.current = true;
    setUndoing(true);
    setUndoSaid(null);
    let res: UndoResult | null = null;
    try {
      res = await undoNote(entry.id);
    } catch {
      /* The answer was lost, not the call: pressed again, the server says
         so if the first one landed. */
    }
    busy.current = false;
    setUndoing(false);
    const at = document.activeElement;
    const held = !at || at === document.body || at === undoRef.current;
    if (!res) {
      if (held) landOn.current = "undo";
      return setUndoSaid({ text: NOT_REACHED, again: true });
    }
    /* Taken back — by this press, by one whose answer was lost, or by
       somebody else's that claimed it first: the server then refuses with
       the conversation as it now stands. */
    if (res.ok || res.turns) {
      if (held) landOn.current = "line";
      return setTaken(conversationOf(res.turns ?? []));
    }
    if (held) landOn.current = "entry";
    setUndoSaid({ text: res.error, again: false });
  };

  if (gone) return null;

  return (
    <li className="hd-dy-it" data-item={item} data-entry={entry.id} ref={itemRef}>
      {/* focusable by script alone: a door from another face lands here */}
      <div className="hd-dy-en" ref={enRef} tabIndex={-1} data-lit={lit ? "" : undefined}>
        <span className="hd-dy-av" aria-hidden="true">
          {you}
        </span>
        <div className="hd-dy-bd">
          <div className="hd-dy-mh">
            <p className="hd-dy-m">
              <b>You</b>, {entryWhen(entry, { today, justNow })}
            </p>
            {mode === "read" && (
              <span className="hd-dy-acts">
                {!entry.inSm8 && (
                  <button type="button" className="hd-dy-act" ref={editButton} onClick={openEdit}>
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  className="hd-dy-act"
                  ref={deleteButton}
                  onClick={() => {
                    setChangeSaid(null);
                    setMode("delete");
                  }}
                >
                  Delete
                </button>
              </span>
            )}
          </div>
          {mode === "edit" ? (
            <div className="hd-dy-edit">
              <textarea
                ref={editRef}
                className="hd-dy-ed"
                aria-label="Your words"
                value={draft}
                rows={Math.min(8, Math.max(2, draft.split("\n").length))}
                readOnly={changing}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onEditKey}
              />
              <div className="hd-dy-edb">
                <button
                  type="button"
                  className="hd-ls-vb hd-tk-go"
                  aria-disabled={changing || !draft.trim() || undefined}
                  onClick={() => (draft.trim() ? void saveEdit() : undefined)}
                >
                  {changing ? "Saving…" : "Save"}
                </button>
                <button type="button" className="hd-ls-vb" onClick={closeEdit}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="hd-dy-p">{words}</p>
          )}
          {mode === "delete" && (
            <Confirm
              question="Delete this entry for good?"
              pending={changing}
              onGo={() => void remove()}
              onKeep={() => {
                backTo.current = "delete";
                setChangeSaid(null);
                setMode("read");
              }}
            />
          )}
          {changeSaid && (
            <p className="hd-dy-note hd-dy-said" role="status">
              {changeSaid}
            </p>
          )}
          {line &&
            /* The door back into the conversation, where this viewer has
               the modal; the same words, and no door, where not. */
            (tiff.enabled ? (
              <button
                ref={lineRef}
                type="button"
                className="hd-dy-tiff opens"
                aria-haspopup="dialog"
                aria-expanded={tiff.openedBy === opener}
                onClick={(e) =>
                  tiff.open({
                    from: e.currentTarget,
                    conversation: shown.turns,
                    room: "diary",
                    id: opener,
                    /* no pointer behind the click: nothing flies (law 8) */
                    keyboard: e.detail === 0,
                  })
                }
              >
                <b>Tiff</b>: {line}
              </button>
            ) : (
              <p className="hd-dy-tiff">
                <b>Tiff</b>: {line}
              </p>
            ))}
          {doors.length + lines.length > 0 || canUndo || undoSaid ? (
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
              {canUndo && (
                /* Held, not disabled, while it is out: a disabled button
                   drops the keyboard's focus to the page. */
                <button
                  ref={undoRef}
                  type="button"
                  className="hd-dy-undo"
                  aria-disabled={undoing || undefined}
                  onClick={() => void undo()}
                >
                  Undo
                </button>
              )}
              {/* Its sentence's place, there from the first render while
                  Undo can speak, so a screen reader hears what is written
                  into it; empty, it takes no room in the row (shell.css). */}
              {(shown.undo || undoSaid) && (
                <span className="hd-dy-note hd-dy-said" role="status">
                  {undoSaid?.text}
                </span>
              )}
            </div>
          ) : null}
          {/* a reply of yours whose note no conversation holds: where it
              stands with ServiceM8, as in a conversation */}
          {entry.reply?.line && (
            <HomeDiaryReplyLine noteId={entry.id} jobUuid={entry.reply.jobUuid} line={entry.reply.line} />
          )}
        </div>
      </div>
    </li>
  );
}

export function HomeDiaryFeed({
  diary,
  showing,
  viewerStaffId,
  focus,
  onFocusShown,
  onPage,
  onShowThings,
}: {
  diary: DeskDiary;
  /** The Diary is the face on screen: a wash starts only where it is seen,
      so a light that came in while another face was up — an entry or a
      conversation's newest message — waits to be seen before its seven
      seconds start. */
  showing: boolean;
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

  /* What landed since the page opened — saved from this box, or filed by
     Tiff when her modal closed: "just now", for good, and lit while the
     wash lasts. Each lighting is counted, and each count has its own clock
     (below), so a second landing neither cuts the first one's short nor
     holds it on, and an entry lit again starts over. */
  const [justNow, setJustNow] = useState<readonly string[]>([]);
  const [lit, setLit] = useState<Readonly<Record<string, number>>>({});
  const light = (ids: readonly string[]) => {
    setJustNow((s) => [...s, ...ids.filter((id) => !s.includes(id))]);
    setLit((s) => {
      const next = { ...s };
      for (const id of ids) next[id] = (s[id] ?? 0) + 1;
      return next;
    });
  };

  const save: BoxSave = async (text) => {
    const res = await keepWords(text, "diary");
    if (!res.ok) return { ok: false, error: res.error };
    light([res.noteId]);
    return { ok: true };
  };

  /* THE MODAL CLOSED ON SOMETHING FILED (it says so for two seconds): its
     notes are entries here, whose words land at the top of Today once the
     page has read them again, which the modal asks for as it closes. They
     are lit from now, and their wash's seven seconds start when that read
     brings them (the clocks, below). Taken from the host as it changes,
     while rendering — the diary lights its own rows; the frame brings the
     Diary in if the Calendar is up (./home-desk). */
  const { landed } = useTiff();
  const [heard, setHeard] = useState<TiffLanded | null>(null);
  if (landed !== heard) {
    setHeard(landed);
    if (landed) light(landed.noteIds);
  }

  /* THE CLOCKS. A lighting's seven seconds start once it is on the page and
     the Diary is up, which is when his wash starts drawing: a modal's notes
     are lit as it closes and reach the page one read later, and one lit
     behind another face waits for this one. One whose count has moved on is
     started again, and one that runs out puts its light out only if
     nothing has lit it since. */
  const onFeed = useMemo(
    () => new Set([...feed.today, ...feed.earlier].flatMap((i) => (i.kind === "entry" ? [i.entry.id] : []))),
    [feed],
  );
  const clocks = useRef(new Map<string, { n: number; t: ReturnType<typeof setTimeout> }>());
  useEffect(() => {
    if (!showing) return;
    for (const [id, n] of Object.entries(lit)) {
      if (!onFeed.has(id)) continue;
      const was = clocks.current.get(id);
      if (was?.n === n) continue;
      if (was) clearTimeout(was.t);
      const t = setTimeout(() => {
        clocks.current.delete(id);
        setLit((s) => {
          if (s[id] !== n) return s;
          const next = { ...s };
          delete next[id];
          return next;
        });
      }, DIARY_LIT_MS);
      clocks.current.set(id, { n, t });
    }
  }, [lit, onFeed, showing]);
  useEffect(() => {
    const pending = clocks.current;
    return () => {
      for (const c of pending.values()) clearTimeout(c.t);
      pending.clear();
    };
  }, []);

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
        lit={lit[i.entry.id] !== undefined || askedItem === i.key}
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
        who={who}
        asked={askedItem === i.key}
        showing={showing}
        onPage={onPage}
        onShowThings={onShowThings}
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
