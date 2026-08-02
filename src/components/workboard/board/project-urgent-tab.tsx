"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { clearFlag, restoreFlag } from "@/app/actions/workboard-notes";
import {
  assignVisitTech,
  setVisitReadiness,
  unassignVisitTech,
} from "@/app/actions/workboard-maintenance";
import type { BoardTech } from "@/lib/workboard/board-query";
import type { ProjectUrgentRow } from "@/lib/workboard/project-rules";
import { UrgentBody } from "./urgent-layout";

/* Urgent, projects side — the same law as the maintenance queue: every row
   is derived, every quick action fixes the row's own fact, and the row
   leaves because the fact changed. Project-state rows (blocked, promise,
   burn, stale) open the project — their remedy is a decision, not a tick.

   Same two groups as maintenance (late trips, then what's stuck) and the
   same layout component. No task lane: tasks belong to a person and the
   maintenance queue already carries the org's, so showing them twice would
   break the one rule this board has — nothing appears on both sides. */

type UrgentFilter = "all" | "trips" | "projects" | "flags";

/** The date a trip turns on — booked day if one is chosen, else the due date. */
function dueWords(r: ProjectUrgentRow): string | null {
  if (r.bookedDate) return `booked ${fmtAuWeekdayDayMonth(r.bookedDate)}`;
  if (!r.dueDate) return null;
  return r.reason === "visit_overdue"
    ? `was due ${fmtAuWeekdayDayMonth(r.dueDate)}`
    : `due ${fmtAuWeekdayDayMonth(r.dueDate)}`;
}

const FILTER_OF: Record<ProjectUrgentRow["reason"], Exclude<UrgentFilter, "all">> = {
  visit_overdue: "trips",
  gate_gap: "trips",
  no_tech: "trips",
  blocked: "projects",
  promise: "projects",
  burn: "projects",
  stale: "projects",
  flag: "flags",
};

