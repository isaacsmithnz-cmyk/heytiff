"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { deleteDiaryEntry, hideConversation, showConversation, type DiaryResult } from "@/app/actions/diary";
import {
  conversationHead,
  conversationUnder,
  litMessage,
  messageHead,
  type TaskWho,
} from "@/lib/dashboard/diary-conversation";
import { DIARY_LIT_MS } from "@/lib/dashboard/diary-doors";
import type { DiaryConversation, DiaryMessage } from "@/lib/dashboard/diary-feed";
import { initialsFrom } from "@/lib/staff/derive";
import { Confirm } from "./home-confirm";
import { HomeDiaryReplyLine } from "./home-diary-reply";
import { useDeskJobs } from "./home-job-sheet";

/* SOMEONE WHO ASKED YOU SOMETHING IN SERVICEM8 — one conversation in the
   new Home's diary (./home-diary-feed), as his prototype draws it (v12–v17):
   their initials in a grey disc where yours are ink, "Luke Ingold to you"
   and when he asked, his words as he wrote them less the handle, then every
   later message either way threaded under it with its own smaller disc, and
   under the lot its doors (lib/dashboard/diary-conversation decides every
   word).

   THE JOB is a door onto the desk's one card (`useDeskJobs`), the card any
   other door on this Home opens. THE TASK the ask made ("1 task for you",
   H18) is a row on this page, so its door hands the ids to the frame
   (`onShowThings`), which lights them in the list beside the diary or
   opens them on the Tasks tab, as a task door under an entry does. REPLY
   goes to the job in ServiceM8, in a new tab: the answer is written there,
   reaches the one who asked, and threads back here with the next sync. A
   reply you sent from HeyTiff (a job card's Reply, or a task's Done) is in
   the thread from the moment it was saved, and says under it where it
   stands with ServiceM8 (./home-diary-reply).

   THAT REPLY IS YOURS TO DELETE, as your entry is (./home-diary-feed;
   Isaac, 2026-09-26: "you should only be able to delete your own entries
   or edit"): Delete at the end of its line, there while the conversation
   has the pointer or the keyboard (law 24), asks twice and takes it back
   by the job card's rule (actions/diary's deleteDiaryEntry). Never Edit:
   ServiceM8 has its words too, and they are changed there. One already
   taken back has only its line's Try again. Gone, it leaves the thread at
   once and the keyboard lands on the conversation; one the page then reads
   back as still in ServiceM8 is drawn again, saying so. Nothing of his is
   yours to change.

   HIS NEWEST MESSAGE, while it is today's and you haven't answered it,
   stands on the diary's wash — the whole conversation when it is the ask
   itself — for the wash's seven seconds of being seen, then goes out, as
   an entry you saved does. The seconds run only while the Diary is the
   face on screen: his reply can come in with the page while Tasks or the
   Calendar is up, and a face hidden under another starts its wash again
   when it comes back (a hidden face draws nothing), so the light waits
   for it and then has its whole seven seconds, fade and all. A new
   message from him is a new light. A door from another face (a task the
   ask made) lights the
   whole conversation the same way; the diary brings it up and gives it the
   focus.

   HIDE is the one thing you may do to somebody else's conversation (Isaac,
   2026-09-26: "the option to hide/archive other peoples"): it goes out of
   your diary until they write again (actions/diary, lib/dashboard/
   diary-hidden). It sits at the end of the line that says who and when,
   shown while the pointer is on it or the keyboard is in it (law 24). The
   conversation folds to one line that says so, with Undo, until the page
   next comes round and leaves it out; nothing in ServiceM8 changes, and
   the task the ask made stays where it is. Your replies in it go with it,
   and come back with it (lib/dashboard/diary-hidden). */

/** A press whose answer never came back: pressed again, it is said again. */
const DIDNT_GO = "That didn't go through. Try again.";

