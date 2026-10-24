"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Field, TextArea, TextInput } from "@/components/parts/field";
import { Loading, Wrong } from "@/components/parts/states";
import { Tick } from "@/components/parts/tick";
import { readAddresses } from "@/lib/compliance/papers";
import { andList } from "@/lib/swms/library";
import type { EmailContact, EmailDraft } from "@/app/actions/job-compliance";

/* SENDING WHAT'S TICKED (the mock of 25 October 2026, frames 6 and 8).

   THE BAR floats at the page's foot while the Documents section has ticks:
   how many, then Send to ServiceM8 and Email documents, both second
   buttons, because the section's Add is its one blue. It floats, white with
   the one shadow, so the list above keeps scrolling under it and can still
   be ticked.

   SEND TO SERVICEM8 is there only where an owner has switched it on
   (Integrations, ServiceM8). The press waits for its files; what came of
   them is a toast and each row's own word, and a file that didn't go keeps
   its tick and says why here, in the space the count was in.

   EMAIL DOCUMENTS opens the v2 dialog: who it goes to (the job's people as
   tick rows, and anyone else's address), the subject, the message at the
   reading size (rule 13), and what it attaches. The letter's Attaching line
   follows the ticks as they stand. */

function ContactTick({
  contact,
  on,
  onTick,
}: {
  contact: EmailContact;
  on: boolean;
  onTick: (on: boolean) => void;
}) {
  return (
    <li className="pt-row wb2-mailwho">
      <Tick
        checked={on}
        onChange={onTick}
        label={
          <span className="wb2-cpname">
            <b>{contact.name ?? contact.email}</b>
            <span>{contact.name ? `${contact.email}, ${contact.role.toLowerCase()}` : contact.role}</span>
          </span>
        }
      />
    </li>
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
  /** The email is open. The page holds it, so unticking the last file while
      writing doesn't throw the letter away with the bar. */
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
  return (
    <>
      {picked.length > 0 && (
        <SendBar
          count={picked.length}
          sm8={sm8}
          sm8Note={sm8Note}
          onEmail={() => onWriting(true)}
          onSendToSm8={onSendToSm8}
        />
      )}
      {writing && (
        <EmailDialog picked={picked} onLoadDraft={onLoadDraft} onSend={onSend} onCancel={() => onWriting(false)} />
      )}
    </>
  );
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
    <div className="wb2-dsend" role="group" aria-label="Send what's ticked">
      {sm8Note ? (
        <span className="wb2-dsend-n bad">{sm8Note}</span>
      ) : (
        <span className="wb2-dsend-n">{count === 1 ? "1 document ticked" : `${count} documents ticked`}</span>
      )}
      {sm8 && onSendToSm8 && (
        <Button disabled={sending} aria-busy={sending || undefined} onClick={() => void sendToSm8()}>
          {sending ? "Sending to ServiceM8" : "Send to ServiceM8"}
        </Button>
      )}
      <Button disabled={sending} onClick={onEmail}>
        Email documents
      </Button>
    </div>
  );
}

function EmailDialog({
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
  const formId = useId();
  const toId = useId();

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
    /* on success the ticks clear and the dialog goes with them */
    if (why) setErr(why);
  };

  const names = picked.map((p) => p.name);

  return (
    <Dialog
      heading="Email documents"
      width={560}
      onClose={onCancel}
      /* a letter half written is not lost to a stray press on the page */
      dismissable={false}
      foot={
        <>
          <Button disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            kind="main"
            type="submit"
            form={formId}
            disabled={busy || !draft || !draft.ready || names.length === 0}
            aria-busy={busy || undefined}
          >
            {busy ? "Sending the email" : "Send email"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="wb2-mail"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {failed ? (
          <Wrong word="Couldn't start the email" means="Close this and open it again." />
        ) : draft === null ? (
          <Loading what="Finding who to send it to" />
        ) : (
          <>
            <div className="wb2-mailto" role="group" aria-labelledby={toId}>
              <span id={toId} className="pt-field-label">
                To
              </span>
              {draft.contacts.length > 0 && (
                <ul className="pt-rows">
                  {draft.contacts.map((c) => (
                    <ContactTick
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
                </ul>
              )}
              <TextInput
                value={other}
                onChange={(e) => setOther(e.target.value)}
                placeholder={draft.contacts.length > 0 ? "Someone else's email" : "Their email"}
                aria-label="Email addresses"
                inputMode="email"
              />
            </div>

            <Field label="Subject">
              <TextInput value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>

            <Field label="Message">
              <TextArea className="wb2-mailmsg" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
            </Field>

            <p className="wb2-mailfiles">{names.length > 0 ? `Attaching ${andList(names)}` : "Nothing ticked to attach"}</p>

            {!draft.ready && <p className="wb2-mailnote">Email isn&apos;t set up on this deployment, so nothing can be sent from it.</p>}
          </>
        )}

        {err && <p className="wb2-mailerr">{err}</p>}
      </form>
    </Dialog>
  );
}
