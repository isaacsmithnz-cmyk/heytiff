"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { WbModal } from "./wb-modal";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import {
  PROJECT_STAGES,
  checklistProgress,
  leftBehindFor,
  stageAdvice,
  stageIndex,
} from "@/lib/workboard/stages";
import type { JobSearchHit, ProjectDetail } from "@/lib/workboard/projects-query";
import type { IssueRow, ProjectEntry } from "@/lib/workboard/notes-query";
import type { ProjectBoardVisit } from "@/lib/workboard/projects-board-query";
import type { BoardTech } from "@/lib/workboard/board-query";
import { NoteCapture } from "./note-capture";
import { ProjectTripSheet } from "./board/project-trip-sheet";
import { ToastHost, useBoardToasts } from "./board/toasts";
import {
  GATE_LABEL,
  agoLabel,
  projectMissingOf,
  projectPlacedDayOf,
  untilLabel,
} from "./board/derive";
import {
  addChecklistItem,
  addEquipment,
  attachJob,
  detachJob,
  listDesignOptions,
  removeChecklistItem,
  removeEquipment,
  searchJobs,
  setEquipmentManualLeft,
  setProjectDesign,
  setProjectStage,
  setProjectStatus,
  toggleChecklistItem,
  updateProjectMeta,
} from "@/app/actions/workboard";
import {
  clearProjectBlocked,
  createProjectVisit,
  setProjectBlocked,
} from "@/app/actions/workboard-projects";

/* One project, stacked cards — the whole start-to-finish story on one page,
   now in the redesigned board's language: the stage is manual but
   checklist-AWARE (a completed section offers the move; advancing past
   unticked items warns and never blocks — decision P5), Blocked is a
   first-class state with a reason and a who (P4), and the trips the crew
   actually drives live here with their gates, bring lists and close-outs —
   the same rows the board shows, from the same loader, so the two can never
   disagree.

   Ticking is for everyone on the board; SHAPING is offered only to managers
   — and the server re-decides both, so these flags only decide what's drawn. */

