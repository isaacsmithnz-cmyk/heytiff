"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { clearFlag, restoreFlag } from "@/app/actions/workboard-notes";
import { completeTask, reopenTask } from "@/app/actions/dashboard";
import {
  assignVisitTech,
  setVisitReadiness,
  unassignVisitTech,
} from "@/app/actions/workboard-maintenance";
import type { BoardTech } from "@/lib/workboard/board-query";
import type { UrgentRow } from "@/lib/workboard/urgent-rules";
import { TaskRow, UrgentBody } from "./urgent-layout";

/* Urgent — the derived queue, now with the actions the fixtures always
   promised (A1/A4). Each row's quick action fixes ITS fact — confirm the
   lead gate, assign the tech, clear the flag, complete the task — and the
   row leaves because the fact changed, never because someone hid it. Every
   action raises its own toast carrying its own inverse (B23).

   Layout lives in urgent-layout: work splits into Overdue and Deal with it
   today, personal tasks take the right-hand lane. Filtering narrows what
   feeds those groups, so a filter that empties one simply drops it.

   The old vitals return here as FILTERS (D8): a number you can't press is
   decoration, so each count narrows the queue to its kind. */

type UrgentFilter = "all" | "overdue" | "gaps" | "flags" | "tasks";

const FILTER_OF: Record<UrgentRow["reason"], Exclude<UrgentFilter, "all">> = {
  overdue: "overdue",
  gate_gap: "gaps",
  no_tech: "gaps",
  flag: "flags",
  task: "tasks",
};

export function UrgentTab({
  rows,
  staff,
  manage,
  onOpenVisit,
  onCloseOut,
  onToast,
}: {
  rows: UrgentRow[];
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
    const c = { all: rows.length, overdue: 0, gaps: 0, flags: 0, tasks: 0 };
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
          <b>Needs you today</b>
          <em>Overdue first, then before the week turns. Rows clear themselves as facts change.</em>
        </div>
        <div className="wb2-filters">
          {filterChip("all", "everything", "")}
          {filterChip("overdue", "overdue", "dan")}
          {filterChip("gaps", "to confirm", "warn")}
          {filterChip("flags", "flags", "warn")}
          {filterChip("tasks", "tasks", "warn")}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="wb2-empty">
          <Icon name="check" size={20} />
          <b>{filter === "all" ? "Nothing needs you right now" : "Nothing of that kind right now"}</b>
          <em>
            {filter === "all"
              ? "The month is confirmed as far as it goes."
              : "The rest of the queue is under Everything."}
          </em>
        </div>
      ) : (
        <UrgentBody
          overdue={shown
            .filter((r) => r.reason === "overdue")
            .map((r) => <Row key={r.key} r={r} />)}
          soon={shown
            .filter((r) => r.reason !== "overdue" && r.reason !== "task")
            .map((r) => <Row key={r.key} r={r} />)}
          tasks={shown
            .filter((r) => r.reason === "task")
            .map((r) => (
              <TaskRow
                key={r.key}
                title={r.label ?? r.headline}
                who={r.also[0] ?? null}
                due={r.headline}
                tone={r.daysOver && r.daysOver > 0 ? "dan" : "warn"}
                busy={busy}
                onDone={() => {
                  const id = r.taskId!;
                  run(
                    () => completeTask(id),
                    `Done — ${r.label}`,
                    undoable(() => reopenTask(id))
                  );
                }}
              />
            ))}
        />
      )}
    </>
  );

  function Row({ r }: { r: UrgentRow }) {
    const openable = !!r.visitId;
    return (
      <div
        className={"wb2-ur" + (openable ? " can-open" : "")}
        data-sev={r.severity === "danger" ? "dan" : "warn"}
        role={openable ? "button" : undefined}
        tabIndex={openable ? 0 : undefined}
        aria-label={openable ? `Open ${r.clientName} — ${r.label}` : undefined}
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
          <b>{r.reason === "flag" ? r.label ?? r.headline : `${r.clientName} — ${r.label}`}</b>
          {r.reason === "flag" ? (
            <em>Raised from a note — stays up until somebody clears it.</em>
          ) : (
            <em>
              {r.siteLabel ? `${r.siteLabel} · ` : ""}
              {r.reason === "overdue"
                ? r.action === "close_out"
                  ? "placed — did it run?"
                  : "book it in to get it moving"
                : "the row clears itself once it's confirmed"}
            </em>
          )}
        </div>
        <RowAction r={r} />
      </div>
    );
  }

  function RowAction({ r }: { r: UrgentRow }) {
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();

    if (r.reason === "flag") {
      return (
        <button
          className="pbtn ghost"
          disabled={busy}
          onClick={(e) => {
            stop(e);
            const id = r.flagId!;
            run(
              () => clearFlag(id),
              "Flag cleared",
              undoable(() => restoreFlag(id))
            );
          }}
        >
          Clear
        </button>
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
              `${word} confirmed — ${r.clientName}`,
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
          aria-label={`Assign a technician — ${r.clientName}`}
          onClick={stop}
          onChange={(e) => {
            stop(e);
            const staffId = e.target.value;
            if (!staffId) return;
            const id = r.visitId!;
            const name = staff.find((s) => s.id === staffId)?.name ?? "Assigned";
            run(
              () => assignVisitTech(id, staffId),
              `${name} assigned — ${r.clientName}`,
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

    // overdue: the remedy depends on whether a plan exists (bookedDate)
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
