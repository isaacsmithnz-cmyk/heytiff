"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { BoardAgreementSummary } from "@/lib/workboard/board-query";
import { cadenceLabel, untilLabel } from "./derive";

/* Service agreements — the ledger, grouped by category. Every row names its
   client (B22: outside a category band an agreement must never be
   anonymous), and an overdue "next" is called overdue, not next (B10).
   First cut this step: the grouped read view, linking to the shipped
   agreement detail; the edit sheet and the create-from-ServiceM8 flow
   arrive with step 4. */

export function AgreementsTab({
  agreements,
  today,
}: {
  agreements: BoardAgreementSummary[];
  today: string;
}) {
  const groups = useMemo(() => {
    const byKey = new Map<string, { name: string; accent: string | null; list: BoardAgreementSummary[] }>();
    for (const a of agreements) {
      const key = a.category?.id ?? "";
      const cur =
        byKey.get(key) ??
        ({ name: a.category?.name ?? "Uncategorised", accent: a.category?.accent ?? null, list: [] } as {
          name: string;
          accent: string | null;
          list: BoardAgreementSummary[];
        });
      cur.list.push(a);
      byKey.set(key, cur);
    }
    return [...byKey.entries()]
      .sort((x, y) => (x[0] === "" ? 1 : y[0] === "" ? -1 : x[1].name.localeCompare(y[1].name)))
      .map(([, g]) => g);
  }, [agreements]);

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
        <Link href="/dashboard/workboard/maintenance" className="pbtn ghost">
          Manage agreements
        </Link>
      </div>

      {agreements.length === 0 ? (
        <div className="wb2-empty">
          <Icon name="file" size={20} />
          <b>No agreements yet</b>
          <em>Set one up under Manage agreements and its visits generate on their own.</em>
        </div>
      ) : (
        groups.map((g) => (
          <div className="wb2-agrp" key={g.name} data-accent={g.accent ?? undefined}>
            <div className="wb2-aghd">
              <i aria-hidden="true" />
              {g.name}
              <em>
                {g.list.length} {g.list.length === 1 ? "agreement" : "agreements"}
              </em>
            </div>
            {g.list.map((a) => {
              const rel = a.nextDue ? untilLabel(a.nextDue, today) : null;
              return (
                <Link
                  className="wb2-agr"
                  key={a.id}
                  href={`/dashboard/workboard/maintenance/${a.id}`}
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
                    {a.nextDue ? (
                      <>
                        <b>
                          {a.overdueCount > 0 ? "Overdue since " : "Next "}
                          {fmtAuWeekdayDayMonth(a.nextDue)}
                        </b>
                        {rel && (
                          <em className={rel.tone === "dan" ? "dan" : undefined}>{rel.t}</em>
                        )}
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
                    {a.overdueCount > 0 && (
                      <span className="wb2-chip dan">
                        {a.overdueCount} overdue
                      </span>
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        ))
      )}
    </>
  );
}
