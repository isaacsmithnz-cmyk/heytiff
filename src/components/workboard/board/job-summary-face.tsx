"use client";

import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { JobSummaryRead } from "@/lib/workboard/job-summary";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import type { AllJobRow } from "@/lib/workboard/all-jobs";
import { telHref } from "./job-sheet";

/* THE SUMMARY FACE — the landing tab, three sections in reading order.

   SCOPE FIRST, in the office's own words, verbatim. The generated paragraph
   replaced two sections but not their sources: a summary must never be the
   only copy of what the customer was promised, and the "Scope ›" chip that
   briefly hid this died in the same round that promoted it back up here.

   "WHERE IT'S UP TO" WEARS ITS STAMP — "Updated Sat 22 Aug · the final
   payment": the newest story event the paragraph was written at, and what
   that event was. The reader knows exactly how current the words are
   without being told how they were made. No badge, no sparkle — the label
   names the data, and the guard test bans the other word on the surface.

   CONTACTS LAST — the Contacts tab dissolved in here, because "who do I
   ring" is part of the one glance this face answers. Both numbers, tel:
   where the field is one number, and the client's PO beside them. */

export function JobSummaryFace({
  loading,
  detail,
  row,
  summary,
  pending,
}: {
  loading: boolean;
  detail: MirrorJobDetail | null;
  row: AllJobRow;
  summary: JobSummaryRead | null;
  /** The record read (or the first derive) is still out — hold the slot. */
  pending: boolean;
}) {
  return (
    <>
      <div className="wb2-jcsec">
        <div className="wb2-jcdhead">
          <b>Scope</b>
        </div>
        {loading && !detail ? (
          <p className="int-hint">Reading it from the mirror…</p>
        ) : (
          /* trimmed because the office's own words arrive with trailing
             blank lines, and pre-wrap would render them as a hole */
          <p className="wb2-shtext wb2-jcread">
            {(detail?.description ?? row.title)?.trim() || "Nothing written on the job."}
          </p>
        )}
      </div>

      {/* THE SLOT NEVER JUMPS: until the record read (or the first derive)
          answers, the same tinted box stands in the summary's place wearing
          the route skeleton's sweep — shapes only. It resolves to the words
          or to nothing; it never pops content in below the fold. */}
      {!summary && pending && (
        <div className="wb2-jcsec ups" aria-hidden="true">
          <span className="wb2-jcskel t" />
          <span className="wb2-jcskel l" />
          <span className="wb2-jcskel p" />
          <span className="wb2-jcskel p short" />
        </div>
      )}

      {summary && (
        <div className="wb2-jcsec ups">
          <div className="wb2-jcdhead">
            <b>Where it&rsquo;s up to</b>
            {summary.eventOn && (
              <em>
                {`Updated ${fmtAuWeekdayDayMonth(summary.eventOn)}`}
                {summary.eventLabel ? ` · ${summary.eventLabel}` : ""}
              </em>
            )}
          </div>
          {/* STRUCTURED, NOT A PARAGRAPH (Isaac): the lead is the state at
              a glance; each point is one fact on its own line, scannable
              past. NO MONEY in here, ever — the Money face says collection
              once, and the writer never even sees the money events. */}
          <p className="wb2-jcups-lead">{summary.lead}</p>
          {summary.points.length > 0 && (
            <ul className="wb2-jcups-pts">
              {summary.points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* AFTER the summary, not between the scope and it: the walked order
          put this page of verbatim office prose second, which buried the one
          paragraph the face exists for below the fold and said the same
          things twice on one screen. The record stays; the reading order is
          scope → where it's up to → the long form. */}
      {detail?.workDone && (
        <div className="wb2-jcsec">
          <div className="wb2-jcdhead">
            <b>What was done</b>
          </div>
          <p className="wb2-shtext wb2-jcread">{detail.workDone.trim()}</p>
        </div>
      )}

      {detail && detail.contacts.length > 0 && (
        <div className="wb2-jcsec">
          <div className="wb2-jcdhead">
            <b>Contacts</b>
          </div>
          {detail.contacts.map((c, i) => (
            <div className="wb2-crow" key={`${c.name}-${i}`}>
              <span className="wb2-cav" aria-hidden>
                {initialsOf(c.name)}
              </span>
              <span className="wb2-cwho">
                <b>{c.name || "Unnamed"}</b>
                {c.type && <em>{c.type.toLowerCase()}</em>}
              </span>
              <span className="wb2-ccalls">
                <ContactPill value={c.phone} />
                <ContactPill value={c.altPhone} />
                {c.email && (
                  <a className="wb2-ccall" href={`mailto:${c.email}`}>
                    Email
                  </a>
                )}
              </span>
            </div>
          ))}
          {detail.purchaseOrder && (
            <p className="wb2-jcpo">
              <span className="wb2-sect">Their PO</span>
              <b>{detail.purchaseOrder}</b>
            </p>
          )}
        </div>
      )}
    </>
  );
}

/** A phone number as a pill — dialable when the field is one number, plain
    text when ServiceM8's free-text field is saying more than that. */
function ContactPill({ value }: { value: string | null }) {
  if (!value) return null;
  const href = telHref(value);
  return href ? (
    <a className="wb2-ccall" href={href}>
      {value}
    </a>
  ) : (
    <span className="wb2-ccall plain">{value}</span>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase() || "•";
}
