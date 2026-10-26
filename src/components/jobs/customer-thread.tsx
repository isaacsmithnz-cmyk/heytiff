"use client";

import { createContext, useContext, useEffect, useRef, useState, type Ref } from "react";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Fade } from "@/components/parts/fade";
import { Icon } from "@/components/shell/icon";
import { fileTypeWord, linkParts, type CommsThread, type CustomerSend, type CustomerThread, type MessageFile, type ThreadBubble } from "@/lib/jobs/customer-messages";

/* THE CUSTOMER IN THE ACTIVITY FEED (Isaac, 26 October 2026, "Yes build",
   the tidied option B, laid out like a phone). Read only: nothing here
   sends, answers or changes a message.

   SERVICEM8'S OWN SEND is the feed's event row: its grey icon, the bold
   words ("Booking for Wed 14 Oct, 2:00 pm texted"), a grey line, and on
   the right the customer's short answer in bold ("Piero: YES") or when an
   email was seen.

   A CONVERSATION is a thread: a 32 head, its grey icon and "Email with
   Piero", the subject once in grey; then the messages oldest first, the
   customer on the left and the team on the right, at most 80% wide, each
   in a filled bubble like a phone's (Isaac, 26 October 2026: "Deep green
   with white"): the team's deep green with white words, the customer's
   light grey. Back-to-back messages from one speaker are a run, stacked 2
   apart with the inside corners tucked; the name once above it, the time
   (and "Seen" on an email ServiceM8 saw opened) once under its last
   bubble. Anything else in the thread ends the run. ServiceM8's sends in
   the thread's span are grey lines in the middle. A bubble is a button: it
   opens the whole message in a dialog, its words as plain text. */

export function CustomerSendRow({
  send,
  door,
  claim,
}: {
  send: CustomerSend;
  /** the door of the row this send stands in for: "Open quote #3372", a claim's Open */
  door?: { label: string; onOpen: () => void } | null;
  /** the claim this invoice is, by its name, said before the send's own detail */
  claim?: string | null;
}) {
  const detail = [claim, send.detail].filter(Boolean).join(", ") || null;
  const end =
    send.reply || send.seen || door ? (
      <span className="jc-sendend">
        {send.reply ? <b className="jc-sendreply">{send.reply}</b> : send.seen ? <span className="jc-sendseen">{send.seen}</span> : null}
        {/* the row this send stands in for keeps its door, after Seen (26 October 2026) */}
        {door && (
          <Button kind="quiet" size={32} onClick={door.onOpen}>
            {door.label}
          </Button>
        )}
      </span>
    ) : null;
  return (
    <div className="jc-entry jc-event jc-send">
      <div className="jc-evrow">
        <span className="jc-made-icon" aria-hidden="true">
          <Icon name={send.icon} size={16} />
        </span>
        <span className="jc-sendtext">
          <span className="jc-evwords">
            <b className="cv-result-name">{send.words}</b>
            {detail && (
              <>
                {" "}
                <span className="cv-result-line">{detail}</span>
              </>
            )}
          </span>
          {send.opening && <Fade className="jc-sendopen">{send.opening}</Fade>}
        </span>
        {end}
      </div>
      {send.files.length > 0 && <FileRows files={send.files} className="jc-sendfiles" />}
    </div>
  );
}

/** How the page opens one of the job's files by its ServiceM8 uuid: the
    same viewer its Documents and Photos open them in, or null where this
    reader's files don't hold it. The feed is handed it by the job's page. */
export const FileDoor = createContext<(id: string) => (() => void) | null>(() => null);

/* WHAT CAME WITH A MESSAGE (Isaac, 26 October 2026: "It says that there's
   one attachment, but you can't actually click it"): a quiet row each, a
   paperclip, the file's name fading and its type in grey, which opens it
   where the job's Documents and Photos do. One the mirror hasn't brought in
   yet is greyed, says so, and opens nothing. */
