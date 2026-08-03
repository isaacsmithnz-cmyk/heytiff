"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { BOARD_DONE_DAYS, completionTiming, daysBetween } from "@/lib/workboard/board-status";
import { setVisitInvoiced } from "@/app/actions/workboard-maintenance";
import type { BoardVisit } from "@/lib/workboard/board-query";
import { hoursLabel } from "./derive";

/* Completed — the review pass whose whole job is invoicing (L3). Hours are
   ACTUALS from the close-out, never the booking estimate wearing an
   "on site" label; when both exist the variance is said out loud. "Done on
   time" is earned from the dates (B12). The screen folds To-invoice first —
   that's the money waiting — and every Mark-invoiced carries its own undo
   (G9's ambiguous per-row Undo is dead; toasts are per-action now). */

/* Where a close-out note came from. A note with no name against it is a note
   nobody can follow up, so the line always says something — but it only
   NAMES someone when exactly one person was on the visit. Two techs and we
   don't know which of them wrote it, and guessing puts words in a real
   person's mouth. */
function noteSource(v: BoardVisit): string {
  if (v.completedSource === "servicem8") return "from the ServiceM8 job";
  const who = v.techs.length === 1 ? v.techs[0].name : null;
  return `${who ?? "the technician"}, on the job sheet`;
}

/** "yesterday" / "6 days ago" — how stale this is, said the way the design
    says it. Beyond a fortnight the exact date carries it on its own. */
function agoWords(doneISO: string, today: string): string {
  const days = daysBetween(doneISO, today);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return "";
}

export function CompletedTab({
  visits,
  count,
  today,
  manage,
  onOpen,
  onToast,
}: {
  visits: BoardVisit[];
  count: number;
  today: string;
  manage: boolean;
  onOpen: (visitId: string) => void;
  onToast: (message: string, undo?: () => void | Promise<void>) => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();

  const { toInvoice, invoiced } = useMemo(() => {
    const done = visits
      .filter((v) => v.status === "done" && v.completedAt)
      .sort((a, b) => (a.completedAt! > b.completedAt! ? -1 : 1));
    return {
      toInvoice: done.filter((v) => !v.invoicedAt),
      invoiced: done.filter((v) => !!v.invoicedAt),
    };
  }, [visits]);

  const mark = (v: BoardVisit, value: boolean) => {
    start(async () => {
      await setVisitInvoiced(v.id, value);
      onToast(
        value ? `Invoiced — ${v.clientName}` : `Back to the to-invoice pile — ${v.clientName}`,
        async () => {
          await setVisitInvoiced(v.id, !value);
          router.refresh();
        }
      );
      router.refresh();
    });
  };

  const row = (v: BoardVisit) => {
    const timing = completionTiming(v.dueDate, v.completedAt!);
    return (
      <div
        key={v.id}
        className="wb2-dn can-open"
        role="button"
        tabIndex={0}
        aria-label={`Open ${v.clientName} — ${v.label}`}
        onClick={() => onOpen(v.id)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
            e.preventDefault();
            onOpen(v.id);
          }
        }}
      >
        <div className="wb2-dnt">
          <b>{v.clientName}</b>
          <em>
            {v.label}
            {v.siteLabel ? ` · ${v.siteLabel}` : ""}
          </em>
        </div>
        <div className="wb2-dnw">
          {/* "Sat 20 June" answers WHEN; "6 days ago" answers how stale the
              invoice is, which is the question this screen exists for. */}
          <b>
            {fmtAuWeekdayDayMonth(v.completedAt!)}
            <i>{agoWords(v.completedAt!, today)}</i>
          </b>
          <em>
            {v.techs.length
              ? v.techs.map((t) => t.name).join(", ")
              : v.completedSource === "servicem8"
                ? "closed from ServiceM8"
                : "closed manually"}
          </em>
        </div>
        {/* Where the hours came from, said on the row. There is exactly one
            writer of actual hours — the close-out form's "Hours on site" box
            — and nothing in the ServiceM8 mirror feeds it, so a visit closed
            from SM8 has none. Isaac asked the question this answers: "I don't
            know where you actually put that in." */}
        <div
          className="wb2-dnh"
          title={
            v.actualHours !== null
              ? "Typed into Hours on site when this visit was closed out."
              : v.completedSource === "servicem8"
                ? "This visit closed from ServiceM8, which doesn't carry hours — close out here to record them."
                : "Nobody filled in Hours on site at close-out."
          }
        >
          {v.actualHours !== null ? (
            <>
              <b>{hoursLabel(v.actualHours)} on site</b>
              {v.hoursEstimate !== null && v.hoursEstimate !== v.actualHours && (
                <em>booked {hoursLabel(v.hoursEstimate)}</em>
              )}
            </>
          ) : (
            <em>hours not recorded</em>
          )}
        </div>
        <span className="wb2-dnact">
          {/* "13 days late" alone never says late FOR what — the row carries
              three dates. It's the due date, so the chip names the verb it
              belongs to and the tooltip names the date it counted from. */}
          <span
            className={"wb2-chip " + (timing.onTime ? "ok" : "dan")}
            title={`Due ${fmtAuWeekdayDayMonth(v.dueDate)} · done ${fmtAuWeekdayDayMonth(v.completedAt!)}`}
          >
            {timing.onTime
              ? "Done on time"
              : `Done ${timing.daysLate} ${timing.daysLate === 1 ? "day" : "days"} after it was due`}
          </span>
          {manage &&
            (v.invoicedAt ? (
              <button
                className="pbtn ghost"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  mark(v, false);
                }}
              >
                Un-invoice
              </button>
            ) : (
              <button
                className="pbtn ghost"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  mark(v, true);
                }}
              >
                Mark invoiced
              </button>
            ))}
        </span>
        {v.completionNote ? (
          <p className="wb2-dnnote">
            {v.completionNote}
            <span>{noteSource(v)}</span>
          </p>
        ) : (
          <p className="wb2-dnnote none">No close-out note.</p>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="wb2-chd">
        <span className="wb2-ci ok">
          <Icon name="check" size={19} />
        </span>
        <div>
          <b>Completed</b>
          <em>
            {/* Written as one string: split across JSX lines, the space
                before "weeks" was eaten and it read "the last 8weeks". */}
            {`The last ${BOARD_DONE_DAYS / 7} weeks, newest first — what ran, what it took, what's still to bill.`}
          </em>
        </div>
        {toInvoice.length > 0 ? (
          <span className="wb2-chip warn">
            {toInvoice.length} to invoice
          </span>
        ) : (
          count > 0 && <span className="wb2-chip ok">All invoiced</span>
        )}
      </div>

      {toInvoice.length === 0 && invoiced.length === 0 ? (
        <div className="wb2-empty">
          <Icon name="clock" size={20} />
          <b>Nothing closed yet</b>
          <em>Completed visits land here with their close-out notes.</em>
        </div>
      ) : (
        <div className="wb2-dnlist">
          {toInvoice.length > 0 && (
            <div className="wb2-wkhd warn">
              To invoice <em>{toInvoice.length}</em>
            </div>
          )}
          {toInvoice.map(row)}
          {invoiced.length > 0 && (
            <div className="wb2-wkhd">
              Invoiced <em>{invoiced.length}</em>
            </div>
          )}
          {invoiced.map(row)}
        </div>
      )}
    </>
  );
}
