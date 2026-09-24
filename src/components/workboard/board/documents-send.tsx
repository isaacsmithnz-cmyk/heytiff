"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { readAddresses } from "@/lib/compliance/papers";
import { andList } from "@/lib/swms/library";
import type { EmailContact, EmailDraft } from "@/app/actions/job-compliance";

/* SENDING WHAT'S TICKED — the job card's footer while the Documents face has
   ticks, and the email that opens IN it.

   THE CARD'S ONE FOOTER (law 28), not a bar floating over the list: it sits
   under the scrolling body, so the list above keeps scrolling and can still be
   ticked while the email is written — the letter's Attaching line follows the
   ticks. Nothing opens over the card.

   SEND TO SERVICEM8 IS THE OTHER DOOR, and it is there only where an owner
   has switched it on (Integrations, ServiceM8). The press waits for its
   files; what came of them is the card's toast and each row's own words,
   and a file that didn't go keeps its tick and says why here, in the space
   the count was in. */

function ContactBox({
  contact,
  on,
  onTick,
}: {
  contact: EmailContact;
  on: boolean;
  onTick: (on: boolean) => void;
}) {
  return (
    <label className="wb2-mailwho">
      <input type="checkbox" checked={on} onChange={(e) => onTick(e.target.checked)} />
      <b>{contact.name ?? contact.email}</b>
      <em>{contact.name ? `${contact.email}, ${contact.role.toLowerCase()}` : contact.role}</em>
    </label>
  );
}

export function DocumentsSend({
  picked,
  writing,
  onWriting,
  onLoadDraft,
  onSend,
  sm8 = null,
  sm8Note = null,
  onSendToSm8,
}: {
  /** What is ticked, by the names the letter will list. */
  picked: readonly { key: string; name: string }[];
  /** The email is open. The card holds it, so unticking the last file while
      writing doesn't throw the letter away with the footer. */
  writing: boolean;
  onWriting: (on: boolean) => void;
  onLoadDraft: () => Promise<EmailDraft | null>;
  /** Resolves null once the email has left, or with the reason it didn't. */
  onSend: (input: { to: string[]; subject: string; message: string }) => Promise<string | null>;
  /** Whether Send to ServiceM8 is offered here, and on which setting. */
  sm8?: "trial" | "live" | null;
  /** Why the last send left files behind; cleared by the next tick. */
  sm8Note?: string | null;
  onSendToSm8?: () => Promise<void>;
}) {
  if (!writing) {
    return (
      <SendBar
        count={picked.length}
        sm8={sm8}
        sm8Note={sm8Note}
        onEmail={() => onWriting(true)}
        onSendToSm8={onSendToSm8}
      />
    );
  }

  return <EmailForm picked={picked} onLoadDraft={onLoadDraft} onSend={onSend} onCancel={() => onWriting(false)} />;
}

function SendBar({
  count,
  sm8,
  sm8Note,
  onEmail,
  onSendToSm8,
}: {
  count: number;
  sm8: "trial" | "live" | null;
  sm8Note: string | null;
  onEmail: () => void;
  onSendToSm8?: () => Promise<void>;
}) {
  const [sending, setSending] = useState(false);
  const sendToSm8 = async () => {
    if (!onSendToSm8 || sending) return;
    setSending(true);
    await onSendToSm8().catch(() => {});
    setSending(false);
  };
  return (
    <div className="wb2-shft wb2-dsend">
      {sm8Note ? (
        <em className="wb2-dsend-n sw-state bad">{sm8Note}</em>
      ) : (
        <em className="wb2-dsend-n">{count === 1 ? "1 document ticked" : `${count} documents ticked`}</em>
      )}
      {sm8 && onSendToSm8 && (
        <button type="button" className="pbtn ghost" disabled={sending} onClick={() => void sendToSm8()}>
          {sending ? "Sending to ServiceM8…" : "Send to ServiceM8"}
        </button>
      )}
      <button type="button" className="pbtn" disabled={sending} onClick={onEmail}>
        <Icon name="mail" size={15} />
        Email documents
      </button>
    </div>
  );
}

