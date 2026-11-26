"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { jobPageHref } from "@/lib/shell/links";
import { FILTER_OF, fmtLeave, fmtMinutes, type ActivityFilter, type ActivityKind, type PersonActivity } from "@/lib/team/person-activity";

/* A PERSON'S ACTIVITY, the right of their Overview (Isaac, 26 November 2026:
   "1" to the person's own feed, then "1" to purple). A job's feed in its
   own dress: the head is purple, not the job feed's green, because a
   header's colour says what the card is and green is the job's story;
   purple has no other meaning, so it is people's (docs/design.md). The
   filters sit in the head as the job feed's do. Under them the week in four
   figures, then the days, newest first, each row the job feed's own: its
   grey mark, the bold words, the grey line, and the job's number on the
   right, its door. */

const MARK: Record<ActivityKind, string> = {
  on: "clock",
  off: "power",
  site: "wrench",
  note: "note",
  photos: "cam",
  tick: "check",
  leave: "sun",
  papers: "card",
};

const FILTERS: { key: ActivityFilter; label: string; needs?: "hours" | "leave" }[] = [
  { key: "all", label: "All" },
  { key: "hours", label: "Hours", needs: "hours" },
  { key: "jobs", label: "Jobs" },
  { key: "notes", label: "Notes" },
  { key: "leave", label: "Leave", needs: "hours" },
];

export function PersonActivity({ activity, first, style }: { activity: PersonActivity; first: string; style?: CSSProperties }) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const shown = FILTERS.filter((f) => !f.needs || activity[f.needs]);
  const days = activity.days
    .map((d) => ({ ...d, entries: filter === "all" ? d.entries : d.entries.filter((e) => FILTER_OF[e.kind] === filter) }))
    .filter((d) => d.entries.length > 0);
  const { stats } = activity;

  const figures: { label: string; value: string; sub: string; over?: boolean }[] = [];
  if (stats.week) figures.push({ label: "This week", value: fmtMinutes(stats.week.minutes), sub: stats.week.days === 1 ? "1 day so far" : `${stats.week.days} days so far` });
  if (stats.overtimeMinutes != null) figures.push({ label: "Overtime", value: fmtMinutes(stats.overtimeMinutes), sub: "this week", over: stats.overtimeMinutes > 0 });
  if (stats.averageDay) figures.push({ label: "Average day", value: fmtMinutes(stats.averageDay.minutes), sub: "last 3 months" });
  if (stats.leave)
    figures.push({
      label: "Leave left",
      value: fmtLeave(stats.leave.annualHours, stats.leave.perDay),
      sub: `${fmtLeave(stats.leave.personalHours, stats.leave.perDay)} personal`,
    });

  return (
    <section className="jov-sec jc-convo pp-feed" aria-label={`${first}'s activity`} style={style}>
      <div className="jov-head">
        <span className="hm-blk" aria-hidden="true">
          <Icon name="activity" size={18} />
        </span>
        <h2 className="jov-title">Activity</h2>
        <div className="pt-vtabs jc-filter" role="group" aria-label="Show in the feed">
          {shown.map((f) => (
            <button key={f.key} type="button" className="pt-vtab" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              <span className="pt-vtab-word">{f.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="jc-body">
        {figures.length > 0 && (
          <dl className="pp-figs" style={{ gridTemplateColumns: `repeat(${figures.length}, minmax(0,1fr))` }}>
            {figures.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd className={f.over ? "pp-over" : undefined}>{f.value}</dd>
                <dd className="pp-figsub">{f.sub}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="jc-feed">
          {days.length === 0 ? (
            <p className="jov-none">{filter === "all" ? `Nothing from ${first} in the last two weeks.` : "Nothing of that kind in the last two weeks."}</p>
          ) : (
            days.map((d) => (
              <div key={d.day} className="jc-day">
                <p className="jc-dayname">{d.label}</p>
                {d.entries.map((e) => (
                  <div key={e.key} className="jc-entry jc-event">
                    <div className="jc-evrow">
                      <span className="jc-made-icon" aria-hidden="true">
                        <Icon name={MARK[e.kind]} size={16} />
                      </span>
                      <span className="jc-evwords">
                        <b className="cv-result-name">{e.name}</b>
                        {e.line && (
                          <>
                            {" "}
                            <span className="cv-result-line">{e.line}</span>
                          </>
                        )}
                        {e.over && (
                          <>
                            {e.line ? ", " : " "}
                            <span className="pp-over">{e.over}</span>
                          </>
                        )}
                      </span>
                      {e.job && (
                        <Link className="pp-job" href={jobPageHref(e.job.uuid)}>
                          {e.job.number ? `Job ${e.job.number}` : "The job"}
                        </Link>
                      )}
                    </div>
                    {e.words && <p className="pp-words">{e.words}</p>}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
