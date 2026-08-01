"use client";

import { useMemo } from "react";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { BOARD_DONE_DAYS, completionTiming } from "@/lib/workboard/board-status";
import type { BoardVisit } from "@/lib/workboard/board-query";
import { hoursLabel } from "./derive";

/* Completed — the review pass. Hours here are ACTUALS from the close-out,
   never the booking estimate wearing an "on site" label (L3); when both
   exist the variance is said out loud. "Done on time" is earned from the
   dates, not assumed (B12). */

export function CompletedTab({
  visits,
  count,
  onOpen,
}: {
  visits: BoardVisit[];
  count: number;
  onOpen: (visitId: string) => void;
}) {
  const done = useMemo(
    () =>
      visits
        .filter((v) => v.status === "done" && v.completedAt)
        .sort((a, b) => (a.completedAt! > b.completedAt! ? -1 : 1)),
    [visits]
  );

  return (
    <>
      <div className="wb2-chd">
        <span className="wb2-ci ok">
          <Icon name="check" size={19} />
        </span>
        <div>
          <b>Completed</b>
          <em>The last {BOARD_DONE_DAYS / 7} weeks, newest first — what ran, how long it took, what the tech said.</em>
        </div>
        {count > 0 && <span className="wb2-chip ok">{count} closed</span>}
      </div>

      {done.length === 0 ? (
        <div className="wb2-empty">
          <Icon name="clock" size={20} />
          <b>Nothing closed yet</b>
          <em>Completed visits land here with their close-out notes.</em>
        </div>
      ) : (
        <div className="wb2-dnlist">
          {done.map((v) => {
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
                  if (e.key === "Enter" || e.key === " ") {
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
                  <b>{fmtAuWeekdayDayMonth(v.completedAt!)}</b>
                  <em>
                    {v.techs.length
                      ? v.techs.map((t) => t.name).join(", ")
                      : v.completedSource === "servicem8"
                        ? "closed from ServiceM8"
                        : "closed manually"}
                  </em>
                </div>
                <div className="wb2-dnh">
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
                <span className={"wb2-chip " + (timing.onTime ? "ok" : "dan")}>
                  {timing.onTime
                    ? "Done on time"
                    : `${timing.daysLate} ${timing.daysLate === 1 ? "day" : "days"} late`}
                </span>
                {v.completionNote ? (
                  <p className="wb2-dnnote">{v.completionNote}</p>
                ) : (
                  <p className="wb2-dnnote none">No close-out note.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