export function HomeDiaryConversation({
  item,
  conversation: c,
  today,
  you,
  who,
  asked,
  showing,
  onPage,
  onShowThings,
}: {
  /** Its key in the feed, which a door from another face finds it by. */
  item: string;
  conversation: DiaryConversation;
  /** Today on the account's clock: a time alone on today, a date before. */
  today: string;
  /** Your initials, for your own replies. */
  you: string;
  /** Whose tasks need no name, and what to call everyone else: a task his
      ask made that was given to Leo since is "1 task for Leo". */
  who: TaskWho;
  /** A door asked for this conversation: it is lit as a whole. */
  asked: boolean;
  /** The Diary is the face on screen: the light's seconds run only then. */
  showing: boolean;
  /** Every task a row on this page holds: where the task door can land. */
  onPage: ReadonlySet<string>;
  /** The task door: the frame shows those rows. */
  onShowThings: (ids: readonly string[], pointer: boolean) => void;
}) {
  const { openJob } = useDeskJobs();
  const theirs = initialsFrom(c.asker.name);
  const head = conversationHead(c, today);
  const under = conversationUnder(c, who, onPage);
  const job = under.job;
  const [ask, ...thread] = c.messages;

  /* The light has its own clock, which runs while the Diary is on screen;
     a newer message from him starts it again, and so does the face coming
     back before it was spent, as its wash does. */
  const fresh = litMessage(c);
  const freshKey = fresh ? (fresh.head ? `head:${c.askNoteUuid}` : fresh.id) : null;
  const [spent, setSpent] = useState<string | null>(null);
  useEffect(() => {
    if (freshKey === null || !showing) return;
    const t = setTimeout(() => setSpent(freshKey), DIARY_LIT_MS);
    return () => clearTimeout(t);
  }, [freshKey, showing]);
  const lit = fresh !== null && freshKey !== spent ? fresh : null;

  /* HIDE (above): drawn hidden at once, and put back, with the action's
     words, if it is refused. The keyboard follows the one button there is:
     Undo once hidden, Hide once back. */
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const hideButton = useRef<HTMLButtonElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const follow = useRef(false);
  useLayoutEffect(() => {
    if (!follow.current) return;
    follow.current = false;
    (hidden ? undoButton.current : hideButton.current)?.focus({ preventScroll: true });
  }, [hidden]);
  const toggle = async (hide: boolean) => {
    if (busy) return;
    setBusy(true);
    setSaid(null);
    follow.current = true;
    setHidden(hide);
    /* chosen before the try: the React Compiler skips a component with a
       conditional inside one, silently */
    const press = hide ? hideConversation : showConversation;
    let res: DiaryResult;
    try {
      res = await press(c.key);
    } catch {
      res = { ok: false, error: DIDNT_GO };
    }
    setBusy(false);
    if (res.ok) return;
    follow.current = true;
    setHidden(!hide);
    setSaid(res.error);
  };

  if (hidden) {
    return (
      <li className="hd-dy-it" data-item={item} data-conversation={c.key}>
        <p className="hd-dy-hid">
          <span role="status">Hidden until {c.asker.first} writes again.</span>
          <button
            type="button"
            className="hd-dy-undo"
            ref={undoButton}
            aria-disabled={busy || undefined}
            onClick={() => void toggle(false)}
          >
            Undo
          </button>
        </p>
      </li>
    );
  }

  return (
    <li className="hd-dy-it" data-item={item} data-conversation={c.key}>
      {/* focusable by script alone: a door from another face lands here */}
      <div className="hd-dy-en" tabIndex={-1} data-lit={asked || lit?.head ? "" : undefined}>
        <span className="hd-dy-av" data-who="them" aria-hidden="true">
          {theirs}
        </span>
        <div className="hd-dy-bd">
          <div className="hd-dy-mh">
            <p className="hd-dy-m">
              <b>{head.who}</b>
              {head.rest}
            </p>
            <span className="hd-dy-acts">
              <button
                type="button"
                className="hd-dy-act"
                ref={hideButton}
                aria-disabled={busy || undefined}
                onClick={() => void toggle(true)}
              >
                Hide
              </button>
            </span>
          </div>
          {said && (
            <p className="hd-dy-note hd-dy-said" role="status">
              {said}
            </p>
          )}
          {ask?.text ? <p className="hd-dy-p">{ask.text}</p> : null}
          {thread.length > 0 && (
            <ol className="hd-dy-thread">
              {thread.map((m) => (
                <ThreadMessage
                  key={m.id}
                  m={m}
                  c={c}
                  today={today}
                  disc={m.from === "them" ? theirs : you}
                  lit={!!lit && !lit.head && lit.id === m.id}
                />
              ))}
            </ol>
          )}
          <div className="hd-dy-doors">
            {job && (
              <button type="button" className="hd-dy-door" onClick={(e) => openJob(job.uuid, { from: e.currentTarget })}>
                {job.label}
              </button>
            )}
            {under.tasks.map((door) => (
              /* a click with no pointer behind it came from the keyboard,
                 and the frame moves nothing for a keyboard press (law 8) */
              <button
                key={door.ids[0]}
                type="button"
                className="hd-dy-door"
                onClick={(e) => onShowThings(door.ids, e.detail > 0)}
              >
                {door.text}
              </button>
            ))}
            {under.reply && (
              <a className="hd-dy-door" href={under.reply} target="_blank" rel="noopener noreferrer">
                Reply
              </a>
            )}
            {under.lines.map((l, i) => (
              <span key={i} className="hd-dy-note">
                {l}
              </span>
            ))}
          </div>
        </div>
      </div>
    </li>
  );
}

