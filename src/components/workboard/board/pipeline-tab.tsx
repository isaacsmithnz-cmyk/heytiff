"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { PROJECT_STAGES, stageIndex } from "@/lib/workboard/stages";
import { claimedLine, fmtAud } from "@/lib/workboard/project-money";
import { projectStateRow } from "@/lib/workboard/project-rules";
import type { BoardProject } from "@/lib/workboard/projects-board-query";
import { agoLabel } from "./derive";

/* Pipeline — the stage-grouped list (decision P1): a vertical run of stage
   groups in the trade's order, mirroring Upcoming's week groups. Inside a
   group trouble floats first, so a blocked rough-in can never hide under
   three healthy ones. The old funnel's "where do jobs bank up" survives as
   the group counts; the kanban that was considered is deliberately absent —
   HeyTiff has no horizontal motion anywhere. */

export function PipelineTab({
  projects,
  today,
  manage,
  onOpenProject,
}: {
  projects: BoardProject[];
  today: string;
  manage: boolean;
  /** A row opens the project CARD when the board offers one — the full
      screen stays a chip-door inside it. Without it, rows keep the route. */
  onOpenProject?: (projectId: string) => void;
}) {
  const groups = useMemo(() => {
    const live = projects.filter(
      (p) => p.status === "active" || p.status === "blocked" || p.status === "on_hold"
    );
    const byStage = new Map<string, BoardProject[]>();
    for (const p of live) {
      const list = byStage.get(p.stage) ?? [];
      list.push(p);
      byStage.set(p.stage, list);
    }
    const rank = (p: BoardProject): number => {
      const row = projectStateRow(
        {
          id: p.id,
          name: p.name,
          clientName: p.clientName,
          siteLabel: p.siteLabel,
          status: p.status,
          stage: p.stage,
          blockedReason: p.blockedReason,
          blockedOn: p.blockedOn,
          blockedAt: p.blockedAt,
          promisedFinish: p.promisedFinish,
          updatedAt: p.updatedAt,
          hoursBudget: p.hoursBudget,
          hoursLogged: p.hoursLogged,
        },
        today
      );
      if (row?.severity === "danger") return 0;
      if (row?.severity === "warn") return 1;
      if (p.status === "on_hold") return 3;
      return 2;
    };
    return [...PROJECT_STAGES]
      .map((stage) => ({
        stage,
        list: (byStage.get(stage) ?? []).sort(
          (a, b) => rank(a) - rank(b) || (a.updatedAt < b.updatedAt ? 1 : -1)
        ),
      }))
      .filter((g) => g.list.length > 0);
  }, [projects, today]);

  const total = groups.reduce((n, g) => n + g.list.length, 0);

  return (
    <>
      <div className="wb2-chd">
        <span className="wb2-ci blue">
          <Icon name="activity" size={19} />
        </span>
        <div>
          <b>Down the pipeline</b>
          <em>Every stage in the trade&apos;s order — trouble floats first inside each.</em>
        </div>
        <span className="wb2-chip">
          {total} {total === 1 ? "project" : "projects"} in flight
        </span>
        {manage && (
          <Link href="/dashboard/workboard/projects" className="pbtn ghost">
            <Icon name="plus" size={15} />
            New project
          </Link>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="wb2-empty">
          <Icon name="layers" size={20} />
          <b>Nothing in the pipeline</b>
          <em>
            {manage
              ? "Start a project under All projects — or import one from a ServiceM8 job."
              : "Projects land here as they're created."}
          </em>
        </div>
      ) : (
        groups.map((g) => (
          <div className="wb2-wkgrp" key={g.stage}>
            <div className="wb2-wkhd">
              {g.stage}
              <em>
                {g.list.length} {g.list.length === 1 ? "project" : "projects"}
              </em>
            </div>
            {g.list.map((p) => (
              <ProjectRow key={p.id} p={p} today={today} onOpen={onOpenProject} />
            ))}
          </div>
        ))
      )}
    </>
  );
}