export function ProjectDetailScreen({
  project,
  trips,
  staff,
  today,
  manage,
  sm8Connected,
  entries,
  issues,
  voiceEnabled,
}: {
  project: ProjectDetail;
  trips: ProjectBoardVisit[];
  staff: BoardTech[];
  today: string;
  manage: boolean;
  sm8Connected: boolean;
  entries: ProjectEntry[];
  issues: IssueRow[];
  voiceEnabled: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [addingEquip, setAddingEquip] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [tripSheet, setTripSheet] = useState<{ visitId: string; closeOut: boolean } | null>(null);
  const { toasts, toast, dismiss } = useBoardToasts();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok && res.error) setError(res.error);
      router.refresh();
    });
  };

  const progress = checklistProgress(project.checklist);
  const sections = useMemo(() => {
    const by = new Map<string, ProjectDetail["checklist"]>();
    for (const item of project.checklist) {
      (by.get(item.section) ?? by.set(item.section, []).get(item.section)!).push(item);
    }
    return [...by.entries()];
  }, [project.checklist]);

  const live = project.status === "active" || project.status === "blocked";
  const sheetTrip = tripSheet ? trips.find((t) => t.id === tripSheet.visitId) ?? null : null;
  const openTrips = trips.filter((t) => t.status === "upcoming" || t.status === "booked");
  const nextTripFor = (v: { id: string; dueDate: string }) => {
    const later = openTrips
      .filter((o) => o.id !== v.id && o.dueDate >= v.dueDate)
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    return later[0] ? { id: later[0].id, label: later[0].label } : null;
  };

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="v2head" style={{ marginBottom: 14 }}>
            <div style={{ minWidth: 0 }}>
              <Link href="/dashboard/workboard" className="int-back">
                <Icon name="chevL" size={15} />
                Workboard
              </Link>
              <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em", margin: "10px 0 0" }}>
                {project.name}
              </h1>
              <p className="int-lede" style={{ margin: "6px 0 0" }}>
                {[project.clientName, project.siteLabel, project.siteAddress]
                  .filter(Boolean)
                  .join(" · ") || "No client details yet"}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {/* the one capture pill, docked by the header like every other
                  screen (D15) — notes here land on THIS project, and taking
                  a note is never a manage-tier act */}
              <NoteCapture
                target={{ kind: "project", id: project.id }}
                targetLabel={project.name}
                voiceEnabled={voiceEnabled}
              />
              {manage && <StatusCluster />}
              {manage && (
                <button className="pbtn ghost" onClick={() => setEditingMeta(true)}>
                  <Icon name="edit" size={15} />
                  Edit
                </button>
              )}
            </div>
          </div>

          {error && <div className="int-note bad">{error}</div>}

          {project.status === "blocked" && (
            <div className="int-note bad">
              <b>Blocked{project.blockedOn ? ` on ${project.blockedOn}` : ""}</b>
              {project.blockedReason ? ` — ${project.blockedReason}` : ""}
              {project.blockedAt ? ` · since ${fmtAuWeekdayDayMonth(project.blockedAt.slice(0, 10))}` : ""}
              {manage && (
                <button
                  className="pbtn ghost"
                  style={{ marginLeft: 10 }}
                  disabled={busy}
                  onClick={() => run(() => clearProjectBlocked(project.id))}
                >
                  Unblock
                </button>
              )}
            </div>
          )}
          {project.status === "on_hold" && (
            <div className="int-note">
              On hold — its trips sit quiet on the board until it resumes.
            </div>
          )}
          {project.status === "done" && (
            <div className="int-note">Closed — it lives under the board&apos;s Completed tab.</div>
          )}
          {project.status === "archived" && (
            <div className="int-note">Archived — hidden from the board entirely.</div>
          )}

          <StageCard />
          <TripsCard />

          {/* ── checklist ── */}
          <div className="card2">
            <div className="c2h">
              <span className="ci">
                <Icon name="check" size={19} />
              </span>
              <div>
                <b>Checklist</b>
                <em>
                  {progress.done}/{progress.total} ticked — ticks record who and when.
                </em>
              </div>
            </div>
            <div className="wb-bar" style={{ marginBottom: 14 }}>
              <span style={{ width: `${progress.percent}%` }} />
            </div>
            {sections.map(([section, items]) => (
              <ChecklistSection
                key={section}
                section={section}
                items={items}
                manage={manage}
                busy={busy}
                onToggle={(id, done) => run(() => toggleChecklistItem(id, done))}
                onRemove={(id) => run(() => removeChecklistItem(id))}
                onAdd={(label) => run(() => addChecklistItem(project.id, section, label))}
              />
            ))}
            {manage && sections.length === 0 && (
              <p className="int-hint">No items yet — add the first below.</p>
            )}
            {manage && (
              <NewSectionAdder
                onAdd={(section, label) => run(() => addChecklistItem(project.id, section, label))}
                busy={busy}
              />
            )}
          </div>

          {/* ── equipment / left on site ── */}
          <div className="card2">
            <div className="c2h">
              <span className="ci">
                <Icon name="box" size={19} />
              </span>
              <div>
                <b>Equipment on site</b>
                <em>What was installed or left behind — and whether its manual stayed.</em>
              </div>
              {manage && (
                <button className="pbtn ghost" style={{ marginLeft: "auto" }} onClick={() => setAddingEquip(true)}>
                  <Icon name="plus" size={15} />
                  Add
                </button>
              )}
            </div>
            {project.equipment.length === 0 ? (
              <p className="int-hint">Nothing recorded yet.</p>
            ) : (
              project.equipment.map((e) => (
                <div className="wb-row" key={e.id}>
                  <span className="wb-who">
                    <b>{e.description}</b>
                    {(e.model || e.serial) && (
                      <em>
                        {" "}
                        · {[e.model, e.serial && `s/n ${e.serial}`].filter(Boolean).join(" · ")}
                      </em>
                    )}
                    {e.locationNote && <em> · {e.locationNote}</em>}
                  </span>
                  <button
                    className={"wb-chip" + (e.manualLeft ? " on" : "")}
                    disabled={busy}
                    onClick={() => run(() => setEquipmentManualLeft(e.id, !e.manualLeft))}
                    title="Tap when the manual is with the customer"
                  >
                    {e.manualLeft ? "Manual left ✓" : "Manual not left"}
                  </button>
                  {manage && (
                    <button
                      className="fl-x"
                      aria-label="Remove equipment"
                      disabled={busy}
                      onClick={() => run(() => removeEquipment(e.id))}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {/* ── jobs ── */}
          <div className="card2">
            <div className="c2h">
              <span className="ci">
                <Icon name="servicem8" size={19} />
              </span>
              <div>
                <b>Jobs on this project</b>
                <em>
                  {sm8Connected
                    ? "Linked ServiceM8 jobs carry their live status and bookings."
                    : "Typed job numbers — linking goes live once ServiceM8 is connected."}
                </em>
              </div>
              {manage && (
                <button className="pbtn ghost" style={{ marginLeft: "auto" }} onClick={() => setAttaching(true)}>
                  <Icon name="plus" size={15} />
                  Attach job
                </button>
              )}
            </div>
            {project.jobs.length === 0 ? (
              <p className="int-hint">No jobs attached yet.</p>
            ) : (
              project.jobs.map((j) => (
                <div className="wb-row" key={j.id}>
                  <span className="wb-chip">#{j.jobNumber}</span>
                  <span className="wb-chip">{j.role}</span>
                  <span className="wb-who">
                    {j.mirror ? (
                      <>
                        <b>{j.mirror.status ?? "—"}</b>
                        {j.mirror.suburb && <em> · {j.mirror.suburb}</em>}
                        {j.mirror.nextBooking && (
                          <em>
                            {" "}
                            · {bookingLabel(j.mirror.nextBooking.start)}
                            {j.mirror.nextBooking.staffName
                              ? ` — ${j.mirror.nextBooking.staffName}`
                              : ""}
                          </em>
                        )}
                        {j.mirror.checklist && j.mirror.checklist.total > 0 && (
                          <em>
                            {" "}
                            · SM8 list {j.mirror.checklist.done}/{j.mirror.checklist.total}
                          </em>
                        )}
                      </>
                    ) : (
                      <em>{j.provider ? "Not in the mirror yet" : "Typed by hand"}</em>
                    )}
                  </span>
                  {j.mirror?.contacts[0] && (
                    <span className="wb-tech">
                      {j.mirror.contacts[0].name}
                      {j.mirror.contacts[0].phone ? ` · ${j.mirror.contacts[0].phone}` : ""}
                    </span>
                  )}
                  {manage && (
                    <button
                      className="fl-x"
                      aria-label="Detach job"
                      disabled={busy}
                      onClick={() => run(() => detachJob(j.id))}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {entries.filter((e) => e.kind === "progress").length > 0 && (
            <div className="card2">
              <div className="c2h">
                <span className="ci">
                  <Icon name="activity" size={19} />
                </span>
                <div>
                  <b>Site journal</b>
                  <em>What was done and found, dated as it happened.</em>
                </div>
              </div>
              {entries
                .filter((e) => e.kind === "progress")
                .map((e) => (
                  <div className="wb-row" key={e.id}>
                    <span className="wb-time">{fmtAuWeekdayDayMonth(e.entryDate)}</span>
                    <span className="wb-who">{e.body}</span>
                  </div>
                ))}
            </div>
          )}

          {entries.filter((e) => e.kind === "commissioning").length > 0 && (
            <div className="card2">
              <div className="c2h">
                <span className="ci">
                  <Icon name="gauge" size={19} />
                </span>
                <div>
                  <b>Commissioning</b>
                  <em>Readings and settings, as they were recorded on site.</em>
                </div>
              </div>
              {entries
                .filter((e) => e.kind === "commissioning")
                .map((e) => (
                  <div className="wb-row" key={e.id}>
                    <span className="wb-time">{fmtAuWeekdayDayMonth(e.entryDate)}</span>
                    <span className="wb-who">{e.body}</span>
                  </div>
                ))}
            </div>
          )}

          {issues.length > 0 && (
            <div className="card2">
              <div className="c2h">
                <span className="ci">
                  <Icon name="alert" size={19} />
                </span>
                <div>
                  <b>Recurring issues</b>
                  <em>Logged more than once — the count is the point.</em>
                </div>
              </div>
              {issues.map((i) => (
                <div className={"wb-row" + (i.occurrences > 1 ? " wb-pulse" : "")} key={i.id}>
                  <span className={"wb-chip" + (i.occurrences > 1 ? " bad" : "")}>
                    ×{i.occurrences}
                  </span>
                  <span className="wb-who">
                    <b>{i.summary}</b>
                    {i.equipmentRef && <em> · {i.equipmentRef}</em>}
                  </span>
                  <span className="wb-tech">
                    {i.occurrences > 1
                      ? `${fmtAuWeekdayDayMonth(i.firstSeen)} → ${fmtAuWeekdayDayMonth(i.lastSeen)}`
                      : fmtAuWeekdayDayMonth(i.lastSeen)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* ── design ── */}
          <DesignCard
            designId={project.designId}
            designName={project.designName}
            manage={manage}
            busy={busy}
            onSet={(id) => run(() => setProjectDesign(project.id, id))}
          />

          {/* ── notes ── */}
          <NotesCard
            notes={project.notes}
            manage={manage}
            busy={busy}
            onSave={(text) => run(() => updateProjectMeta(project.id, { notes: text }))}
          />
        </div>
      </div>

      {attaching && (
        <AttachJobModal
          sm8Connected={sm8Connected}
          onClose={() => setAttaching(false)}
          onAttach={(input) => {
            setAttaching(false);
            run(() => attachJob(project.id, input));
          }}
        />
      )}
      {addingEquip && (
        <AddEquipmentModal
          onClose={() => setAddingEquip(false)}
          onAdd={(input) => {
            setAddingEquip(false);
            run(() => addEquipment(project.id, input));
          }}
        />
      )}
      {editingMeta && (
        <EditMetaModal
          project={project}
          onClose={() => setEditingMeta(false)}
          onSave={(patch) => {
            setEditingMeta(false);
            run(() => updateProjectMeta(project.id, patch));
          }}
        />
      )}
      {blocking && (
        <BlockModal
          onClose={() => setBlocking(false)}
          onBlock={(reason, on) => {
            setBlocking(false);
            run(() => setProjectBlocked(project.id, { reason, on }));
          }}
        />
      )}

      {sheetTrip && (
        <ProjectTripSheet
          key={sheetTrip.id}
          visit={sheetTrip}
          today={today}
          staff={staff}
          manage={manage}
          connected={sm8Connected}
          nextTrip={nextTripFor(sheetTrip)}
          startClosing={tripSheet?.closeOut ?? false}
          onToast={toast}
          onClose={() => setTripSheet(null)}
        />
      )}

      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </div>
  );

  /* ── header status controls ── */

  function StatusCluster() {
    if (project.status === "active" || project.status === "blocked") {
      return (
        <>
          {project.status === "active" && (
            <button className="pbtn ghost" disabled={busy} onClick={() => setBlocking(true)}>
              Block…
            </button>
          )}
          <button
            className="pbtn ghost"
            disabled={busy}
            onClick={() => run(() => setProjectStatus(project.id, "on_hold"))}
          >
            Put on hold
          </button>
          {project.stage === "Complete" && (
            <button
              className="pbtn ghost"
              disabled={busy}
              onClick={() => run(() => setProjectStatus(project.id, "done"))}
            >
              Mark done
            </button>
          )}
        </>
      );
    }
    if (project.status === "on_hold") {
      return (
        <button
          className="pbtn ghost"
          disabled={busy}
          onClick={() => run(() => setProjectStatus(project.id, "active"))}
        >
          Resume
        </button>
      );
    }
    if (project.status === "done") {
      return (
        <>
          <button
            className="pbtn ghost"
            disabled={busy}
            onClick={() => run(() => setProjectStatus(project.id, "active"))}
          >
            Reopen
          </button>
          <button
            className="pbtn ghost"
            disabled={busy}
            onClick={() => run(() => setProjectStatus(project.id, "archived"))}
          >
            Archive
          </button>
        </>
      );
    }
    return (
      <button
        className="pbtn ghost"
        disabled={busy}
        onClick={() => run(() => setProjectStatus(project.id, "active"))}
      >
        Reopen
      </button>
    );
  }

  /* ── stage — manual, checklist-aware (P5) ── */

  function StageCard() {
    const [pendingStage, setPendingStage] = useState<string | null>(null);
    const advice = stageAdvice(project.stage, project.checklist);
    const currentIdx = Math.max(stageIndex(project.stage), 0);

    const move = (target: string) => {
      setPendingStage(null);
      run(() => setProjectStage(project.id, target));
    };

    const tryMove = (target: string) => {
      if (!manage || busy || target === project.stage) return;
      // Backward is a correction, not an advance — it never warns.
      if (stageIndex(target) <= currentIdx) {
        move(target);
        return;
      }
      const owed = leftBehindFor(target, project.checklist);
      if (owed === 0) {
        move(target);
        return;
      }
      setPendingStage(target);
    };

    return (
      <div className="card2">
        <div className="c2h">
          <span className="ci">
            <Icon name="activity" size={19} />
          </span>
          <div>
            <b>Stage</b>
            <em>
              {manage
                ? "A person moves the stage — the checklist informs, it never decides."
                : "Where this project is up to."}
            </em>
          </div>
          {advice.gateSection && advice.sectionTotal > 0 && (
            <span
              className={"wb2-chip" + (advice.sectionDone === advice.sectionTotal ? " ok" : "")}
              style={{ marginLeft: "auto" }}
            >
              {advice.gateSection} {advice.sectionDone}/{advice.sectionTotal}
            </span>
          )}
        </div>
        <div className="wb-stepper">
          {PROJECT_STAGES.map((s, i) => {
            const state = i < currentIdx ? "past" : i === currentIdx ? "now" : "todo";
            return (
              <button
                key={s}
                className={`wb-step ${state}`}
                disabled={!manage || busy}
                onClick={() => tryMove(s)}
              >
                {s}
              </button>
            );
          })}
        </div>

        {pendingStage && (
          <div className="int-note bad" style={{ marginTop: 12 }}>
            {leftBehindFor(pendingStage, project.checklist)} checklist{" "}
            {leftBehindFor(pendingStage, project.checklist) === 1 ? "item" : "items"} unticked
            behind {pendingStage} — the record stays honest either way.
            <button
              className="pbtn ghost"
              style={{ marginLeft: 10 }}
              disabled={busy}
              onClick={() => move(pendingStage)}
            >
              Advance anyway
            </button>
            <button
              className="pbtn ghost"
              style={{ marginLeft: 6 }}
              disabled={busy}
              onClick={() => setPendingStage(null)}
            >
              Not yet
            </button>
          </div>
        )}

        {manage && live && !pendingStage && advice.nudge && advice.next && (
          <div className="int-note" style={{ marginTop: 12 }}>
            {advice.gateSection} is all ticked — move to {advice.next}?
            <button
              className="pbtn ghost"
              style={{ marginLeft: 10 }}
              disabled={busy}
              onClick={() => move(advice.next!)}
            >
              Move to {advice.next}
            </button>
          </div>
        )}
      </div>
    );
  }

  /* ── trips — the same rows the board shows ── */

  function TripsCard() {
    const [adding, setAdding] = useState(false);
    const [label, setLabel] = useState("");
    const [around, setAround] = useState("");
    const [day, setDay] = useState("");

    const add = () => {
      const name = label.trim();
      if (!name || !around) return;
      setAdding(false);
      setLabel("");
      setAround("");
      setDay("");
      run(() => createProjectVisit(project.id, { label: name, dueDate: around, bookedDate: day || null }));
    };

    const done = trips
      .filter((t) => t.status === "done" || t.status === "skipped")
      .sort((a, b) => ((a.completedAt ?? "") < (b.completedAt ?? "") ? 1 : -1));

    return (
      <div className="card2">
        <div className="c2h">
          <span className="ci">
            <Icon name="calendar" size={19} />
          </span>
          <div>
            <b>Trips to site</b>
            <em>Each trip carries its own gates, crew and bring list — close it out as it runs.</em>
          </div>
          {manage && live && (
            <button
              className="pbtn ghost"
              style={{ marginLeft: "auto" }}
              onClick={() => setAdding((v) => !v)}
            >
              <Icon name="plus" size={15} />
              Add a trip
            </button>
          )}
        </div>

        {adding && (
          <div className="wb2-triprow add">
            <input
              className="wb2-fi"
              autoFocus
              placeholder="What's the trip for — “Rough-in day 1”"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
            />
            <label className="wb2-fl">
              Around
              <input type="date" className="wb2-fi" value={around} onChange={(e) => setAround(e.target.value)} />
            </label>
            <label className="wb2-fl">
              Day booked
              <input type="date" className="wb2-fi" value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
            <button className="pbtn" disabled={busy || !label.trim() || !around} onClick={add}>
              Add the trip
            </button>
          </div>
        )}

        {openTrips.length === 0 && done.length === 0 && !adding && (
          <p className="int-hint">
            No trips yet{manage && live ? " — add the first and its bring list starts there." : "."}
          </p>
        )}

        {openTrips.map((t) => {
          const missing = projectMissingOf(t);
          const placed = projectPlacedDayOf(t);
          const rel = untilLabel(t.dueDate, today);
          return (
            <div
              key={t.id}
              className="wb2-triprow can-open"
              role="button"
              tabIndex={0}
              aria-label={`Open ${t.label}`}
              data-sev={t.dueDate < today ? "over" : missing.length && rel.tone ? "soon" : undefined}
              onClick={() => setTripSheet({ visitId: t.id, closeOut: false })}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                  e.preventDefault();
                  setTripSheet({ visitId: t.id, closeOut: false });
                }
              }}
            >
              <div className="wb2-trt">
                <b>{t.label}</b>
                <em>
                  around {fmtAuWeekdayDayMonth(t.dueDate)}
                  {t.jobNumber ? ` · #${t.jobNumber}` : ""}
                  {t.bringList.length
                    ? ` · bring ${t.bringList.filter((i) => i.packed).length}/${t.bringList.length}`
                    : ""}
                </em>
              </div>
              <div className="wb2-trd">
                {placed ? (
                  <>
                    <b>{fmtAuWeekdayDayMonth(placed)}</b>
                    <em>{t.techs.length ? t.techs.map((x) => x.name).join(", ") : "nobody assigned yet"}</em>
                  </>
                ) : (
                  <span className={"wb2-chip " + (t.dueDate < today ? "dan" : "warn")}>
                    {t.dueDate < today ? rel.t : "Not placed"}
                  </span>
                )}
              </div>
              <div className="wb2-trck">
                {missing.length === 0 ? (
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
                        title={`${GATE_LABEL[g]} — ${on ? "confirmed" : "not yet"}`}
                      >
                        {on ? <Icon name="check" size={12} /> : <i />}
                      </span>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}

        {done.length > 0 && (
          <>
            <div className="wb2-wkhd">
              Ran <em>{done.length}</em>
            </div>
            {done.map((t) => (
              <div
                key={t.id}
                className="wb2-triprow can-open donerow"
                role="button"
                tabIndex={0}
                aria-label={`Open ${t.label}`}
                onClick={() => setTripSheet({ visitId: t.id, closeOut: false })}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                    e.preventDefault();
                    setTripSheet({ visitId: t.id, closeOut: false });
                  }
                }}
              >
                <div className="wb2-trt">
                  <b>{t.label}</b>
                  <em>{t.completionNote || "no close-out note"}</em>
                </div>
                <div className="wb2-trd">
                  <b>{t.completedAt ? fmtAuWeekdayDayMonth(t.completedAt) : "—"}</b>
                  <em>
                    {t.status === "skipped"
                      ? "skipped"
                      : t.completedAt
                        ? `ran ${agoLabel(t.completedAt, today)}`
                        : ""}
                  </em>
                </div>
                <div className="wb2-trck">
                  <span className={"wb2-chip" + (t.status === "done" ? " ok" : "")}>
                    {t.status === "done"
                      ? t.actualHours !== null
                        ? `${t.actualHours} h on site`
                        : "Done"
                      : "Skipped"}
                  </span>
                </div>
              </div>
            ))}
          </>
        )}

        {project.hoursBudget !== null && (
          <p className="int-hint" style={{ marginTop: 8 }}>
            {project.hoursLogged} of {project.hoursBudget} h used
            {project.hoursLogged > project.hoursBudget ? " — over the labour budget." : "."}
          </p>
        )}
      </div>
    );
  }
}

/** '2026-07-29 07:30:00' → '7:30am Wed 29/7' — string maths on the mirror's
    wall-clock value, no Date() reinterpretation. */
function bookingLabel(naive: string): string {
  const [d, t] = [naive.slice(0, 10), naive.slice(11, 16)];
  const h = parseInt(t.slice(0, 2), 10);
  const hh = h % 12 === 0 ? 12 : h % 12;
  const [y, m, day] = d.split("-").map((x) => parseInt(x, 10));
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${hh}:${t.slice(3, 5)}${h < 12 ? "am" : "pm"} ${dows[dow]} ${day}/${m}`;
}

/* ── pieces ── */

function BlockModal({
  onClose,
  onBlock,
}: {
  onClose: () => void;
  onBlock: (reason: string, on: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [on, setOn] = useState("");

  return (
    <WbModal
      title="Block the project"
      sub="A blocked job wants to move and can't — say who it's waiting on, so chasing is one call."
      onClose={onClose}
    >
      <div className="fl-grid">
        <label className="fl-f span">
          <span>
            Waiting on<i>*</i>
          </span>
          <input
            value={on}
            onChange={(e) => setOn(e.target.value)}
            placeholder="Dave the sparky · the builder · council"
            autoFocus
          />
        </label>
        <label className="fl-f span">
          <span>
            Why<i>*</i>
          </span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Switchboard upgrade not done"
          />
        </label>
      </div>
      <div className="fl-foot">
        <button className="pbtn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="pbtn primary"
          disabled={!reason.trim() || !on.trim()}
          onClick={() => onBlock(reason, on)}
        >
          Block it
        </button>
      </div>
    </WbModal>
  );
}

function ChecklistSection({
  section,
  items,
  manage,
  busy,
  onToggle,
  onRemove,
  onAdd,
}: {
  section: string;
  items: ProjectDetail["checklist"];
  manage: boolean;
  busy: boolean;
  onToggle: (id: string, done: boolean) => void;
  onRemove: (id: string) => void;
  onAdd: (label: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");

  return (
    <div className="wb-day">
      <div className="wb-dayhead">
        {section}
        {manage && (
          <button
            className="wb-add"
            onClick={() => setAdding((v) => !v)}
            aria-label={`Add to ${section}`}
          >
            <Icon name="plus" size={12} />
          </button>
        )}
      </div>
      {items.map((item) => (
        <div className="wb-row" key={item.id}>
          <button
            className={"wb-tick" + (item.done ? " done" : "")}
            disabled={busy}
            onClick={() => onToggle(item.id, !item.done)}
            aria-label={item.done ? `Untick ${item.label}` : `Tick ${item.label}`}
          >
            <Icon name="check" size={13} />
          </button>
          <span className="wb-who" style={item.done ? { opacity: 0.55 } : undefined}>
            {item.label}
          </span>
          {manage && (
            <button
              className="fl-x"
              aria-label="Remove item"
              disabled={busy}
              onClick={() => onRemove(item.id)}
            >
              <Icon name="x" size={13} />
            </button>
          )}
        </div>
      ))}
      {adding && (
        <div className="wb-row">
          <input
            className="wb-inline"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="New item…"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && label.trim()) {
                onAdd(label);
                setLabel("");
                setAdding(false);
              }
            }}
          />
          <button
            className="pbtn ghost"
            disabled={busy || !label.trim()}
            onClick={() => {
              onAdd(label);
              setLabel("");
              setAdding(false);
            }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

function NewSectionAdder({
  onAdd,
  busy,
}: {
  onAdd: (section: string, label: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState("");
  const [label, setLabel] = useState("");

  if (!open) {
    return (
      <button className="pbtn ghost" onClick={() => setOpen(true)} style={{ marginTop: 8 }}>
        <Icon name="plus" size={15} />
        New section
      </button>
    );
  }
  return (
    <div className="wb-row" style={{ marginTop: 8 }}>
      <input
        className="wb-inline"
        value={section}
        onChange={(e) => setSection(e.target.value)}
        placeholder="Section — e.g. Defects"
      />
      <input
        className="wb-inline"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="First item"
      />
      <button
        className="pbtn ghost"
        disabled={busy || !section.trim() || !label.trim()}
        onClick={() => {
          onAdd(section, label);
          setSection("");
          setLabel("");
          setOpen(false);
        }}
      >
        Add
      </button>
    </div>
  );
}

function DesignCard({
  designId,
  designName,
  manage,
  busy,
  onSet,
}: {
  designId: string | null;
  designName: string | null;
  manage: boolean;
  busy: boolean;
  onSet: (id: string | null) => void;
}) {
  const [options, setOptions] = useState<{ id: string; name: string }[] | null>(null);
  const [picking, setPicking] = useState(false);

  const openPicker = async () => {
    setPicking(true);
    if (options === null) setOptions(await listDesignOptions());
  };

  return (
    <div className="card2">
      <div className="c2h">
        <span className="ci">
          <Icon name="wind" size={19} />
        </span>
        <div>
          <b>Design</b>
          <em>
            {designId
              ? designName ?? "A Studio design is linked."
              : "Link the Studio design behind this install."}
          </em>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {designId && (
            <Link href="/dashboard/studio" className="pbtn ghost">
              Open Studio
            </Link>
          )}
          {manage &&
            (picking ? (
              <>
                <select
                  className="wb-select"
                  disabled={busy || options === null}
                  defaultValue={designId ?? ""}
                  onChange={(e) => {
                    onSet(e.target.value || null);
                    setPicking(false);
                  }}
                >
                  <option value="">No design</option>
                  {(options ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <button className="pbtn ghost" onClick={() => setPicking(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="pbtn ghost" onClick={openPicker}>
                {designId ? "Change" : "Link design"}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

function NotesCard({
  notes,
  manage,
  busy,
  onSave,
}: {
  notes: string | null;
  manage: boolean;
  busy: boolean;
  onSave: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(notes ?? "");

  return (
    <div className="card2">
      <div className="c2h">
        <span className="ci">
          <Icon name="note" size={19} />
        </span>
        <div>
          <b>Notes</b>
          <em>Anything the next person on this job should know.</em>
        </div>
        {manage && !editing && (
          <button
            className="pbtn ghost"
            style={{ marginLeft: "auto" }}
            onClick={() => {
              setText(notes ?? "");
              setEditing(true);
            }}
          >
            <Icon name="edit" size={15} />
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <>
          <textarea
            className="wb-notes"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
          />
          <div className="fl-foot">
            <button className="pbtn ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
            <button
              className="pbtn primary"
              disabled={busy}
              onClick={() => {
                onSave(text);
                setEditing(false);
              }}
            >
              Save notes
            </button>
          </div>
        </>
      ) : notes ? (
        <p className="wb-notetext">{notes}</p>
      ) : (
        <p className="int-hint">Nothing yet.</p>
      )}
    </div>
  );
}

function AttachJobModal({
  sm8Connected,
  onClose,
  onAttach,
}: {
  sm8Connected: boolean;
  onClose: () => void;
  onAttach: (input: { jobNumber?: string; remoteId?: string; role?: string }) => void;
}) {
  const [role, setRole] = useState("install");
  const [jobNumber, setJobNumber] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<JobSearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  const doSearch = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    setHits(await searchJobs(q));
    setSearching(false);
  };

  return (
    <WbModal
      title="Attach a job"
      sub={sm8Connected ? "Search ServiceM8, or type a number" : "Type the job number"}
      onClose={onClose}
      wide
    >
      <div className="fl-grid">
        <label className="fl-f">
          <span>Role on this project</span>
          <select className="wb-select" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="quote">Quote</option>
            <option value="install">Install</option>
            <option value="variation">Variation</option>
            <option value="service">Service</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="fl-f">
          <span>Job number (typed)</span>
          <input
            value={jobNumber}
            onChange={(e) => setJobNumber(e.target.value)}
            placeholder="1042"
          />
        </label>
      </div>

      {sm8Connected && (
        <>
          <label className="fl-f span" style={{ marginTop: 10 }}>
            <span>Or search ServiceM8 — number or client</span>
            <input
              value={query}
              onChange={(e) => doSearch(e.target.value)}
              placeholder="1042, or “Smith”…"
            />
          </label>
          {searching && <p className="int-hint">Searching…</p>}
          {hits.map((h) => (
            <button
              key={h.remoteId}
              className="wb-row wb-hit"
              onClick={() => onAttach({ remoteId: h.remoteId, role })}
            >
              <span className="wb-chip">#{h.jobNumber ?? "—"}</span>
              <span className="wb-who">
                <b>{h.clientName ?? "—"}</b>
                {h.suburb && <em> · {h.suburb}</em>}
              </span>
              {h.status && <span className="wb-chip">{h.status}</span>}
              {h.linkedTo.length > 0 && (
                <span className="wb-chip bad" title={h.linkedTo.join(", ")}>
                  on {h.linkedTo.length} project{h.linkedTo.length === 1 ? "" : "s"}
                </span>
              )}
            </button>
          ))}
        </>
      )}

      <div className="fl-foot">
        <button className="pbtn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="pbtn primary"
          disabled={!jobNumber.trim()}
          onClick={() => onAttach({ jobNumber, role })}
        >
          Attach typed number
        </button>
      </div>
    </WbModal>
  );
}

function AddEquipmentModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (input: {
    description: string;
    model?: string;
    serial?: string;
    locationNote?: string;
    notes?: string;
  }) => void;
}) {
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [locationNote, setLocationNote] = useState("");

  return (
    <WbModal title="Add equipment" sub="What's on site, and where" onClose={onClose}>
      <div className="fl-grid">
        <label className="fl-f span">
          <span>
            Description<i>*</i>
          </span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ducted indoor unit"
            autoFocus
          />
        </label>
        <label className="fl-f">
          <span>Model</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="PEAD-M100" />
        </label>
        <label className="fl-f">
          <span>Serial</span>
          <input value={serial} onChange={(e) => setSerial(e.target.value)} />
        </label>
        <label className="fl-f span">
          <span>Where on site</span>
          <input
            value={locationNote}
            onChange={(e) => setLocationNote(e.target.value)}
            placeholder="Roof space above hallway"
          />
        </label>
      </div>
      <div className="fl-foot">
        <button className="pbtn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="pbtn primary"
          disabled={!description.trim()}
          onClick={() => onAdd({ description, model, serial, locationNote })}
        >
          Add equipment
        </button>
      </div>
    </WbModal>
  );
}

function EditMetaModal({
  project,
  onClose,
  onSave,
}: {
  project: ProjectDetail;
  onClose: () => void;
  onSave: (patch: {
    name?: string;
    clientName?: string | null;
    siteLabel?: string | null;
    siteAddress?: string | null;
  }) => void;
}) {
  const [name, setName] = useState(project.name);
  const [clientName, setClientName] = useState(project.clientName ?? "");
  const [siteLabel, setSiteLabel] = useState(project.siteLabel ?? "");
  const [siteAddress, setSiteAddress] = useState(project.siteAddress ?? "");

  return (
    <WbModal title="Edit project" onClose={onClose}>
      <div className="fl-grid">
        <label className="fl-f span">
          <span>
            Name<i>*</i>
          </span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="fl-f">
          <span>Client</span>
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </label>
        <label className="fl-f">
          <span>Site label</span>
          <input value={siteLabel} onChange={(e) => setSiteLabel(e.target.value)} />
        </label>
        <label className="fl-f span">
          <span>Site address</span>
          <input value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} />
        </label>
      </div>
      <div className="fl-foot">
        <button className="pbtn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="pbtn primary"
          disabled={!name.trim()}
          onClick={() =>
            onSave({ name, clientName, siteLabel, siteAddress })
          }
        >
          Save
        </button>
      </div>
    </WbModal>
  );
}
