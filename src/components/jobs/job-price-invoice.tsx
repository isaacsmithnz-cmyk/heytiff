"use client";

import { useEffect, useState, type ReactNode } from "react";
import { sendInvoiceToSm8, type InvoiceSendAnswer } from "@/app/actions/invoice-sm8";
import { Button } from "@/components/parts/button";
import { StateWord } from "@/components/parts/state";
import { Loading, Wrong } from "@/components/parts/states";
import { Tick } from "@/components/parts/tick";
import { builtFromWords, lineCents, sendable, type InvoiceDraft, type InvoiceLine } from "@/lib/jobs/invoice-draft";
import { fmtQuantity, type JobMaterialLine } from "@/lib/workboard/job-ledger";
import { fmtAud } from "@/lib/workboard/project-money";
import { Sm8Lines, Views, type View } from "./job-price-parts";

/* NEW INVOICE (lib/jobs/invoice-draft.ts; the invoice mock of 3 November
   2026): what the job already knows, worked out as lines to put on the job
   in ServiceM8, each ticked to go. The hours on site at the business's
   charge-out rate, a line a day, and what was said used at the book's cost
   and the business's markup; on a job priced already, only what was used
   beyond its price. Preview is the invoice ServiceM8 will make: the lines on
   the job already, and the ticked ones. Send to ServiceM8, in ServiceM8's
   green (25b), puts the ticked lines on the job and nothing else, only when
   a person presses it; ServiceM8 makes the invoice and sends it. */
