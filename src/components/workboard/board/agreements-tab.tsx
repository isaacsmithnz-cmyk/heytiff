"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { BoardAgreement } from "@/lib/workboard/board-query";
import { cadenceLabel, untilLabel } from "./derive";

/* Service agreements — the ledger, grouped by category. Every row names its
   client (B22), an overdue "next" is called overdue (B10), rows open the
   agreement SHEET (A6 — no more hopping to a separate page), and the
   category header carries the prototype's lost feature (K8): book the whole
   category's next visits onto one day, one pass. */

export function AgreementsTab({
  agreements,
  today,
  manage,
  onOpen,
  onNew,
  onBookCategory,
}: {
  agreements: BoardAgreement[];
  today: string;
  manage: boolean;
  onOpen: (agreementId: string) => void;
  onNew: () => void;
  onBookCategory: (agreementIds: string[], dayISO: string, categoryName: string) => void;
}) {
  const [bookingFor, setBookingFor] = useState<string | null>(null);
  const [bookDay, setBookDay] = useState("");

  const groups = useMemo(() => {
    const byKey = new Map<
      string,
      { name: string; accent: string | null; list: BoardAgreement[] }
    >();
    for (const a of agreements) {
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
  }, [agreements]);

  return (
    <>
      <div className="wb2-chd">
        <span className="wb2-ci">
          <Icon name="file" size={19} />
        </span>
        <div>
          <b>Service agreements</b>
          <em>The standing work, grouped by how it&apos;s billed. Open a row to edit anything.</em>
        </div>
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
      ) : (
        groups.map((g) => (
          <div className="wb2-agrp" key={g.key || "uncat"} data-accent={g.accent ?? undefined}>
            <div className="wb2-aghd">
              <i aria-hidden="true" />
              {g.name}
              <em>
                {g.list.length} {g.list.length === 1 ? "agreement" : "agreements"}
              </em>
              {/* K8's lost feature, rendered where it pays off: quote,
                  schedule and run a portfolio in one pass */}
              {manage && g.key !== "" && g.list.some((a) => a.status === "active") && (
                <span className="wb2-agbook">
                  {bookingFor === g.key ? (
                    <>
                      <input
                        type="date"
                        className="wb2-fi"
                        aria-label={`Day for ${g.name}`}
                        value={bookDay}
                        onChange={(e) => setBookDay(e.target.value)}
                      />
                      <button
                        className="pbtn ghost"
                        disabled={!bookDay}
                        onClick={() => {
                          setBookingFor(null);
                          onBookCategory(
                            g.list.filter((a) => a.status === "active").map((a) => a.id),
                            bookDay,
                            g.name
                          );
                          setBookDay("");
                        }}
                      >
                        Book them
                      </button>
                      <button className="pbtn ghost" onClick={() => setBookingFor(null)}>
                        Never mind
                      </button>
                    </>
                  ) : (
                    <button className="pbtn ghost" onClick={() => setBookingFor(g.key)}>
                      Book the category on one day
                    </button>
                  )}
                </span>
              )}
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
                  <div className="wb2-trt">
                    <b>{a.clientName}</b>
                    <em>
                      {a.label}
                      {a.siteLabel ? ` · ${a.siteLabel}` : ""}
                    </em>
                  </div>
                  <em className="wb2-agcad">{cadenceLabel(a.intervalMonths)}</em>
                  <div className="wb2-trd">
                    {a.status === "paused" ? (
                      <span className="wb2-chip warn">Paused</span>
                    ) : a.nextDue ? (
                      <>
                        <b>
                          {a.overdueCount > 0 ? "Overdue since " : "Next "}
                          {fmtAuWeekdayDayMonth(a.nextDue)}
                        </b>
                        {rel && <em className={rel.tone === "dan" ? "dan" : undefined}>{rel.t}</em>}
                      </>
                    ) : (
                      <em>No open visits</em>
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