function ProjectRow({
  p,
  today,
  onOpen,
}: {
  p: BoardProject;
  today: string;
  onOpen?: (projectId: string) => void;
}) {
  const state = projectStateRow(
    {
      id: p.id,
      name: p.name,
      clientName: p.clientName,
      siteLabel: p.siteLabel,
      status: p.status,
      stage: p.stage,
      blockedReason: p.blockedReason,
      blockedOn: p.blockedOn,
      blockedAt: p.blockedAt,
      promisedFinish: p.promisedFinish,
      updatedAt: p.updatedAt,
      hoursBudget: p.hoursBudget,
      hoursLogged: p.hoursLogged,
    },
    today
  );
  const idx = stageIndex(p.stage);
  /* Undefined money means the reader has no money access and none was loaded.
     "no budget set" would be a lie in that case — it describes the project,
     not the reader — so the column simply stays empty. */
  const money = p.money ? claimedLine(p.money) : null;

  const body = (
    <>
      <div className="wb2-trt">
        <b>{p.name}</b>
        <em>{[p.clientName, p.siteLabel].filter(Boolean).join(" · ") || "—"}</em>
      </div>

      <div className="wb2-plstage" aria-hidden="true" title={`Stage ${Math.max(idx + 1, 1)} of ${PROJECT_STAGES.length} — ${p.stage}`}>
        {PROJECT_STAGES.map((s, i) => (
          <i key={s} className={i < idx ? "past" : i === idx ? "now" : ""} />
        ))}
      </div>

      <div className="wb2-plprog">
        <span className="wb2-bar">
          <i style={{ width: `${p.progress.percent}%` }} />
        </span>
        <em>
          {p.progress.done}/{p.progress.total} ticked
        </em>
      </div>

      {/* The cell stays even when empty — it holds its grid column, so rows
          line up whether or not the person can see money. */}
      <div className="wb2-money wb2-plmoney">
        {money && p.money ? (
          <>
            <b>
              {fmtAud(p.money.claimedCents)} of {fmtAud(p.money.revisedTotalCents!)}
            </b>
            <em>
              {p.money.remainingCents !== null && p.money.remainingCents < 0
                ? `${fmtAud(-p.money.remainingCents)} over`
                : "claimed"}
            </em>
          </>
        ) : p.money ? (
          <em>no budget set</em>
        ) : null}
      </div>

      <div className="wb2-plchips">
        {p.status === "on_hold" && <span className="wb2-chip">On hold</span>}
        {state && (
          <span className={"wb2-chip " + (state.severity === "danger" ? "dan" : "warn")}>
            {state.reason === "blocked"
              ? `Blocked${p.blockedOn ? ` on ${p.blockedOn}` : ""}`
              : state.reason === "promise"
                ? "Promise slipping"
                : state.reason === "burn"
                  ? `${p.hoursLogged} of ${p.hoursBudget} h`
                  : "Gone quiet"}
          </span>
        )}
        {!state && p.status === "active" && (
          <span className="wb2-chip ok">Moving · {agoLabel(p.updatedAt.slice(0, 10), today)}</span>
        )}
      </div>
    </>
  );

  const sev = state ? (state.severity === "danger" ? "dan" : "warn") : undefined;
  /* STILL A LINK. A plain click opens the project CARD; a cmd/ctrl/shift
     click or a middle click keeps its browser meaning — new tab, copy link,
     prefetch — because turning the row into a button silently killed the
     open-three-projects-in-tabs triage a real <a> gives for free. */
  return (
    <Link
      href={`/dashboard/workboard/projects/${p.id}`}
      className="wb2-plrow"
      data-sev={sev}
      onClick={
        onOpen
          ? (e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              onOpen(p.id);
            }
          : undefined
      }
    >
      {body}
    </Link>
  );
}
