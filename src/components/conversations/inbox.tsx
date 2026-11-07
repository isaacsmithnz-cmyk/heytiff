"use client";

import { useState } from "react";
import { Empty } from "@/components/parts/states";
import { TiffGlyph } from "@/components/notes/tiff-mark";
import { EmailJobActions, EmailJobFacts, type EmailJob } from "@/components/tiff/email-job-card";
import { emailWords, fromOf, inboxHeadLine, type InboxEmail } from "@/lib/email/inbox";
import type { EmailJobView } from "@/lib/email/made-server";
import { threadTitleOf, tiffSays } from "@/lib/email/proposal";
import { EMAIL_THREAD } from "@/lib/tiff/conversations";
import type { TiffThread } from "@/lib/tiff/threads";

/* AN OPEN EMAIL (the mock he said "Build it" to, 30 October 2026). The
   decision stays at the top while the rest scrolls: its subject, whose it
   was and who forwarded it, then Create job or Add to job N. Under that, what
   Tiff read, the card she'd act on, and the builder's own email. */

const whoOf = (view: EmailJobView, row: InboxEmail | null) => ({
  by: row?.by ?? null,
  mine: row?.mine ?? false,
  at: Date.parse(view.receivedAt) || 0,
});

/** The email as a thread, for someone who didn't forward it: asking Tiff about
    it needs what she has already read and said. Her forwarder's own thread is
    the same two turns (proposal-server). */
export function seedOf(view: EmailJobView): TiffThread {
  const at = Date.parse(view.receivedAt) || 0;
  const mine = [view.subject ?? "", "", view.body ?? ""].join("\n").trim();
  return {
    id: `${EMAIL_THREAD}${view.id}`,
    title: threadTitleOf(view.subject, view.proposal),
    updatedAt: at,
    messages: [
      { role: "user", text: mine.slice(0, 60_000), at },
      { role: "tiff", text: tiffSays(view.proposal, view.state === "failed" ? view.why : null), at, email: view.id },
    ],
  };
}

export function InboxHead({ job, row, now }: { job: EmailJob; row: InboxEmail | null; now: number }) {
  const { view } = job;
  if (!view) return null;
  return (
    <header className="cv-item-head">
      <h2 className="cv-item-subject">{threadTitleOf(view.subject, view.proposal)}</h2>
      <p className="cv-item-from">{inboxHeadLine(whoOf(view, row), view.proposal, now)}</p>
      <EmailJobActions job={job} />
    </header>
  );
}

export function InboxRead({ job }: { job: EmailJob }) {
  const { view, missing } = job;
  /* one email's More doesn't open the next */
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (missing) return <Empty what="This email isn't here" line="It may have been sent to another business's Tiff." action={null} />;
  if (!view) return null;
  const said = tiffSays(view.proposal, view.state === "failed" ? view.why : null);
  const { words, sent } = emailWords(view.body);
  const open = openFor === view.id;
  const long = words.split("\n").length > 12 || words.length > 900;
  return (
    <>
      <article className="jc-tiffturn">
        <p className="jc-tiffname">
          <TiffGlyph size={18} alive working={view.state === "received"} />
          <b>Tiff</b>
        </p>
        {view.state === "received" ? (
          <p className="cv-now" role="status">
            Reading the email
          </p>
        ) : (
          said && (
            <div className="cv-text">
              <p>{said}</p>
            </div>
          )
        )}
        <EmailJobFacts job={job} />
      </article>
      {words && (
        <div className="jc-talk">
          <article className="jc-bm jc-bm--them jc-bm--first jc-bm--last">
            <p className="jc-bmname">{fromOf(view.proposal) ?? "The email"}</p>
            <div className="jc-bubble">
              <span className={`jc-bubwords${long && !open ? " jc-bubwords--clamped" : ""}`}>{words}</span>
              {long && (
                <button type="button" className="jc-bubmore" aria-expanded={open} onClick={() => setOpenFor(open ? null : view.id)}>
                  {open ? "Less" : "More"}
                </button>
              )}
            </div>
            {sent && <p className="jc-bmtime">{sent}</p>}
          </article>
        </div>
      )}
    </>
  );
}
