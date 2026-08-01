"use client";

import { useMemo } from "react";
import { Icon } from "@/components/shell/icon";
import { fmtAuDayMonth, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { BoardVisit } from "@/lib/workboard/board-query";
import {
  BOARD_AHEAD_DAYS,
  daysBetween,
  weekGroupKey,
  weekGroupRank,
} from "@/lib/workboard/board-status";
import {
  cadenceLabel,
  GATE_FULL,
  GATE_LABEL,
  initialsOf,
  missingOf,
  placedDayOf,
  TONE_RANK,
  toneOf,
  untilLabel,
} from "./derive";

/* Upcoming — the triage list, grouped by week (C4, decided): Overdue leads,
   then This week, Next week, then each later week under its Monday. Within
   a group the worst news sorts first, so today's ready work can never sink
   below next month's unconfirmed rows (B5) — and done work never appears
   here at all; Completed owns history (B7). */

const GROUP_LABEL = (key: string): string => {
  if (key === "overdue") return "Overdue";
  if (key === "this_week") return "This week";
  if (key === "next_week") return "Next week";
  return `Week of ${fmtAuDayMonth(key)}`;
};

export function UpcomingTab({
  visits,
  today,
  confirm,
  onOpen,
}: {
  visits: BoardVisit[];
  today: string;
  confirm: { gaps: number; services: number };
  onOpen: (visitId: string) => void;
}) {
  const groups = useMemo(() => {
    const inWindow = visits.filter(
      (v) => v.dueDate < today || daysBetween(today, v.dueDate) <= BOARD_AHEAD_DAYS
    );
    const byGroup = new Map<string, BoardVisit[]>();
    for (const v of inWindow) {
      const key = weekGroupKey(v.dueDate, today);
      const list = byGroup.get(key) ?? [];
      list.push(v);
      byGroup.set(key, list);
    }
    return [...byGroup.entries()]
      .sort((a, b) => (weekGroupRank(a[0]) < weekGroupRank(b[0]) ? -1 : 1))
      .map(([key, list]) => ({
        key,
        list: list.sort(
          (a, b) =>
            TONE_RANK[toneOf(a, today)] - TONE_RANK[toneOf(b, today)] ||
            (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0)
        ),
      }));
  }, [visits, today]);

  return (
    <>
      <div className="wb2-chd">
        <span className="wb2-ci blue">
          <Icon name="rotate" size={19} />
        </span>
        <div>
          <b>Maintenance services</b>
          <em>Grouped by week, worst first. Open a row to confirm anything.</em>
        </div>
        <span className={"wb2-chip" + (confirm.gaps > 0 ? " warn" : " ok")}>
          {confirm.gaps > 0
            ? `${confirm.gaps} to confirm across ${confirm.services} ${
                confirm.services === 1 ? "service" : "services"
              }`
            : "Fortnight confirmed"}
        </span>
      </div>

      {groups.length === 0 ? (
        <div className="wb2-empty">
          <Icon name="check" size={20} />
          <b>Nothing on the books</b>
          <em>Set up a service agreement and its visits will land here on their own.</em>
        </div>
      ) : (
        <>
          <div className="wb2-trhd" aria-hidden="true">
            <span>Client and service</span>
            <span>Job</span>
            <span>Frequency · Due</span>
            <span>Day booked</span>
            <span className="wb2-trhd-ck">
              <em style={{ ["--as" as string]: "var(--wb2-eq)" }}>Equip</em>
              <em style={{ ["--as" as string]: "var(--wb2-acc)" }}>Access</em>
              <em style={{ ["--as" as string]: "var(--wb2-crew)" }}>Crew</em>
            </span>
          </div>
          {groups.map((g) => (
            <div className="wb2-wkgrp" key={g.key}>
              <div className={"wb2-wkhd" + (g.key === "overdue" ? " dan" : "")}>
                {GROUP_LABEL(g.key)}
                <em>
                  {g.list.length} {g.list.length === 1 ? "service" : "services"}
                </em>
              </div>
              {g.list.map((v) => (
                <Row key={v.id} v={v} today={today} onOpen={onOpen} />
              ))}
            </div>
          ))}
        </>
      )}
    </>
  );
}

function Row({
  v,
  today,
  onOpen,
}: {
  v: BoardVisit;
  today: string;
  onOpen: (id: string) => void;
}) {
  const tone = toneOf(v, today);
  const missing = missingOf(v);
  const rel = untilLabel(v.dueDate, today);
  const placed = placedDayOf(v);
  const tech = v.techs[0] ?? null;

  return (
    <div
      className="wb2-trj"
      data-sev={tone}
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
      <div className="wb2-trt">
        <b>{v.clientName}</b>
        <em>
          {v.label}
          {v.siteLabel ? ` · ${v.siteLabel}` : ""}
        </em>
      </div>
      <span className="wb2-trref">{v.jobNumber ? `#${v.jobNumber}` : "—"}</span>
      <div className="wb2-trw">
        <em>{cadenceLabel(v.intervalMonths)}</em>
        <span className={"wb2-chip" + (rel.tone ? ` ${rel.tone === "dan" ? "dan" : "warn"}` : "")}>
          {rel.t}
        </span>
      </div>
      <div className="wb2-trd">
        {placed ? (
          <>
            <b>{fmtAuWeekdayDayMonth(placed)}</b>
            <em>
              {tech ? (
                <>
                  <span className="wb2-av" title={tech.name}>
                    {initialsOf(tech.name)}
                  </span>
                  {tech.name}
                  {v.techs.length > 1 ? ` +${v.techs.length - 1}` : ""}
                </>
              ) : (
                "nobody assigned yet"
              )}
            </em>
          </>
        ) : (
          <span className="wb2-chip dan">Not placed</span>
        )}
      </div>
      <div className="wb2-trck">
        {tone === "quote" ? (
          <em className="wb2-trnote">Starts if the quote is won</em>
        ) : missing.length === 0 ? (
          <span className="wb2-ckall">
            <Icon name="check" size={13} />
            Ready
          </span>
        ) : (
          (["equipment", "access", "crew"] as const).map((g) => {
            const on = !missing.includes(g);
            return (
              <span
                key={g}
                className={"wb2-ckq" + (on ? " on" : "")}
                style={{ ["--as" as string]: `var(--wb2-${g === "equipment" ? "eq" : g === "access" ? "acc" : "crew"})` }}
                title={`${GATE_FULL[g]} — ${on ? "confirmed" : "not yet"}`}
                aria-label={GATE_LABEL[g]}
              >
                {on ? <Icon name="check" size={12} /> : <i />}
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}
