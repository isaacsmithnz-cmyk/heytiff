"use client";

import { useState } from "react";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Fade } from "@/components/parts/fade";
import { Icon } from "@/components/shell/icon";
import type { CustomerSend, CustomerThread, ThreadBubble } from "@/lib/jobs/customer-messages";

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
   in a bubble with a hairline edge and no fill, its corner tucked on the
   speaker's side. A name shows where the speaker changes; the time, and
   "Seen" on an email ServiceM8 saw opened, under each. ServiceM8's sends in
   the thread's span are grey lines in the middle. A bubble is a button: it
   opens the whole message in a dialog, its words as plain text. */

export function CustomerSendRow({ send }: { send: CustomerSend }) {
  return (
    <div className="jc-entry jc-event jc-send">
      <div className="jc-evrow">
        <span className="jc-made-icon" aria-hidden="true">
          <Icon name={send.icon} size={16} />
        </span>
        <span className="jc-evwords">
          <b className="cv-result-name">{send.words}</b>
          {send.detail && (
            <>
              {" "}
              <span className="cv-result-line">{send.detail}</span>
            </>
          )}
          {send.attachments > 0 && <Clip count={send.attachments} />}
        </span>
        {send.opening && <Fade className="jc-sendopen">{send.opening}</Fade>}
        {send.reply ? <b className="jc-sendreply">{send.reply}</b> : send.seen ? <span className="jc-sendseen">{send.seen}</span> : null}
      </div>
    </div>
  );
}

function Clip({ count }: { count: number }) {
  return (
    <span className="jc-clip" aria-label={count === 1 ? "1 attachment" : `${count} attachments`} role="img">
      <Icon name="clip" size={14} />
      <span aria-hidden="true">{count}</span>
    </span>
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
            <div className={`jc-bm jc-bm--${l.side}`} key={l.key}>
              {l.name && <p className="jc-bmname">{l.name}</p>}
              <button type="button" className="jc-bubble" aria-haspopup="dialog" onClick={() => setOpen(l)}>
                <Fade lines={3} className="jc-bubwords">
                  {l.words}
                </Fade>
              </button>
              <p className="jc-bmtime">
                <span>{l.time}</span>
                {l.seen && <span>{l.seen}</span>}
                {l.attachments > 0 && <Clip count={l.attachments} />}
              </p>
            </div>
          ),
        )}
      </div>
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
      <p className="cmsg-words">{f.text}</p>
    </Dialog>
  );
}
