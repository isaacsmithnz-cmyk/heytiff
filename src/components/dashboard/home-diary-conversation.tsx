"use client";

import { useEffect, useState } from "react";
import {
  conversationHead,
  conversationUnder,
  litMessage,
  messageHead,
} from "@/lib/dashboard/diary-conversation";
import { DIARY_LIT_MS } from "@/lib/dashboard/diary-doors";
import type { DiaryConversation } from "@/lib/dashboard/diary-feed";
import { initialsFrom } from "@/lib/staff/derive";
import { useDeskJobs } from "./home-job-sheet";

/* SOMEONE WHO ASKED YOU SOMETHING IN SERVICEM8 — one conversation in the
   new Home's diary (./home-diary-feed), as his prototype draws it (v12–v17):
   their initials in a grey disc where yours are ink, "Luke Ingold to you"
   and when he asked, his words as he wrote them less the handle, then every
   later message either way threaded under it with its own smaller disc, and
   under the lot its doors (lib/dashboard/diary-conversation decides every
   word).

   THE JOB is a door onto the desk's one card (`useDeskJobs`), the card any
   other door on this Home opens. REPLY goes to the job in ServiceM8, in a
   new tab: the answer is written there, reaches the one who asked, and
   threads back here with the next sync.

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
   focus. */

export function HomeDiaryConversation({
  item,
  conversation: c,
  today,
  you,
  asked,
  showing,
}: {
  /** Its key in the feed, which a door from another face finds it by. */
  item: string;
  conversation: DiaryConversation;
  /** Today on the account's clock: a time alone on today, a date before. */
  today: string;
  /** Your initials, for your own replies. */
  you: string;
  /** A door asked for this conversation: it is lit as a whole. */
  asked: boolean;
  /** The Diary is the face on screen: the light's seconds run only then. */
  showing: boolean;
}) {
  const { openJob } = useDeskJobs();
  const theirs = initialsFrom(c.asker.name);
  const head = conversationHead(c, today);
  const under = conversationUnder(c);
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

  return (
    <li className="hd-dy-it" data-item={item} data-conversation={c.key}>
      {/* focusable by script alone: a door from another face lands here */}
      <div className="hd-dy-en" tabIndex={-1} data-lit={asked || lit?.head ? "" : undefined}>
        <span className="hd-dy-av" data-who="them" aria-hidden="true">
          {theirs}
        </span>
        <div className="hd-dy-bd">
          <p className="hd-dy-m">
            <b>{head.who}</b>
            {head.rest}
          </p>
          {ask?.text ? <p className="hd-dy-p">{ask.text}</p> : null}
          {thread.length > 0 && (
            <ol className="hd-dy-thread">
              {thread.map((m) => {
                const said = messageHead(m, c, today);
                return (
                  <li
                    key={m.id}
                    className="hd-dy-tr"
                    data-lit={lit && !lit.head && lit.id === m.id ? "" : undefined}
                  >
                    <span
                      className="hd-dy-av"
                      data-who={m.from === "them" ? "them" : undefined}
                      aria-hidden="true"
                    >
                      {m.from === "them" ? theirs : you}
                    </span>
                    <div className="hd-dy-bd">
                      <p className="hd-dy-m">
                        <b>{said.who}</b>
                        {said.rest}
                      </p>
                      {m.text ? <p className="hd-dy-p">{m.text}</p> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="hd-dy-doors">
            {job && (
              <button type="button" className="hd-dy-door" onClick={(e) => openJob(job.uuid, { from: e.currentTarget })}>
                {job.label}
              </button>
            )}
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