export function ProjectUrgentTab({
  rows,
  staff,
  manage,
  onOpenVisit,
  onCloseOut,
  onToast,
}: {
  rows: ProjectUrgentRow[];
  staff: BoardTech[];
  manage: boolean;
  onOpenVisit: (visitId: string) => void;
  onCloseOut: (visitId: string) => void;
  onToast: (message: string, undo?: () => void | Promise<void>) => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [filter, setFilter] = useState<UrgentFilter>("all");

  const counts = useMemo(() => {
    const c = { all: rows.length, trips: 0, projects: 0, flags: 0 };
    for (const r of rows) c[FILTER_OF[r.reason]] += 1;
    return c;
  }, [rows]);

  const shown = filter === "all" ? rows : rows.filter((r) => FILTER_OF[r.reason] === filter);

  const run = (fn: () => Promise<unknown>, message?: string, undo?: () => void | Promise<void>) => {
    start(async () => {
      await fn();
      if (message) onToast(message, undo);
      router.refresh();
    });
  };

  const undoable = (fn: () => Promise<unknown>) => async () => {
    await fn();
    router.refresh();
  };

  const filterChip = (key: UrgentFilter, label: string, tone: "" | "dan" | "warn") =>
    (key === "all" || counts[key] > 0) && (
      <button
        key={key}
        type="button"
        className={"wb2-filter" + (tone ? ` ${tone}` : "") + (filter === key ? " on" : "")}
        aria-pressed={filter === key}
        onClick={() => setFilter(filter === key ? "all" : key)}
      >
        <b>{counts[key]}</b>
        {label}
      </button>
    );

  return (
    <>
      <div className="wb2-chd">
        <span className="wb2-ci dan">
          <Icon name="zap" size={19} />
        </span>
        <div>
          <b>Needs attention</b>
          <em>Late trips first, then what&apos;s stuck. Rows clear themselves as facts change.</em>
        </div>
        <div className="wb2-filters">
          {filterChip("all", "everything", "")}
          {filterChip("trips", "trips", "dan")}
          {filterChip("projects", "stuck projects", "warn")}
          {filterChip("flags", "flags", "warn")}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="wb2-empty">
          <Icon name="check" size={20} />
          <b>{filter === "all" ? "Nothing needs attention right now" : "Nothing of that kind right now"}</b>
          <em>
            {filter === "all"
              ? "Every project is moving and every trip is on track."
              : "The rest of the queue is under Everything."}
          </em>
        </div>
      ) : (
        <UrgentBody
          overdue={shown
            .filter((r) => r.reason === "visit_overdue")
            .map((r) => <Row key={r.key} r={r} />)}
          soon={shown
            .filter((r) => r.reason !== "visit_overdue")
            .map((r) => <Row key={r.key} r={r} />)}
        />
      )}
    </>
  );

  function Row({ r }: { r: ProjectUrgentRow }) {
    const openable = !!r.visitId;
    return (
      <div
        className={"wb2-ur" + (openable ? " can-open" : "")}
        data-sev={r.severity === "danger" ? "dan" : "warn"}
        role={openable ? "button" : undefined}
        tabIndex={openable ? 0 : undefined}
        aria-label={openable ? `Open ${r.label}` : undefined}
        onClick={openable ? () => onOpenVisit(r.visitId!) : undefined}
        onKeyDown={
          openable
            ? (e) => {
                if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
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
          <b>{r.reason === "flag" ? r.headline : r.label}</b>
          {r.reason === "flag" ? (
            <em>Raised from a note — stays up until somebody clears it.</em>
          ) : r.visitId ? (
            /* Facts, not instructions — see the note in urgent-tab. */
            <em>{[r.siteLabel, dueWords(r)].filter(Boolean).join(" · ")}</em>
          ) : (
            <em>
              {r.clientName ? `${r.clientName} · ` : ""}
              {r.reason === "blocked"
                ? "unblocking is a decision — open the project"
                : r.reason === "promise"
                  ? "the promise needs a call: pull crew forward or reset the date"
                  : r.reason === "burn"
                    ? "the hours are the news — worth a look before quoting more"
                    : "open it and move something, or park it on hold honestly"}
            </em>
          )}
        </div>
        <RowAction r={r} />
      </div>
    );
  }

  function RowAction({ r }: { r: ProjectUrgentRow }) {
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();

    if (r.reason === "flag") {
      return (
        <button
          className="pbtn ghost"
          disabled={busy}
          onClick={(e) => {
            stop(e);
            const id = r.flagId!;
            run(() => clearFlag(id), "Flag cleared", undoable(() => restoreFlag(id)));
          }}
        >
          Clear
        </button>
      );
    }

    if (r.action === "open_project") {
      return (
        <Link
          className="pbtn ghost"
          href={`/dashboard/workboard/projects/${r.projectId}`}
          onClick={stop}
        >
          Open the project
        </Link>
      );
    }

    if (r.reason === "gate_gap" && r.leadGate && r.leadGate !== "crew") {
      const key = r.leadGate === "equipment" ? "equipment_ready" : "access_confirmed";
      const word = r.leadGate === "equipment" ? "Equipment" : "Access";
      return (
        <button
          className="pbtn ghost"
          disabled={busy}
          onClick={(e) => {
            stop(e);
            const id = r.visitId!;
            run(
              () => setVisitReadiness(id, key, true),
              `${word} confirmed — ${r.label}`,
              undoable(() => setVisitReadiness(id, key, false))
            );
          }}
        >
          Confirm {word.toLowerCase()}
        </button>
      );
    }

    if (r.reason === "no_tech") {
      if (!manage) return null;
      return (
        <select
          className="wb2-sel"
          disabled={busy}
          value=""
          aria-label={`Assign a technician — ${r.label}`}
          onClick={stop}
          onChange={(e) => {
            stop(e);
            const staffId = e.target.value;
            if (!staffId) return;
            const id = r.visitId!;
            const name = staff.find((s) => s.id === staffId)?.name ?? "Assigned";
            run(
              () => assignVisitTech(id, staffId),
              `${name} assigned — ${r.label}`,
              undoable(() => unassignVisitTech(id, staffId))
            );
          }}
        >
          <option value="">Assign…</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      );
    }

    if (r.action === "close_out") {
      return (
        <button
          className="pbtn ghost"
          disabled={busy}
          onClick={(e) => {
            stop(e);
            onCloseOut(r.visitId!);
          }}
        >
          Close it out
        </button>
      );
    }
    return (
      <button
        className="pbtn ghost"
        disabled={busy}
        onClick={(e) => {
          stop(e);
          onOpenVisit(r.visitId!);
        }}
      >
        Book it in
      </button>
    );
  }
}