export function PriceNewInvoice({
  job,
  jobNumber,
  client,
  onJob,
}: {
  job: string;
  jobNumber: string | null;
  client: string | null;
  /** the job's own lines in ServiceM8 */
  onJob: readonly JobMaterialLine[];
}) {
  const [view, setView] = useState<View>("lines");
  const [read, setRead] = useState<InvoiceDraft | null | undefined>(undefined);
  const [reads, setReads] = useState(0);
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<InvoiceSendAnswer | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => fetch(`/api/workboard/invoice-draft?job=${encodeURIComponent(job)}`))
      .then((r) => r.json() as Promise<{ ok: boolean; draft?: InvoiceDraft }>)
      .then((a) => live && setRead(a.ok && a.draft ? a.draft : null))
      .catch(() => live && setRead(null));
    return () => {
      live = false;
    };
  }, [job, reads]);

  const lines = read && read.ok ? read.lines : [];
  const going = lines.filter((l) => sendable(l) && !off.has(l.key));
  const total = going.reduce((t, l) => t + (lineCents(l) ?? 0), 0);
  const already = onJob.reduce<number | null>((t, l) => (t === null || l.exLineCents == null ? null : t + l.exLineCents), 0);
  const send = async () => {
    setBusy(true);
    setAnswer(null);
    const a = await sendInvoiceToSm8(job, going.map((l) => l.key)).catch((): InvoiceSendAnswer => ({ ok: false, error: "HeyTiff couldn't send that. Nothing went; try again." }));
    setAnswer(a);
    setBusy(false);
    setReads((n) => n + 1);
  };

  let left: ReactNode;
  if (read === undefined) left = <Loading what="Working out the invoice" />;
  else if (read === null)
    left = (
      <Wrong
        word="The invoice wasn't worked out"
        means="The job's hours and what was used couldn’t be read."
        action={
          <Button kind="second" onClick={() => setReads((n) => n + 1)}>
            Read them again
          </Button>
        }
      />
    );
  else if (!read.ok) left = <p className="jpr-none">{read.why}</p>;
  else if (view === "preview")
    left = (
      <article className="jpr-sheet" aria-label="The invoice">
        <h3>{jobNumber ? `Invoice ${jobNumber}` : "Invoice"}</h3>
        {client && <p className="jpr-railline">{client}</p>}
        <ul className="jpr-lines">
          {onJob.map((m) => (
            <li key={m.remoteId}>
              <span className="jpr-line">
                <b>{m.name}</b>
                {m.quantity !== null && <em>{`× ${fmtQuantity(m.quantity)}`}</em>}
              </span>
              <span className="jpr-amt">{m.exLineCents != null ? fmtAud(m.exLineCents) : "—"}</span>
            </li>
          ))}
          {going.map((l) => (
            <li key={l.key}>
              <span className="jpr-line">
                <b>{l.name}</b>
                <em>{l.detail}</em>
              </span>
              <span className="jpr-amt">{fmtAud(lineCents(l) ?? 0)}</span>
            </li>
          ))}
          {already !== null && (
            <li className="jpr-total">
              <span className="jpr-line">
                <b>Total ex GST</b>
              </span>
              <span className="jpr-amt">{fmtAud(already + total)}</span>
            </li>
          )}
        </ul>
        <p className="jpr-railline">ServiceM8 makes the invoice from the job&rsquo;s lines, and sends it.</p>
      </article>
    );
  else
    left = (
      <div className="jpr-groups">
        <section className="jpr-grp" aria-label="To put on the job">
          <h3>To put on the job</h3>
          {lines.length === 0 ? (
            <p className="jpr-none">{read.quoted ? "Nothing was recorded as used beyond the job's price." : "No time on site or anything used is recorded on this job."}</p>
          ) : (
            <ul className="jpr-lines">
              {lines.map((l) => (
                <InvoiceRow
                  key={l.key}
                  line={l}
                  on={sendable(l) && !off.has(l.key)}
                  onTick={(on) =>
                    setOff((was) => {
                      const next = new Set(was);
                      if (on) next.delete(l.key);
                      else next.add(l.key);
                      return next;
                    })
                  }
                />
              ))}
            </ul>
          )}
        </section>
        {onJob.length > 0 && (
          <section className="jpr-grp" aria-label="On the job in ServiceM8">
            <h3>On the job in ServiceM8</h3>
            <Sm8Lines lines={onJob} money none="" />
          </section>
        )}
      </div>
    );

  return (
    <div className="jpr-body">
      <div className="jpr-main">
        {read && read.ok && <Views value={view} onChange={setView} />}
        <div className="jpr-left">{left}</div>
      </div>
      <aside className="jpr-rail" aria-label="New invoice">
        <div className="jpr-railtop">
          <h2 className="jpr-railname">New invoice</h2>
          <p className="jpr-railamt">
            <b className="jpr-railfig">{fmtAud(total)}</b>
            <span className="jb-basis">ex GST, to put on the job</span>
          </p>
          {read && read.ok && <p className="jpr-railline">{builtFromWords(read.from, read.quoted)}</p>}
          {read && read.ok && read.invoiced && (
            <StateWord tone="look">ServiceM8 has sent the job&rsquo;s invoice: send it again from there once these are on</StateWord>
          )}
          {answer && !answer.ok && <p className="jb-err">{answer.error}</p>}
          {answer && answer.ok && <p className="jpr-railline">{answer.said}</p>}
          {answer && answer.ok && answer.failed.map((f, i) => <p className="jb-err" key={i}>{f}</p>)}
        </div>
        <div className="jpr-dock">
          <Button kind="sm8" disabled={busy || going.length === 0} onClick={() => void send()}>
            {busy ? "Sending to ServiceM8" : "Send to ServiceM8"}
          </Button>
        </div>
      </aside>
    </div>
  );
}

function InvoiceRow({ line, on, onTick }: { line: InvoiceLine; on: boolean; onTick: (on: boolean) => void }) {
  const cents = lineCents(line);
  const each = line.unitSellCents !== null ? `${line.qty}${line.unit ? ` ${line.unit}` : ""} at ${fmtAud(line.unitSellCents)}` : null;
  return (
    <li className="jpr-inv">
      {sendable(line) ? (
        <Tick label={<span className="pt-tabs-sr">{`Put ${line.name} on the job`}</span>} checked={on} onChange={onTick} />
      ) : (
        <span className="jpr-tickgap" aria-hidden="true" />
      )}
      <span className="jpr-line">
        <b>{line.name}</b>
        <em>{[line.detail, each].filter(Boolean).join(", ")}</em>
      </span>
      {line.sent ? (
        <StateWord tone="info">On the job in ServiceM8</StateWord>
      ) : cents === null ? (
        <StateWord tone="look">No price in the book</StateWord>
      ) : (
        <span className="jpr-amt">{fmtAud(cents)}</span>
      )}
    </li>
  );
}
