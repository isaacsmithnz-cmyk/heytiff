"use client";

import { useMemo } from "react";
import { fmtAuDayMonth, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { mondayOf } from "@/lib/workboard/board-status";
import { plusDays } from "@/lib/workboard/dates";
import { urgentRows } from "@/lib/workboard/urgent-rules";
import type { BoardVisit, MaintenanceBoardData } from "@/lib/workboard/board-query";
import type { BoardFlag } from "@/lib/workboard/notes-query";
import { calendarToneFor, isWeekendClass, placedDayOf, toneOf } from "./derive";

/* Display mode (A10, final directive): the workshop wall TV gets its OWN
   composition — the Urgent queue and a four-week calendar, nothing else,
   ZERO interactivity, in the board's normal LIGHT theme. The dark flip the
   original build shipped is gone and stays gone. The page refreshes itself
   every minute while fullscreen (the shell's existing plumbing); this
   component just draws big and stays out of the way. */

export function MaintenanceWall({
  data,
  flags,
  today,
}: {
  data: MaintenanceBoardData;
  flags: BoardFlag[];
  today: string;
}) {
  const openVisits = useMemo(
    () => data.visits.filter((v) => v.status === "upcoming" || v.status === "booked"),
    [data.visits]
  );

  const urgent = useMemo(
    () =>
      urgentRows({
        today,
        visits: openVisits.map((v) => ({
          visitId: v.id,
          agreementId: v.agreementId,
          label: v.label,
          clientName: v.clientName,
          siteLabel: v.siteLabel,
          status: v.status,
          dueDate: v.dueDate,
          bookedDate: v.bookedDate,
          readiness: v.readiness,
          techCount: v.techs.length,
          mirrorStatus: v.mirrorStatus,
        })),
        flags: flags.map((f) => ({
          flagId: f.id,
          message: f.message,
          severity: f.severity === "urgent" ? "danger" : "warn",
          createdAt: f.createdAt,
          targetKind: f.targetKind ?? "none",
          targetId: f.targetId ?? null,
        })),
        tasks: data.tasks.map((t) => ({
          taskId: t.id,
          title: t.title,
          dueDate: t.dueDate,
          assigneeName: t.assigneeName,
        })),
      }),
    [today, openVisits, flags, data.tasks]
  );

  const days = useMemo(() => {
    const byDay = new Map<string, BoardVisit[]>();
    for (const v of data.visits) {
      const day = placedDayOf(v);
      if (!day) continue;
      const list = byDay.get(day) ?? [];
      list.push(v);
      byDay.set(day, list);
    }
    const start = mondayOf(today);
    return Array.from({ length: 28 }, (_, i) => {
      const iso = plusDays(start, i);
      const dayVisits = byDay.get(iso) ?? [];
      return {
        iso,
        dayVisits,
        tone: calendarToneFor(dayVisits, iso, today),
      };
    });
  }, [data.visits, today]);

  return (
    <div className="wb2-wall" aria-label="Workboard wall view">
      <div className="wb2-wallhd">
        <b>Maintenance</b>
        <em>{fmtAuWeekdayDayMonth(today)}</em>
      </div>
      <div className="wb2-wallcols">
        <section className="wb2-wallq" aria-label="Needs you today">
          <h2>Needs you today</h2>
          {urgent.length === 0 ? (
            <p className="wb2-wallcalm">Nothing needs you right now — the month is confirmed as far as it goes.</p>
          ) : (
            urgent.slice(0, 9).map((r) => (
              <div className="wb2-wallrow" data-sev={r.severity === "danger" ? "dan" : "warn"} key={r.key}>
                <span className={"wb2-chip " + (r.severity === "danger" ? "dan" : "warn")}>{r.headline}</span>
                <b>
                  {r.reason === "flag" || r.reason === "task"
                    ? r.label ?? r.headline
                    : `${r.clientName} — ${r.label}`}
                </b>
              </div>
            ))
          )}
          {urgent.length > 9 && <p className="wb2-wallcalm">+{urgent.length - 9} more in the queue</p>}
        </section>
        <section className="wb2-wallcal" aria-label="The next four weeks">
          <h2>The next four weeks</h2>
          <div className="wb2-wallgrid">
            {days.map((d) => (
              <div
                key={d.iso}
                className={"wb2-mcc" + isWeekendClass(d.iso) + (d.iso === today ? " today" : "")}
                data-tone={d.tone}
              >
                <span className="wb2-mcn">
                  {fmtAuDayMonth(d.iso)}
                  {d.iso === today && <em>Today</em>}
                </span>
                {d.dayVisits.length > 0 && (
                  <span className="wb2-mcdots">
                    {d.dayVisits.slice(0, 4).map((v) => (
                      <i key={v.id} data-tone={toneOf(v, today)} />
                    ))}
                    {d.dayVisits.length > 4 && <b>+{d.dayVisits.length - 4}</b>}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
