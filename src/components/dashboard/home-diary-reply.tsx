"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { confirmMySm8Link, sendJobNoteToServiceM8, takeBackJobNote } from "@/app/actions/job-note-sm8";
import type { ReplyLine } from "@/lib/dashboard/diary-reply";
import { NOTE_WORDS } from "@/lib/integrations/sm8-note-words";

/* WHERE A REPLY OF YOURS STANDS WITH SERVICEM8 — under it in the new
   Home's diary, wherever it is drawn: in its conversation, or as your entry
   when no conversation holds the note it answers (lib/dashboard/
   diary-reply). The job's diary's own sentence, in the state's colour and
   nowhere else, then the doors the job card offers on it: Send again, or
   Try again on one that failed or is still in ServiceM8; and Yes and Not
   me while "Is <name> you?" waits on you, Yes then sending it.

   A press asks the job card's own actions, for this row, and then the page
   again, which brings the line as it now stands. A refusal is said beside
   the doors; a press whose answer never came says so, to press again. Held,
   not disabled, while it is out: a disabled button drops the keyboard's
   focus to the page. */

/** What a press answers, as far as the line needs. */
type Answer = { ok: true } | { ok: false; error: string };

/** Said when a press's answer never came back. */
export const REPLY_NOT_REACHED = "Couldn't reach ServiceM8.";

export function HomeDiaryReplyLine({ noteId, jobUuid, line }: { noteId: string; jobUuid: string; line: ReplyLine }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  /** A second press before the first one's render is not a second press. */
  const busy = useRef(false);

  const press = async (run: () => Promise<Answer>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setSaid(null);
    let res: Answer | null = null;
    try {
      res = await run();
    } catch {
      /* the answer was lost, not the call: pressed again, the server says
         so if the first one landed */
    }
    busy.current = false;
    setPending(false);
    if (!res) setSaid(REPLY_NOT_REACHED);
    else if (!res.ok) setSaid(res.error);
    router.refresh();
  };

  const send = () => sendJobNoteToServiceM8({ jobUuid, noteId });
  const again = line.again;
  const ask = line.ask;
  return (
    <div className="hd-dy-doors" data-reply-line={noteId}>
      <span className={line.tone ? `hd-dy-note ${line.tone}` : "hd-dy-note"}>{line.text}</span>
      {ask && (
        <>
          <button
            type="button"
            className="hd-dy-door"
            aria-disabled={pending || undefined}
            onClick={() =>
              void press(async () => {
                const answered = await confirmMySm8Link({ remoteId: ask, answer: "yes" });
                return answered.ok ? send() : answered;
              })
            }
          >
            {NOTE_WORDS.door.yes}
          </button>
          <button
            type="button"
            className="hd-dy-door"
            aria-disabled={pending || undefined}
            onClick={() => void press(() => confirmMySm8Link({ remoteId: ask, answer: "no" }))}
          >
            {NOTE_WORDS.door.notMe}
          </button>
        </>
      )}
      {again && (
        <button
          type="button"
          className="hd-dy-door"
          aria-disabled={pending || undefined}
          onClick={() => void press(again.act === "send_again" ? send : () => takeBackJobNote({ jobUuid, noteId }))}
        >
          {again.label}
        </button>
      )}
      <span className="hd-dy-note hd-dy-said" role="status">
        {said}
      </span>
    </div>
  );
}