/* ONE MESSAGE UNDER THE ASK: its disc, who and when, the words, and — for
   a reply of yours from HeyTiff — where it stands with ServiceM8 and its
   Delete (YOUR REPLY IS YOURS TO DELETE, above). */
function ThreadMessage({
  m,
  c,
  today,
  disc,
  lit,
}: {
  m: DiaryMessage;
  c: DiaryConversation;
  today: string;
  /** The initials in its disc: his, or yours. */
  disc: string;
  lit: boolean;
}) {
  const said = messageHead(m, c, today);
  const ours = m.ours;
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const row = useRef<HTMLLIElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  /** A second press before the first one's render is not a second delete. */
  const busy = useRef(false);
  /** Keep puts the keyboard back on Delete, once Delete is drawn again. */
  const backToDelete = useRef(false);
  useLayoutEffect(() => {
    if (asking || !backToDelete.current) return;
    backToDelete.current = false;
    deleteButton.current?.focus({ preventScroll: true });
  }, [asking]);

  const remove = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setRefused(null);
    let res: DiaryResult;
    try {
      res = await deleteDiaryEntry(m.id);
    } catch {
      res = { ok: false, error: DIDNT_GO };
    }
    busy.current = false;
    setPending(false);
    if (!res.ok) return setRefused(res.error);
    /* the keyboard goes to the conversation it was in */
    row.current?.closest<HTMLElement>(".hd-dy-en")?.focus({ preventScroll: true });
    setAsking(false);
    setGone(true);
  };

  /* taken back since: drawn as the page says, with its Try again alone */
  if (gone && !ours?.takenBack) return null;
  const deletable = !!ours && !ours.takenBack;
  const head = (
    <p className="hd-dy-m">
      <b>{said.who}</b>
      {said.rest}
    </p>
  );
  return (
    <li ref={row} className="hd-dy-tr" data-lit={lit ? "" : undefined}>
      <span className="hd-dy-av" data-who={m.from === "them" ? "them" : undefined} aria-hidden="true">
        {disc}
      </span>
      <div className="hd-dy-bd">
        {deletable ? (
          <div className="hd-dy-mh">
            {head}
            {!asking && (
              <span className="hd-dy-acts">
                <button
                  type="button"
                  className="hd-dy-act"
                  ref={deleteButton}
                  onClick={() => {
                    setRefused(null);
                    setAsking(true);
                  }}
                >
                  Delete
                </button>
              </span>
            )}
          </div>
        ) : (
          head
        )}
        {m.text ? <p className="hd-dy-p">{m.text}</p> : null}
        {asking && (
          <Confirm
            question="Delete this reply for good?"
            pending={pending}
            onGo={() => void remove()}
            onKeep={() => {
              backToDelete.current = true;
              setRefused(null);
              setAsking(false);
            }}
          />
        )}
        {refused && (
          <p className="hd-dy-note hd-dy-said" role="status">
            {refused}
          </p>
        )}
        {ours?.line && <HomeDiaryReplyLine noteId={m.id} jobUuid={ours.jobUuid} line={ours.line} />}
      </div>
    </li>
  );
}
