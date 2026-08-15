"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { daysBetween } from "@/lib/workboard/board-status";
import type { BoardAgreement } from "@/lib/workboard/board-query";
import { cadenceLabel, untilLabel } from "./derive";

/* Service agreements — the ledger, grouped by category. Every row names its
   client (B22), an overdue "next" is called overdue (B10), and rows open the
   agreement SHEET (A6 — no more hopping to a separate page).

   "Book the category on one day" USED to live on the group header. It came
   from the audit (K8) as a feature the prototype had wired but never
   rendered, and I argued for it on that basis. Isaac's read — booking a
   whole category onto a single day isn't how the work actually goes — beats
   an inference from an orphaned handler, so it's gone.

   A ledger row answers three questions, so it carries three dates: when it
   was LAST done, when it's NEXT due, and what comes after that. Two of those
   are what make a cadence legible — "quarterly" is a word, "May, then
   August, then November" is the actual rhythm — and the last-done column is
   the one people check before ringing a client back.

   Search matches client, service, site and tag, because that's the four ways
   anyone names an agreement out loud. It filters WITHIN the groups so the
   category structure never shifts underneath you mid-type. */

/** "6 weeks ago" — how long since, said the way a person would. */
function agoLabel(iso: string, today: string): string {
  const days = daysBetween(iso, today);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 9) return `${weeks} weeks ago`;
  const months = Math.round(days / 30.44);
  if (months < 18) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(days / 365.25);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/** The group's own headline: how many, when the next one lands, what's late. */
function groupLine(list: BoardAgreement[], today: string): string {
  const bits = [`${list.length} ${list.length === 1 ? "agreement" : "agreements"}`];
  const next = list
    .filter((a) => a.status !== "paused" && a.nextDue)
    .map((a) => a.nextDue!)
    .sort()[0];
  if (next) bits.push(`${next < today ? "oldest overdue" : "next"} ${fmtAuWeekdayDayMonth(next)}`);
  const overdue = list.reduce((n, a) => n + (a.status === "paused" ? 0 : a.overdueCount), 0);
  if (overdue > 0) bits.push(`${overdue} overdue`);
  return bits.join(" · ");
}

export function AgreementsTab({
  agreements,
  today,
  manage,
  onOpen,
  onNew,
}: {
  agreements: BoardAgreement[];
  today: string;
  manage: boolean;
  onOpen: (agreementId: string) => void;
  onNew: () => void;
}) {
  const [q, setQ] = useState("");

  const matching = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return agreements;
    return agreements.filter((a) =>
      [a.clientName, a.label, a.siteLabel, a.siteAddress, ...a.tags.map((t) => t.name)]
        .filter(Boolean)
        .some((s) => (s as string).toLowerCase().includes(needle))
    );
  }, [agreements, q]);

  const groups = useMemo(() => {
    const byKey = new Map<
      string,
      { name: string; accent: string | null; list: BoardAgreement[] }
    >();
    for (const a of matching) {
      const key = a.category?.id ?? "";
      const cur =
        byKey.get(key) ??
        ({ name: a.category?.name ?? "Uncategorised", accent: a.category?.accent ?? null, list: [] } as {
          name: string;
          accent: string | null;
          list: BoardAgreement[];
        });
      cur.list.push(a);
      byKey.set(key, cur);
    }
    return [...byKey.entries()]
      .sort((x, y) => (x[0] === "" ? 1 : y[0] === "" ? -1 : x[1].name.localeCompare(y[1].name)))
      .map(([key, g]) => ({ key, ...g }));
  }, [matching]);

  return (
    <>
      <div className="wb2-chd">
        <span className="wb2-ci">
          <Icon name="file" size={19} />
        </span>
        <div>
          <b>Service agreements</b>
          <em>The standing work, grouped by how it&apos;s billed.</em>
        </div>
        {agreements.length > 0 && (
          <label className="wb2-agsearch">
            <Icon name="search" size={14} />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search client, service, site or tag"
              aria-label="Search agreements"
            />
          </label>
        )}
        {manage && (
          <button className="pbtn" onClick={onNew}>
            <Icon name="plus" size={15} />
            New agreement
          </button>
        )}
      </div>

      {agreements.length === 0 ? (
        <div className="wb2-empty">
          <Icon name="file" size={20} />
          <b>No agreements yet</b>
          <em>Set one up and its visits generate on their own — no other software needed.</em>
        </div>
      ) : matching.length === 0 ? (
        <div className="wb2-empty">
          <Icon name="search" size={20} />
          <b>Nothing matches “{q.trim()}”</b>
          <em>Search reads the client, the service, the site and the tags.</em>
        </div>
      ) : (
        groups.map((g) => (
          <div className="wb2-agrp" key={g.key || "uncat"} data-accent={g.accent ?? undefined}>
            <div className="wb2-aghd">
              <i aria-hidden="true" />
              {g.name}
              <em>{groupLine(g.list, today)}</em>
            </div>
            <div className="wb2-agcols" aria-hidden="true">
              <span />
              <span>Client and service</span>
              <span>Frequency</span>
              <span>Last done</span>
              <span>Due</span>
              <span>Then</span>
              <span>Tags</span>
            </div>
            {g.list.map((a) => {
              const rel = a.nextDue ? untilLabel(a.nextDue, today) : null;
              return (
                <button
                  className="wb2-agr as-btn"
                  key={a.id}
                  onClick={() => onOpen(a.id)}
                  aria-label={`Open ${a.clientName} — ${a.label}`}
                >
                  <i className={"wb2-agdot" + (a.overdueCount > 0 ? " dan" : a.status === "paused" ? " off" : "")} aria-hidden="true" />
                  <div className="wb2-trt">
                    <b>{a.clientName}</b>
                    <em>
                      {a.label}
                      {a.siteLabel ? ` · ${a.siteLabel}` : ""}
                    </em>
                  </div>
                  <em className="wb2-agcad">{cadenceLabel(a.intervalMonths)}</em>
                  <div className="wb2-trd">
                    {a.lastDone ? (
                      <>
                        <b>{fmtAuWeekdayDayMonth(a.lastDone)}</b>
                        <em>{agoLabel(a.lastDone, today)}</em>
                      </>
                    ) : (
                      <em>Not yet serviced</em>
                    )}
                  </div>
                  <div className="wb2-trd">
                    {a.status === "paused" ? (
                      <span className="wb2-chip warn">Paused</span>
                    ) : a.nextDue ? (
                      <>
                        <b className={a.overdueCount > 0 ? "dan" : undefined}>
                          {a.overdueCount > 0 ? "Overdue since " : ""}
                          {fmtAuWeekdayDayMonth(a.nextDue)}
                        </b>
                        {rel && <em className={rel.tone === "dan" ? "dan" : undefined}>{rel.t}</em>}
                      </>
                    ) : (
                      <em>No open visits</em>
                    )}
                  </div>
                  <div className="wb2-trd quiet">
                    {a.status !== "paused" && a.thenDue ? (
                      <b>{fmtAuWeekdayDayMonth(a.thenDue)}</b>
                    ) : (
                      <em>—</em>
                    )}
                  </div>
                  <span className="wb2-agtags">
                    {a.tags.map((t) => (
                      <i className={`wb2-tag t-${t.color}`} key={t.id}>
                        {t.name}
                      </i>
                    ))}
                    {a.overdueCount > 0 && a.status !== "paused" && (
                      <span className="wb2-chip dan">{a.overdueCount} overdue</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ))
      )}
    </>
  );
}