function EmailForm({
  picked,
  onLoadDraft,
  onSend,
  onCancel,
}: {
  picked: readonly { key: string; name: string }[];
  onLoadDraft: () => Promise<EmailDraft | null>;
  onSend: (input: { to: string[]; subject: string; message: string }) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [failed, setFailed] = useState(false);
  const [to, setTo] = useState<ReadonlySet<string>>(new Set());
  const [other, setOther] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /* one read per opening, held from mount so the effect is honestly
     empty-dep'd (see compliance-chooser) */
  const loadAtMount = useRef(onLoadDraft);
  useEffect(() => {
    let live = true;
    loadAtMount
      .current()
      .then((d) => {
        if (!live) return;
        if (!d) {
          setFailed(true);
          return;
        }
        setDraft(d);
        setSubject(d.subject);
        setMessage(d.message);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const send = async () => {
    if (busy) return;
    const typed = readAddresses(other);
    if (typed.bad.length > 0) {
      setErr(`${typed.bad[0]} isn't an email address.`);
      return;
    }
    const all = [...to, ...typed.ok.filter((a) => ![...to].some((t) => t.toLowerCase() === a.toLowerCase()))];
    if (all.length === 0) {
      setErr("Say who it's going to.");
      return;
    }
    if (picked.length === 0) {
      setErr("Tick at least one document to send.");
      return;
    }
    setBusy(true);
    setErr(null);
    const why = await onSend({ to: all, subject, message }).catch(() => "The email didn't send. Try again in a minute.");
    setBusy(false);
    /* on success the ticks clear and this footer goes with them */
    if (why) setErr(why);
  };

  const names = picked.map((p) => p.name);

  return (
    <div className="wb2-shft wb2-dsend open">
      <form
        className="wb2-mail"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {failed ? (
          <p className="int-hint">Couldn&apos;t start the email. Close the card and open it again.</p>
        ) : draft === null ? (
          <p className="int-hint">Finding who to send it to…</p>
        ) : (
          <>
            <span className={`wb2-maillbl${draft.contacts.length > 0 ? " people" : ""}`}>To</span>
            <div className="wb2-mailto">
              {draft.contacts.map((c) => (
                <ContactBox
                  key={c.email}
                  contact={c}
                  on={to.has(c.email)}
                  onTick={(on) =>
                    setTo((cur) => {
                      const next = new Set(cur);
                      if (on) next.add(c.email);
                      else next.delete(c.email);
                      return next;
                    })
                  }
                />
              ))}
              <input
                className="wb2-fi"
                value={other}
                onChange={(e) => setOther(e.target.value)}
                placeholder={draft.contacts.length > 0 ? "Someone else's email" : "Their email"}
                aria-label="Email addresses"
                inputMode="email"
              />
            </div>

            <label className="wb2-maillbl" htmlFor="wb2-mail-subject">
              Subject
            </label>
            <input
              id="wb2-mail-subject"
              className="wb2-fi"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />

            <label className="wb2-maillbl" htmlFor="wb2-mail-message">
              Message
            </label>
            <textarea
              id="wb2-mail-message"
              className="wb2-fi"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />

            <span className="wb2-maillbl">Attaching</span>
            <span className="wb2-mailfiles">{names.length > 0 ? andList(names) : "Nothing ticked"}</span>

            {!draft.ready && (
              <p className="wb2-mailnote">Email isn&apos;t set up on this deployment, so nothing can be sent from it.</p>
            )}
          </>
        )}

        {err && <p className="wb2-sherr">{err}</p>}

        <div className="wb2-mailacts">
          <button type="button" className="pbtn ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="pbtn" disabled={busy || !draft || !draft.ready || names.length === 0}>
            <Icon name="send" size={15} />
            {busy ? "Sending email…" : "Send email"}
          </button>
        </div>
      </form>
    </div>
  );
}