export function FileRows({ files, className, onOpened }: { files: readonly MessageFile[]; className?: string; onOpened?: () => void }) {
  const door = useContext(FileDoor);
  return (
    <ul className={["jc-files", className].filter(Boolean).join(" ")} aria-label="Attachments">
      {files.map((f) => {
        const open = f.name ? door(f.id) : null;
        const type = fileTypeWord(f.type);
        const body = (
          <>
            <Icon name="clip" size={14} />
            <Fade className="jc-filename">{f.name ?? "Attachment"}</Fade>
            {f.name ? type && <span className="jc-filetype">{type}</span> : <span className="jc-filetype">Not synced yet</span>}
          </>
        );
        return (
          <li key={f.id}>
            {open ? (
              <button
                type="button"
                className="jc-file"
                onClick={() => {
                  onOpened?.();
                  open();
                }}
              >
                {body}
              </button>
            ) : (
              <span className={`jc-file jc-file--off`} aria-disabled="true">
                {body}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Words with their web addresses as links, in the words' own colour. */
function Linked({ text }: { text: string }) {
  return (
    <>
      {linkParts(text).map((p, i) =>
        p.href ? (
          <a key={i} className="jc-link" href={p.href} target="_blank" rel="noopener noreferrer">
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function CustomerThreadView({ thread }: { thread: CustomerThread }) {
  const [open, setOpen] = useState<ThreadBubble | null>(null);
  return (
    <div className="jc-entry jc-thread">
      <div className="jc-thhead">
        <span className="jc-made-icon" aria-hidden="true">
          <Icon name={thread.icon} size={16} />
        </span>
        <b className="jc-thtitle">{thread.title}</b>
        {thread.subject && <Fade className="jc-thsub">{thread.subject}</Fade>}
      </div>
      <div className="jc-thbody">
        {thread.lines.map((l) =>
          l.kind === "line" ? (
            <p className="jc-thline" key={l.key}>
              <span>{l.words}</span>
              {l.reply && <b>{l.reply}</b>}
            </p>
          ) : (
            <Bubble key={l.key} line={l} onOpen={setOpen} />
          ),
        )}
      </div>
      {open && <MessageDialog bubble={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Lines a bubble shows whole; a longer message shows the first twelve,
    fading, and its dots (Isaac, 26 October 2026: "that whole thing should
    probably show in the thread. Anything longer than that, I would say have
    the dots to show that there is more to open"). */
export const BUBBLE_WHOLE_LINES = 16;

/** One message in a run: the name above the run's first, the bubble with
    its words and their links, what came with it under it, and the run's
    time and Seen under its last. A message too long to show whole has its
    dots, a button inside the bubble that opens the whole of it; the
    bubble itself is not a button, so its links press as links. */
function Bubble({ line: l, onOpen, lastRef }: { line: ThreadBubble; onOpen: (b: ThreadBubble) => void; lastRef?: Ref<HTMLDivElement> }) {
  const words = useRef<HTMLDivElement | null>(null);
  const [long, setLong] = useState(false);
  useEffect(() => {
    const el = words.current;
    if (!el) return;
    const measure = () => {
      const line = parseFloat(getComputedStyle(el).lineHeight) || 22;
      /* the whole of it, clamped or not: scrollHeight is the words' own height */
      setLong(el.scrollHeight > line * BUBBLE_WHOLE_LINES + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [l.words]);
  return (
    <div
      ref={lastRef}
      className={["jc-bm", `jc-bm--${l.side}`, l.name ? "jc-bm--first" : "", l.last ? "jc-bm--last" : ""].filter(Boolean).join(" ")}
    >
      {l.name && <p className="jc-bmname">{l.name}</p>}
      <div className="jc-bubble">
        <div ref={words} className={`jc-bubwords${long ? " jc-bubwords--clamped" : ""}`}>
          <Linked text={l.words} />
        </div>
        {long && (
          <button type="button" className="jc-bubmore" aria-label="Show the whole message" aria-haspopup="dialog" onClick={() => onOpen(l)}>
            •••
          </button>
        )}
      </div>
      {l.files.length > 0 && <FileRows files={l.files} />}
      {l.last && (
        <p className="jc-bmtime">
          <span>{l.time}</span>
          {l.seen && <span>{l.seen}</span>}
        </p>
      )}
    </div>
  );
}

/* COMMS (Isaac, 26 October 2026, "Yes, build the Comms tab as mocked"):
   every text and email with the customer, oldest at the top like a phone,
   ServiceM8's own as messages too. Each thread (one channel, and for email
   one subject) under a hairline, its head a grey icon, "Email" or "Text"
   and the subject fading; the day centred where it changes. Opening it
   lands on the newest: the page's own scroller brings the last bubble into
   view, with no scroller of its own. */
export function CommsView({ threads }: { threads: readonly CommsThread[] }) {
  const [open, setOpen] = useState<ThreadBubble | null>(null);
  const newest = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    newest.current?.scrollIntoView?.({ block: "end" });
  }, []);
  const lastThread = threads.length - 1;
  return (
    <div className="jc-comms">
      {threads.map((t, ti) => (
        <div className="jc-comthread" key={t.key}>
          <div className="jc-comhead">
            <span className="jc-made-icon" aria-hidden="true">
              <Icon name={t.channel === "email" ? "mail" : "message"} size={16} />
            </span>
            <b className="jc-comkind">{t.channel === "email" ? "Email" : "Text"}</b>
            {t.subject && <Fade className="jc-comsub">{t.subject}</Fade>}
          </div>
          <div className="jc-thbody">
            {t.lines.map((l, li) =>
              l.kind === "day" ? (
                <p className="jc-comday" key={l.key}>
                  {l.label}
                </p>
              ) : (
                <Bubble key={l.key} line={l} onOpen={setOpen} lastRef={ti === lastThread && li === t.lines.length - 1 ? newest : undefined} />
              ),
            )}
          </div>
        </div>
      ))}
      {open && <MessageDialog bubble={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** The whole message, read only: subject, from, to, when, and its words as
    plain text. */
function MessageDialog({ bubble, onClose }: { bubble: ThreadBubble; onClose: () => void }) {
  const f = bubble.full;
  return (
    <Dialog
      heading={f.subject ?? (bubble.side === "us" ? "Message to the customer" : "Message from the customer")}
      onClose={onClose}
      width={560}
      foot={
        <Button kind="second" size={36} onClick={onClose} data-autofocus>
          Close
        </Button>
      }
    >
      <dl className="cmsg-facts">
        {f.from && (
          <>
            <dt>From</dt>
            <dd>{f.from}</dd>
          </>
        )}
        {f.to && (
          <>
            <dt>To</dt>
            <dd>{f.to}</dd>
          </>
        )}
        <dt>When</dt>
        <dd>{f.when}</dd>
      </dl>
      <p className="cmsg-words">
        <Linked text={f.text} />
      </p>
      {/* the same files, pressable: the dialog goes, and the file opens where the job's do */}
      {f.files.length > 0 && <FileRows files={f.files} className="cmsg-files" onOpened={onClose} />}
    </Dialog>
  );
}
