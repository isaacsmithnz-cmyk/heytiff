"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { setProjectStatus } from "@/app/actions/workboard";
import { claimedLine, fmtAud } from "@/lib/workboard/project-money";
import type { BoardProject } from "@/lib/workboard/projects-board-query";
import { agoLabel } from "./derive";

/* Completed, projects side — two folds that answer different questions:
   "Ready to close" (sitting at the Complete stage but never marked done —
   the un-closed loop this board exists to close) and the done list with its
   money settled or still owed. Marking done is one press with its own undo. */

export function ProjectCompletedTab({
  projects,
  today,
  manage,
  onToast,
}: {
  projects: BoardProject[];
  today: string;
  manage: boolean;
  onToast: (message: string, undo?: () => void | Promise<void>) => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();

  const { readyToClose, done } = useMemo(
    () => ({
      readyToClose: projects.filter(
        (p) => (p.status === "active" || p.status === "blocked") && p.stage === "Complete"
      ),
      done: projects
        .filter((p) => p.status === "done")
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    }),
    [projects]
  );

  const mark = (p: BoardProject, status: "done" | "active") => {
    start(async () => {
      await setProjectStatus(p.id, status);
      onToast(
        status === "done" ? `Project closed — ${p.name}` : `Reopened — ${p.name}`,
        async () => {
          await setProjectStatus(p.id, status === "done" ? "active" : "done");
          router.refresh();
        }
      );
      router.refresh();
    });
  };

  const moneyChip = (p: BoardProject) => {
    const m = p.money;
    if (m.revisedTotalCents === null) return null;
    if (m.remainingCents !== null && m.remainingCents > 0) {
      return <span className="wb2-chip warn">{fmtAud(m.remainingCents)} unclaimed</span>;
    }
    if (m.awaitingCents > 0) {
      return <span className="wb2-chip warn">{fmtAud(m.awaitingCents)} awaiting payment</span>;
    }
    return <span className="wb2-chip ok">Money settled</span>;
  };

  const row = (p: BoardProject, closing: boolean) => (
    <div className="wb2-dn" key={p.id}>
      <div className="wb2-dnt">
        <b>{p.name}</b>
        <em>{[p.clientName, p.siteLabel].filter(Boolean).join(" · ") || "—"}</em>
      </div>
      <div className="wb2-dnw">
        <b>{closing ? "At Complete" : `Closed ${agoLabel(p.updatedAt.slice(0, 10), today)}`}</b>
        <em>{claimedLine(p.money) ?? "no budget tracked"}</em>
      </div>
      <span className="wb2-dnact">
        {moneyChip(p)}
        {manage &&
          (closing ? (
            <button
              className="pbtn ghost"
              disabled={busy}
              onClick={() => mark(p, "done")}
            >
              Mark it done
            </button>
          ) : (
            <button className="pbtn ghost" disabled={busy} onClick={() => mark(p, "active")}>
              Reopen
            </button>
          ))}
        <Link href={`/dashboard/workboard/projects/${p.id}`} className="pbtn ghost">
          Open
        </Link>
      </span>
    </div>
  );

  return (
    <>
      <div className="wb2-chd">
        <span className="wb2-ci ok">
          <Icon name="check" size={19} />
        </span>
        <div>
          <b>Completed</b>
          <em>What&apos;s finished, what it claimed, and what&apos;s still owed on it.</em>
        </div>
        {readyToClose.length > 0 && (
          <span className="wb2-chip warn">
            {readyToClose.length} ready to close
          </span>
        )}
      </div>

      {readyToClose.length === 0 && done.length === 0 ? (
        <div className="wb2-empty">
          <Icon name="clock" size={20} />
          <b>Nothing finished yet</b>
          <em>Projects land here when they&apos;re marked done — money story attached.</em>
        </div>
      ) : (
        <div className="wb2-dnlist">
          {readyToClose.length > 0 && (
            <div className="wb2-wkhd warn">
              At Complete but not closed <em>{readyToClose.length}</em>
            </div>
          )}
          {readyToClose.map((p) => row(p, true))}
          {done.length > 0 && (
            <div className="wb2-wkhd">
              Done <em>{done.length}</em>
            </div>
          )}
          {done.map((p) => row(p, false))}
        </div>
      )}
    </>
  );
}
