"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { clearFlag } from "@/app/actions/workboard-notes";
import { completeTask } from "@/app/actions/dashboard";
import type { UrgentRow } from "@/lib/workboard/urgent-rules";

/* Urgent — every row is DERIVED (the L1 ruleset): it exists because a rule
   fired, and it clears itself when the fact changes. First cut this step:
   visit rows open the sheet (where booking/confirming lives), flag and task
   rows carry their one-click resolutions. The inline book/assign actions and
   the vitals-as-filter chips arrive with step 3. */

export function UrgentTab({
  rows,
  onOpenVisit,
  manage,
}: {
  rows: UrgentRow[];
  onOpenVisit: (visitId: string) => void;
  manage: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();

  return (
    <>
      <div className="wb2-chd">
        <span className="wb2-ci dan">
          <Icon name="zap" size={19} />
        </span>
        <div>
          <b>Needs you today</b>
          <em>Overdue first, then before the week turns. Rows clear themselves as facts change.</em>
        </div>
        {rows.length > 0 && (
          <span className={"wb2-chip " + (rows.some((r) => r.severity === "danger") ? "dan" : "warn")}>
            {rows.length} {rows.length === 1 ? "item" : "items"}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="wb2-empty">
          <Icon name="check" size={20} />
          <b>Nothing needs you right now</b>
          <em>The month is confirmed as far as it goes.</em>
        </div>
      ) : (
        <div className="wb2-urlist">
          {rows.map((r) => {
            const openable = !!r.visitId;
            return (
              <div
                key={r.key}
                className={"wb2-ur" + (openable ? " can-open" : "")}
                data-sev={r.severity === "danger" ? "dan" : "warn"}
                role={openable ? "button" : undefined}
                tabIndex={openable ? 0 : undefined}
                aria-label={openable ? `Open ${r.clientName} — ${r.label}` : undefined}
                onClick={openable ? () => onOpenVisit(r.visitId!) : undefined}
                onKeyDown={
                  openable
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenVisit(r.visitId!);
                        }
                      }
                    : undefined
                }
              >
                <div className="wb2-urt">
                  <div className="wb2-urwhy">
                    <span className={"wb2-chip " + (r.severity === "danger" ? "dan" : "warn")}>
                      {r.headline}
                    </span>
                    {r.also.map((a) => (
                      <span className="wb2-chip" key={a}>
                        {a}
                      </span>
                    ))}
                  </div>
                  <b>
                    {r.reason === "flag" || r.reason === "task"
                      ? r.label ?? r.headline
                      : `${r.clientName} — ${r.label}`}
                  </b>
                  {r.reason === "flag" ? (
                    <em>Raised from a note — stays up until somebody clears it.</em>
                  ) : r.reason === "task" ? (
                    <em>{r.also.length ? `For ${r.also[0]}` : "A task from the board"}</em>
                  ) : (
                    <em>
                      {r.siteLabel ? `${r.siteLabel} · ` : ""}
                      {r.reason === "overdue" ? "open the row to book it in" : "open the row to confirm"}
                    </em>
                  )}
                </div>
                {r.reason === "flag" && manage && (
                  <button
                    className="pbtn ghost"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      start(async () => {
                        await clearFlag(r.flagId!);
                        router.refresh();
                      });
                    }}
                  >
                    Clear
                  </button>
                )}
                {r.reason === "task" && (
                  <button
                    className="pbtn ghost"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      start(async () => {
                        await completeTask(r.taskId!);
                        router.refresh();
                      });
                    }}
                  >
                    Done
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
