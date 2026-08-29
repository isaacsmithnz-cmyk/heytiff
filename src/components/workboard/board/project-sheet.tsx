"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { ViewTabs, type ViewTab } from "@/components/shell/view-tabs";
import { fmtAuWeekdayDate, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { PROJECT_STAGES, stageIndex } from "@/lib/workboard/stages";
import { fmtAud } from "@/lib/workboard/project-money";
import { fmtMinutesAsHours, sm8TimeOf } from "@/lib/workboard/all-jobs";
import { sm8JobUrl } from "@/lib/integrations/sm8-links";
import { toLines } from "@/lib/workboard/note-lines";
import { useNoteScopeTarget } from "@/components/notes/note-context";
import { TiffButton } from "@/components/notes/tiff-button";
import {
  mergeProjectDiary,
  type ProjectDiaryDay,
  type ProjectVisitRow,
} from "@/lib/workboard/project-diary";
import {
  adoptProjectDiaryDay,
  readProjectDiary,
} from "@/app/actions/workboard-projects";
import type { BoardProject, ProjectBoardVisit } from "@/lib/workboard/projects-board-query";
import { hoursLabel, untilLabel } from "./derive";

/* The project card — one card, every booking on it.

   ServiceM8 keeps ONE job card and hangs every booking off it; this card is
   that model on a project (Isaac, 2026-08-29), wearing the job card's dress:
   the band, the folder tabs, the white body — the same classes, because two
   dresses drift and one doesn't.

   THREE FACES:
   Summary — what this project is: stage, the promise, progress, milestones.
   Visits  — the heart. OUR trips and the linked job's diary merged into one
             list of site days: what's coming, what isn't placed, what
             happened. A day from the ServiceM8 diary READS as a visit here;
             the moment somebody wants to write on it, it BECOMES one of our
             trips (`adoptProjectDiaryDay`) — the mirror is read-only by
             charter, so the words live on our row, never over there.
   Money   — the two-axis position, read-only. ABSENT without the money
             grant, the job card's law: the server never sent the numbers.

   The full machinery (stages, scope, claims, variations) stays on the
   project screen — the band carries the door. This card is the daily read. */

type TabKey = "summary" | "visits" | "money";

export function ProjectSheet({
  project,
  trips,
  today,
  manage,
  preloadedDiary = null,
  onOpenTrip,
  onToast,
  onClose,
}: {
  project: BoardProject;
  /** Every trip of THIS project the board holds — open and windowed done. */
  trips: ProjectBoardVisit[];
  today: string;
  manage: boolean;
  /** A diary the caller already holds — the card then skips its own read.
      The board passes nothing today; a server preload could tomorrow. */
  preloadedDiary?: ProjectDiaryDay[] | null;
  /** Opens the trip sheet — the card closes first; one sheet at a time. */
  onOpenTrip: (visitId: string) => void;
  onToast: (message: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabKey>("summary");
  /* Null until the read lands — the trips render at once and the diary days
     join them: what fills in was absent, not wrong. */
  const [diary, setDiary] = useState<ProjectDiaryDay[] | null>(preloadedDiary);
  const [diaryFailed, setDiaryFailed] = useState(false);
  const [busy, start] = useTransition();
  const closeRef = useRef<HTMLButtonElement>(null);

  useNoteScopeTarget({ kind: "project", id: project.id }, project.name);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const linkedJobs = project.jobs.filter((j) => j.remoteId);

  useEffect(() => {
    /* Nothing to read without a linked job — that case is DERIVED at render
       (an empty diary), never set from here: the compiler's own lint refuses
       a sync setState in an effect body, the #570 lesson. */
    if (preloadedDiary !== null || linkedJobs.length === 0) return;
    let live = true;
    void readProjectDiary(project.id)
      .then((res) => {
        if (!live) return;
        if (res.ok) setDiary(res.days);
        else setDiaryFailed(true);
      })
      .catch(() => {
        if (live) setDiaryFailed(true);
      });
    return () => {
      live = false;
    };
    /* Honest deps, not a disable — a react-hooks disable anywhere in a file
       makes the React Compiler skip the WHOLE component (the studio's
       documented lesson). All three are stable primitives per project, and
       the length dep also covers a job being linked while the card is open. */
  }, [preloadedDiary, linkedJobs.length, project.id]);

  /* Null means "still being read" — but with no linked job there is nothing
     to wait for, and that is a fact a render can derive. Only the waiting
     HINT reads this; the merge treats null and empty the same. */
  const diaryKnown = diary ?? (linkedJobs.length === 0 ? [] : null);

  const merged = useMemo(
    () => mergeProjectDiary(trips, diary ?? [], today),
    [trips, diary, today]
  );

  const idx = stageIndex(project.stage);
  const finish = project.promisedFinish ? untilLabel(project.promisedFinish, today) : null;
  /* The head counts days somebody actually ATTENDED — a crew booked and
     rained off still lists below, but it is not a day on site. Hours read
     the mirror's sessions where it has them, else our own closed-out
     actuals — never both for one day. */
  const pastDays = merged.past.filter(
    (r) =>
      (r.diary?.sessionMinutes ?? 0) > 0 ||
      (r.diary?.sessionCrew.length ?? 0) > 0 ||
      (r.trip !== null && r.trip.status === "done")
  ).length;
  const pastMinutes = merged.past.reduce(
    (n, r) =>
      n +
      ((r.diary?.sessionMinutes ?? 0) > 0
        ? (r.diary?.sessionMinutes ?? 0)
        : r.trip?.status === "done" && r.trip.actualHours !== null
          ? Math.round(r.trip.actualHours * 60)
          : 0),
    0
  );

  /* A diary day becomes OUR trip the moment somebody wants to write on it.
     The card stays open; the row comes back as a trip on the refresh and is
     then a door into the trip sheet, where the notes live. */
  const adoptDay = (day: string) => {
    start(async () => {
      const res = await adoptProjectDiaryDay(project.id, day);
      if (!res.ok) {
        onToast(res.error);
        return;
      }
      onToast("That day is a visit now — open it to write on it");
    });
  };

  const money = project.money;

  const tabs: ViewTab[] = [
    { key: "summary", label: "Summary" },
    { key: "visits", label: "Visits" },
    ...(money !== undefined ? [{ key: "money", label: "Money" }] : []),
  ];

  const panel = (key: TabKey, body: React.ReactNode) => (
    <section
      className="wb2-jcface"
      id={`pvsec-${key}`}
      role="tabpanel"
      aria-labelledby={`pvtab-${key}`}
      hidden={tab !== key}
    >
      {body}
    </section>
  );

  const rowList = (rows: ProjectVisitRow<ProjectBoardVisit>[], past: boolean) =>
    rows.map((r) => (
      <DiaryRow
        key={r.trip?.id ?? `d-${r.day}`}
        row={r}
        past={past}
        today={today}
        manage={manage}
        busy={busy}
        onOpenTrip={onOpenTrip}
        onAdopt={adoptDay}
      />
    ));

  return createPortal(
    <>
      <div className="wb2-scrim" onClick={onClose} />
      <aside
        className="wb2-sheet jc pv"
        role="dialog"
        aria-modal="true"
        aria-label={`${project.name} — project`}
      >
        <div className="wb2-jcband">
          <div className="wb2-shtop">
            <span className="wb2-jcid">
              <h2 className="wb2-shname">{project.name}</h2>
              <p className="wb2-jcaddr">
                {[project.clientName, project.siteLabel].filter(Boolean).join(" · ") ||
                  "No client on the project"}
              </p>
            </span>
            <span className="wb2-shchips">
              <span
                className="wb2-chip"
                title={`Stage ${Math.max(idx + 1, 1)} of ${PROJECT_STAGES.length}`}
              >
                {project.stage}
              </span>
              {project.status === "blocked" && (
                <span className="wb2-chip dan">
                  {`Blocked${project.blockedOn ? ` on ${project.blockedOn}` : ""}`}
                </span>
              )}
              {project.status === "on_hold" && <span className="wb2-chip warn">On hold</span>}
              {project.status === "done" && <span className="wb2-chip ok">Done</span>}
              {linkedJobs.map((j) => {
                const href = j.remoteId ? sm8JobUrl(j.remoteId) : null;
                return href ? (
                  <a
                    key={j.id}
                    className="wb2-chip door"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`${j.role === "primary" ? "The job behind this project" : j.role} — opens it in ServiceM8`}
                  >
                    {`SM8 #${j.jobNumber}`}
                    <Icon name="arrowUR" size={12} />
                  </a>
                ) : (
                  <span key={j.id} className="wb2-chip">
                    SM8 #{j.jobNumber}
                  </span>
                );
              })}
              {/* The card is the daily read; the machinery — stages, scope,
                  claims — lives on the project screen behind this door. */}
              <Link
                className="wb2-chip blue"
                href={`/dashboard/workboard/projects/${project.id}`}
                title="Open the full project"
              >
                Full project
                <i className="wb2-shcar" aria-hidden>
                  ›
                </i>
              </Link>
            </span>
            <TiffButton where="sheet" />
            <button
              ref={closeRef}
              className="wb2-ico"
              onClick={onClose}
              title="Close"
              aria-label="Close"
            >
              <Icon name="x" size={14} />
            </button>
          </div>

          <ViewTabs
            items={tabs}
            active={tab}
            onGo={(key) => setTab(key as TabKey)}
            ariaLabel="Project card"
            idPrefix="pvtab"
            panelPrefix="pvsec"
          />
        </div>

        <div className="wb2-jcbody">
          {panel(
            "summary",
            <>
              {/* The stage is said ONCE — the band's chip carries it (with
                  its position in the title); a tile repeating it was the
                  same word twice on one screen. */}
              <div className="wb2-facts">
                <div>
                  <span className="wb2-sect">Promised finish</span>
                  <b>{project.promisedFinish ? fmtAuWeekdayDayMonth(project.promisedFinish) : "—"}</b>
                  {finish && (
                    <em className={finish.tone === "dan" ? "dan" : undefined}>{finish.t}</em>
                  )}
                </div>
                <div>
                  <span className="wb2-sect">Checklist</span>
                  <b>{`${project.progress.percent}%`}</b>
                  <em>{`${project.progress.done} of ${project.progress.total} ticked`}</em>
                </div>
                <div>
                  <span className="wb2-sect">Hours</span>
                  <b>{`${project.hoursLogged} h logged`}</b>
                  <em>{project.hoursBudget !== null ? `budget ${project.hoursBudget} h` : "no hours budget"}</em>
                </div>
              </div>

              {project.status === "blocked" && project.blockedReason && (
                <p className="wb2-hint dan">
                  {project.blockedReason}
                  {project.blockedAt ? ` — since ${fmtAuWeekdayDayMonth(project.blockedAt.slice(0, 10))}` : ""}
                </p>
              )}

              {project.milestones.length > 0 && (
                <div className="wb2-jcsec">
                  <div className="wb2-jcdhead">
                    <b>Milestones</b>
                  </div>
                  {project.milestones.map((m) => (
                    <div className="wb2-mline" key={m.id}>
                      <b>{m.label}</b>
                      <em />
                      <span>{fmtAuWeekdayDayMonth(m.onDate)}</span>
                    </div>
                  ))}
                </div>
              )}

              {project.notes && (
                <div className="wb2-jcsec">
                  <div className="wb2-jcdhead">
                    <b>Notes on the project</b>
                  </div>
                  <p className="wb2-notetext">{project.notes}</p>
                </div>
              )}
            </>
          )}

          {panel(
            "visits",
            <>
              {merged.upcoming.length > 0 && (
                <div className="wb2-jcsec">
                  <div className="wb2-jcdhead">
                    <b>Coming up</b>
                    <em>{`next ${fmtAuWeekdayDayMonth(merged.upcoming[0].day as string)}`}</em>
                  </div>
                  {rowList(merged.upcoming, false)}
                </div>
              )}

              {merged.unplaced.length > 0 && (
                <div className="wb2-jcsec">
                  <div className="wb2-jcdhead">
                    <b>Not on a day yet</b>
                  </div>
                  {rowList(merged.unplaced, false)}
                </div>
              )}

              <div className="wb2-jcsec">
                <div className="wb2-jcdhead">
                  <b>Been on site</b>
                  {pastDays > 0 && (
                    <em>
                      {`${pastDays} ${pastDays === 1 ? "day" : "days"}`}
                      {pastMinutes > 0 ? ` · ${fmtMinutesAsHours(pastMinutes)} on site` : ""}
                    </em>
                  )}
                </div>
                {merged.past.length > 0 ? (
                  rowList(merged.past, true)
                ) : diaryKnown === null && !diaryFailed ? (
                  <p className="wb2-hint">Reading the ServiceM8 diary…</p>
                ) : (
                  <p className="wb2-hint">
                    {linkedJobs.length > 0
                      ? "Nobody's been on site yet."
                      : "No trips run yet, and no ServiceM8 job is linked."}
                  </p>
                )}
                {diaryFailed && (
                  <p className="wb2-hint">The ServiceM8 diary didn&apos;t load — the trips above are still yours.</p>
                )}
              </div>
            </>
          )}

          {money !== undefined &&
            panel(
              "money",
              <div className="wb2-jcsec">
                <div className="wb2-jcdhead">
                  <b>Where the money sits</b>
                  {money.claimedPercent !== null && <em>{`${money.claimedPercent}% claimed`}</em>}
                </div>
                <div className="wb2-mline">
                  <b>Project value</b>
                  <em>
                    {money.baseCents !== null && money.approvedVariationCents !== 0
                      ? `${fmtAud(money.baseCents)} + ${fmtAud(money.approvedVariationCents)} approved variations`
                      : money.baseCents !== null
                        ? "the budget as set"
                        : ""}
                  </em>
                  <span>{money.revisedTotalCents !== null ? fmtAud(money.revisedTotalCents) : "Not set"}</span>
                </div>
                <div className="wb2-mline">
                  <b>Claimed</b>
                  <em>
                    {money.claimedPercent !== null ? `${money.claimedPercent}% of the job` : ""}
                  </em>
                  <span>{fmtAud(money.claimedCents)}</span>
                </div>
                {money.awaitingCents > 0 && (
                  <div className="wb2-mline">
                    <b>Awaiting payment</b>
                    <em />
                    <span>{fmtAud(money.awaitingCents)}</span>
                  </div>
                )}
                <div className="wb2-mline">
                  <b>Paid</b>
                  <em />
                  <span>{fmtAud(money.paidCents)}</span>
                </div>
                {money.remainingCents !== null && (
                  <div className="wb2-mline total">
                    <b>{money.remainingCents < 0 ? "Claimed past the target" : "Still to claim"}</b>
                    <em />
                    <span>{fmtAud(Math.abs(money.remainingCents))}</span>
                  </div>
                )}
                {money.pendingVariationCents !== 0 && (
                  <p className="wb2-hint">
                    {`${fmtAud(money.pendingVariationCents)} of variations still pending — beside the target, never in it.`}
                  </p>
                )}
              </div>
            )}
        </div>
      </aside>
    </>,
    document.body
  );
}

/* One site day — ours, ServiceM8's, or both. A row with a trip behind it is
   a DOOR into the trip sheet; a diary-only row offers to become one. */
function DiaryRow({
  row,
  past,
  today,
  manage,
  busy,
  onOpenTrip,
  onAdopt,
}: {
  row: ProjectVisitRow<ProjectBoardVisit>;
  past: boolean;
  today: string;
  manage: boolean;
  busy: boolean;
  onOpenTrip: (visitId: string) => void;
  onAdopt: (day: string) => void;
}) {
  const { trip, diary, day } = row;
  /* The crew line: the past belongs to who TURNED UP (falling back to who
     was booked, then to our own assignment on a closed trip); the plan
     belongs to who is booked — SM8's diary and our assignment as one list.
     Deduped BY NAME, deliberately against the lib's by-id law: our techs
     and SM8's staff are two id spaces for the same humans, and the greater
     evil here is the same person listed twice because both systems know
     them. */
  const ourCrew: { name: string; title: string | null }[] = (trip?.techs ?? []).map((t) => ({
    name: t.name,
    title: null,
  }));
  const sourced = past
    ? diary && diary.sessionCrew.length > 0
      ? diary.sessionCrew
      : diary && diary.booked.length > 0
        ? diary.booked
        : ourCrew
    : [...ourCrew, ...(diary?.booked ?? [])];
  const people: { name: string; title: string | null }[] = [];
  for (const p of sourced) {
    const seen = people.find((q) => q.name === p.name);
    if (!seen) people.push({ name: p.name, title: p.title });
    else if (!seen.title && p.title) seen.title = p.title;
  }
  const anyTitle = people.some((p) => p.title);

  const right = past
    ? diary && diary.sessionMinutes > 0
      ? fmtMinutesAsHours(diary.sessionMinutes)
      : trip?.actualHours != null
        ? hoursLabel(trip.actualHours)
        : "—"
    : windowOf(diary?.bookedStart ?? null, diary?.bookedEnd ?? null) ??
      (trip?.status === "booked" ? "booked" : trip ? "to place" : "");

  const notes = trip ? toLines(trip.notes) : [];
  /* A project runs across years — job 279's diary starts in 2024 — so a day
     outside this year says its year, or "Mon 25 Nov" reads as this one. */
  const dayLabel = !day
    ? "No day yet"
    : day.slice(0, 4) === today.slice(0, 4)
      ? fmtAuWeekdayDayMonth(day)
      : fmtAuWeekdayDate(day);
  const line = (
    <>
      <b>{dayLabel}</b>
      <em>
        {trip?.label ?? (people.length === 0 ? "Booked in ServiceM8" : null)}
        {trip?.label && people.length > 0 ? " — " : ""}
        {/* Names wear their titles the job card's way — this face is where
            the card introduces people. A comma separates bare names; once a
            title is in the line the pair takes a dash, and the dot before a
            title is REAL TEXT (the jest-can't-see-CSS law). */}
        {people.map((p, i) => (
          <span key={p.name}>
            {i > 0 ? (anyTitle ? " — " : ", ") : ""}
            {p.name}
            {p.title && <i className="wb2-jcrole">{` · ${p.title}`}</i>}
          </span>
        ))}
      </em>
      <span>{right}</span>
    </>
  );

  return (
    <div className="wb2-pv">
      {trip ? (
        <button
          className="wb2-mline visit"
          onClick={() => onOpenTrip(trip.id)}
          title="Open the visit"
        >
          {line}
        </button>
      ) : (
        <div className="wb2-mline visit">{line}</div>
      )}
      {(notes.length > 0 || trip?.completionNote || (!trip && manage && day)) && (
        <div className="wb2-pvx">
          {notes.length > 0 && (
            <ul className="wb2-ul">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          {trip?.completionNote && <p className="wb2-pvnote">{trip.completionNote}</p>}
          {!trip && manage && day && (
            <button className="wb2-colink" disabled={busy} onClick={() => onAdopt(day)}>
              Write on this day
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** "7am–3pm" from the booking's naive window. The time itself is the shared
    `sm8TimeOf` — sliced, never parsed, and said the same way the job card's
    booking line says it. */
function windowOf(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const a = sm8TimeOf(start);
  if (!a) return null;
  const b = end && end.slice(0, 10) === start.slice(0, 10) ? sm8TimeOf(end) : null;
  return b ? `${a}–${b}` : a;
}
