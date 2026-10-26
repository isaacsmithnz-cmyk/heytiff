"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { Button, LinkButton } from "@/components/parts/button";
import { ConfirmDialog } from "@/components/parts/dialog";
import { TextInput } from "@/components/parts/field";
import { Fade } from "@/components/parts/fade";
import { Initials } from "@/components/parts/initials";
import { Menu, type MenuItem } from "@/components/parts/menu";
import { Dot, StateWord } from "@/components/parts/state";
import { SectionTabs, type TabItem } from "@/components/parts/tabs";
import { Tick } from "@/components/parts/tick";
import { JobSection } from "@/components/jobs/job-section";
import { phoneWords, telHref } from "@/components/jobs/job-facts";
import { NoteToken } from "@/components/notes/note-token";
import { useNoteScopeScreen } from "@/components/notes/note-context";
import { useRecords } from "@/components/records/records-context";
import { namePage } from "@/components/shell/page-names";
import { auDayOf, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { jobPageHref } from "@/lib/shell/links";
import { PROJECT_TABS, parseProjectTab, type ProjectTab } from "@/lib/workboard/project-tabs";
import { PROJECT_STAGES, SECTION_STAGES, checklistProgress, stageAdvice, stageIndex } from "@/lib/workboard/stages";
import { deriveProjectMoney, fmtAud } from "@/lib/workboard/project-money";
import type { ProjectDetail } from "@/lib/workboard/projects-query";
import type { IssueRow, ProjectEntry } from "@/lib/workboard/notes-query";
import type { ProjectBoardVisit } from "@/lib/workboard/projects-board-query";
import type { BoardTech } from "@/lib/workboard/board-query";
import { ProjectTripSheet } from "./board/project-trip-sheet";
import { AgreementForm } from "./board/agreement-form";
import { ToastHost, useBoardToasts } from "./board/toasts";
import { GATE_LABEL, agoLabel, projectMissingOf, projectPlacedDayOf, untilLabel } from "./board/derive";
import {
  addChecklistItem,
  addEquipment,
  attachJob,
  detachJob,
  removeChecklistItem,
  removeEquipment,
  setEquipmentManualLeft,
  setProjectDesign,
  setProjectStage,
  setProjectStatus,
  toggleChecklistItem,
  updateProjectMeta,
} from "@/app/actions/workboard";
import {
  addClaim,
  addMilestone,
  addProjectEntry,
  addVariation,
  attachDocumentToProject,
  clearProjectBlocked,
  createProjectVisit,
  decideVariation,
  setProjectBlocked,
  setProjectBudget,
  setProjectDefectsEnd,
  setProjectHoursBudget,
  setProjectPromise,
} from "@/app/actions/workboard-projects";
import { deleteDocument } from "@/app/actions/documents";
import { uploadFile } from "@/lib/documents/upload-client";
import { fmtBytes } from "@/lib/documents/files";
import { withCleanup } from "@/lib/ui/with-cleanup";
import {
  AgreementSection,
  DatesSection,
  MoneySection,
  ScopeSections,
  VariationsSection,
  totalBasis,
  type Run,
} from "./project-money-cards";
import {
  AttachJobForm,
  BlockForm,
  ClaimForm,
  DayForm,
  DecideForm,
  DesignForm,
  EditProjectForm,
  EquipmentForm,
  HoursForm,
  MilestoneForm,
  SectionForm,
  TotalForm,
  TripForm,
  VariationForm,
  type OpenForm,
} from "./project-forms";

/* ONE PROJECT, A PAGE LIKE A JOB'S (Isaac, 27 October 2026, on the old
   screens' mock: "everything looks fine"). It was a stack of up to sixteen
   cards in v1's dress; it is now the job page's shape:

     the head: the project's name, then where it stands as a word (On hold,
       Blocked), the one press that state wants in blue (Resume project,
       Unblock project, Reopen project) and Actions, a white menu: what Add
       makes, then Edit details, Link design and the handover sheet, then
       Block and Put on hold (rule 53);
     six section tabs (rule 31): Overview, Trips, Scope, Money, Site and
       Documents, the one open kept in the address as `?tab=`;
     Overview: the stage line, the strip of facts (Site, Client, Next trip,
       Money), then the checklist and the jobs beside the site journal and
       the notes.

   The stage is manual but checklist-AWARE (decision P5): a completed
   section offers the move, and moving past unticked items asks first, in
   a dialog, and never blocks. Blocked is first-class with a reason and a who
   (P4). The trips are the board's own rows, from the same loader, so the
   two can never disagree.

   Ticking is for everyone on the board; SHAPING is offered only to managers,
   and the server re-decides both, so these flags only decide what's drawn.
   Money and variations are one grant (`workboard_money`): without it the
   loader returned none, so the Money tab and the strip's Money cell are
   ABSENT rather than empty. */

export function ProjectDetailScreen({
  project,
  trips,
  staff,
  today,
  manage,
  sm8Connected,
  entries,
  issues,
  tab: firstTab = "overview",
}: {
  project: ProjectDetail;
  trips: ProjectBoardVisit[];
  staff: BoardTech[];
  today: string;
  manage: boolean;
  sm8Connected: boolean;
  entries: ProjectEntry[];
  issues: IssueRow[];
  tab?: ProjectTab;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const records = useRecords();
  const [busy, start] = useTransition();
  const [tab, setTab] = useState<ProjectTab>(parseProjectTab(firstTab, project.moneyVisible));
  const [form, setForm] = useState<OpenForm | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [tripSheet, setTripSheet] = useState<string | null>(null);
  const { toasts, toast, dismiss } = useBoardToasts();
  const close = () => setForm(null);

  const run: Run = (fn) => {
    start(async () => {
      const res = await fn();
      if (!res.ok && res.error) toast(res.error);
      router.refresh();
    });
  };
  /** Close the form, then run what it handed back. */
  const submit: Run = (fn) => {
    setForm(null);
    run(fn);
  };

  /* the open tab's name, as a job's page names its own */
  useEffect(() => {
    if (pathname) namePage(pathname, { label: project.name });
  }, [pathname, project.name]);

  /* This page IS a record, so the scope names it once: a note taken here,
     at the Tiff button in the frame or in the notes below, lands on THIS
     project. The roster is the real one, so a dictated "Dane needs to chase
     the switchboard" reaches the Tiff modal instead of staying a string. */
  useNoteScopeScreen({
    target: { kind: "project", id: project.id },
    targetLabel: project.name,
    staffFirstNames: staff.map((s) => s.name.trim().split(/\s+/)[0]).filter((n) => n.length >= 2),
  });

  const goTab = (next: string) => {
    const t = parseProjectTab(next, project.moneyVisible);
    setTab(t);
    const url = new URL(window.location.href);
    if (t === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const live = project.status === "active" || project.status === "blocked";
  const openTrips = trips.filter((t) => t.status === "upcoming" || t.status === "booked").sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const sheetTrip = tripSheet ? trips.find((t) => t.id === tripSheet) ?? null : null;
  const nextTripFor = (v: { id: string; dueDate: string }) => {
    const later = openTrips.filter((o) => o.id !== v.id && o.dueDate >= v.dueDate);
    return later[0] ? { id: later[0].id, label: later[0].label } : null;
  };

  /* ── the head's presses ── */
  const status = (to: string) => () => run(() => setProjectStatus(project.id, to));
  const main: { label: string; press: () => void } | null = !manage
    ? null
    : project.status === "on_hold"
      ? { label: "Resume project", press: status("active") }
      : project.status === "blocked"
        ? { label: "Unblock project", press: () => run(() => clearProjectBlocked(project.id)) }
        : project.status === "done" || project.status === "archived"
          ? { label: "Reopen project", press: status("active") }
          : null;

  const actions: MenuItem[] = manage
    ? [
        ...(live ? [{ key: "add-trip", label: "Add trip" }] : []),
        { key: "add-equipment", label: "Add equipment" },
        ...(project.moneyVisible
          ? [
              { key: "add-claim", label: "Add claim" },
              { key: "add-variation", label: "Add variation" },
            ]
          : []),
        { key: "add-milestone", label: "Add milestone" },
        { key: "edit", label: "Edit details", rule: true },
        { key: "design", label: project.designId ? "Change design" : "Link design" },
        { key: "handover", label: "Open handover sheet" },
        ...(project.status === "active"
          ? [
              { key: "block", label: "Block project", rule: true },
              { key: "hold", label: "Put on hold" },
              ...(project.stage === "Complete" ? [{ key: "done", label: "Mark project done" }] : []),
            ]
          : project.status === "blocked"
            ? [{ key: "hold", label: "Put on hold", rule: true }]
            : []),
        ...(project.status === "done" ? [{ key: "archive", label: "Archive project", danger: true }] : []),
      ]
    : [{ key: "handover", label: "Open handover sheet" }];

  const onAction = (key: string) => {
    if (key === "add-trip") {
      goTab("trips");
      setForm({ kind: "trip" });
    } else if (key === "add-equipment") setForm({ kind: "equipment" });
    else if (key === "add-claim") setForm({ kind: "claim" });
    else if (key === "add-variation") setForm({ kind: "variation" });
    else if (key === "add-milestone") {
      goTab("trips");
      setForm({ kind: "milestone" });
    } else if (key === "edit") setForm({ kind: "edit" });
    else if (key === "design") setForm({ kind: "design" });
    else if (key === "handover") window.open(`/handover/${project.id}`, "_blank", "noopener,noreferrer");
    else if (key === "block") setForm({ kind: "block" });
    else if (key === "hold") status("on_hold")();
    else if (key === "done") status("done")();
    else if (key === "archive") status("archived")();
  };

  const tabs: TabItem[] = PROJECT_TABS.filter((t) => t.key !== "money" || project.moneyVisible).map((t) => ({ key: t.key, label: t.label }));
  const sections = useMemo(() => sectionsOf(project.checklist), [project.checklist]);

  return (
    <div className="page in">
      <div className="wrap jp pj">
        <ProjectHead project={project} main={main} actions={actions} onAction={onAction} busy={busy} />
        <SectionTabs items={tabs} current={tab} onGo={goTab} ariaLabel="The project" idPrefix="pj-tab" />

        <div className="pj-panel" role="tabpanel" aria-labelledby={`pj-tab-${tab}`}>
          {tab === "overview" && (
            <div className="jov">
              {project.status === "blocked" && <BlockedLine project={project} />}
              <StageLine project={project} manage={manage} busy={busy} run={run} />
              <ProjectFacts project={project} openTrips={openTrips} onTrips={() => goTab("trips")} onMoney={() => goTab("money")} />
              <div className="jov-cols">
                <div className="jov-main">
                  <AgreementSection project={project} manage={manage} onOpen={setForm} />
                  <ChecklistSection
                    project={project}
                    sections={sections}
                    manage={manage}
                    live={live}
                    busy={busy}
                    run={run}
                    addingTo={addingTo}
                    onAdding={setAddingTo}
                    onOpen={setForm}
                  />
                  <JobsSection project={project} manage={manage} busy={busy} run={run} onOpen={setForm} />
                </div>
                <div className="jov-side pj-side">
                  <JournalSection
                    project={project}
                    entries={entries}
                    busy={busy}
                    run={run}
                    kind="progress"
                    name="Site journal"
                    icon="chat"
                    placeholder="What was done or found today"
                    press="Add entry"
                  />
                  <NotesSection
                    notes={project.notes}
                    manage={manage}
                    busy={busy}
                    onSave={(text) => run(() => updateProjectMeta(project.id, { notes: text }))}
                  />
                </div>
              </div>
            </div>
          )}

          {tab === "trips" && (
            <div className="pj-two">
              <TripsSection trips={trips} openTrips={openTrips} today={today} canAdd={manage && live} onAdd={() => setForm({ kind: "trip" })} onOpenTrip={setTripSheet} />
              <DatesSection project={project} today={today} manage={manage} busy={busy} run={run} onOpen={setForm} />
            </div>
          )}

          {tab === "scope" && <ScopeSections project={project} manage={manage} busy={busy} run={run} />}

          {tab === "money" && project.moneyVisible && (
            <div className="pj-two">
              <MoneySection project={project} manage={manage} busy={busy} run={run} onOpen={setForm} />
              <VariationsSection project={project} manage={manage} busy={busy} run={run} onOpen={setForm} />
            </div>
          )}

          {tab === "site" && (
            <div className="pj-two">
              <div className="pj-col">
                <EquipmentSection project={project} manage={manage} busy={busy} run={run} onOpen={setForm} />
                <DesignSection project={project} manage={manage} onOpen={setForm} />
                {issues.length > 0 && <IssuesSection issues={issues} />}
              </div>
              <JournalSection
                project={project}
                entries={entries}
                busy={busy}
                run={run}
                kind="commissioning"
                name="Commissioning"
                icon="thermo"
                placeholder="Readings and settings"
                press="Add reading"
                action={
                  <Button size={32} href={`/handover/${project.id}`} target="_blank" rel="noreferrer">
                    Open handover sheet
                  </Button>
                }
              />
            </div>
          )}

          {tab === "documents" && <DocumentsSection project={project} today={today} busy={busy} run={run} onToast={toast} onRefresh={() => router.refresh()} />}
        </div>
      </div>

      <Forms
        form={form}
        project={project}
        today={today}
        sm8Connected={sm8Connected}
        close={close}
        submit={submit}
        onOpenAgreement={(id) => records.open({ kind: "agreement", id })}
        onToast={toast}
      />

      {sheetTrip && (
        <ProjectTripSheet
          key={sheetTrip.id}
          visit={sheetTrip}
          today={today}
          staff={staff}
          manage={manage}
          connected={sm8Connected}
          nextTrip={nextTripFor(sheetTrip)}
          startClosing={false}
          onToast={toast}
          onClose={() => setTripSheet(null)}
        />
      )}

      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

/* ── the head ── */

const STATUS_WORD: Record<string, { word: string; tone: "wrong" | "info" | "good" } | undefined> = {
  blocked: { word: "Blocked", tone: "wrong" },
  on_hold: { word: "On hold", tone: "info" },
  done: { word: "Done", tone: "good" },
  archived: { word: "Archived", tone: "info" },
};

function ProjectHead({
  project,
  main,
  actions,
  onAction,
  busy,
}: {
  project: ProjectDetail;
  main: { label: string; press: () => void } | null;
  actions: readonly MenuItem[];
  onAction: (key: string) => void;
  busy: boolean;
}) {
  const actRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const word = STATUS_WORD[project.status];
  return (
    <header className="jp-head pj-head">
      <div className="jp-top">
        <div className="jp-id">
          <h1 className="jp-name">
            <Fade>{project.name}</Fade>
          </h1>
        </div>
        <div className="jp-acts">
          {word && <StateWord tone={word.tone}>{word.word}</StateWord>}
          {main && (
            <Button kind="main" disabled={busy} onClick={main.press}>
              {main.label}
            </Button>
          )}
          <Button ref={actRef} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            Actions
            <span className="jp-chev" aria-hidden="true">
              <Icon name="chevD" size={16} />
            </span>
          </Button>
          <Menu
            anchor={actRef}
            open={open}
            onClose={() => setOpen(false)}
            onSelect={(key) => {
              setOpen(false);
              onAction(key);
            }}
            items={actions}
            label="Actions on this project"
            align="end"
          />
        </div>
      </div>
    </header>
  );
}

/** Blocked, said where the stage is: who it waits on in red, why and since when in grey (rule 42). */
function BlockedLine({ project }: { project: ProjectDetail }) {
  return (
    <div className="pj-blocked">
      <p className="pj-blocked-word">
        <Dot hue="red" />
        Blocked{project.blockedOn ? ` on ${project.blockedOn}` : ""}
      </p>
      <p className="pj-cap">
        {[project.blockedReason, project.blockedAt ? `since ${fmtAuWeekdayDayMonth(auDayOf(project.blockedAt))}` : null].filter(Boolean).join(", ")}
      </p>
    </div>
  );
}

/* ── Overview: the stage line ── */

/** Unticked items in each seeded section that should be finished before
    BEING at `target`, the honest count behind "move anyway?". */
function owedBefore(target: string, items: readonly { section: string; done: boolean }[]) {
  const at = stageIndex(target);
  return SECTION_STAGES.filter((m) => stageIndex(m.stages[m.stages.length - 1]!) < at)
    .map((m) => ({ section: m.section, n: items.filter((i) => i.section === m.section && !i.done).length }))
    .filter((o) => o.n > 0);
}

const owedWords = (owed: { section: string; n: number }[]) => {
  const parts = owed.map((o, i) => `${o.n}${i === 0 ? (o.n === 1 ? " item" : " items") : ""} under ${o.section}`);
  const list = parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const total = owed.reduce((s, o) => s + o.n, 0);
  return `${list} ${total === 1 ? "isn't" : "aren't"} ticked yet.`;
};

function StageLine({ project, manage, busy, run }: { project: ProjectDetail; manage: boolean; busy: boolean; run: Run }) {
  const [pending, setPending] = useState<string | null>(null);
  const current = Math.max(stageIndex(project.stage), 0);
  const move = (target: string) => {
    setPending(null);
    run(() => setProjectStage(project.id, target));
  };
  const tryMove = (target: string) => {
    if (!manage || busy || target === project.stage) return;
    // backward is a correction, not an advance: it never asks
    if (stageIndex(target) <= current) return move(target);
    if (owedBefore(target, project.checklist).length === 0) return move(target);
    setPending(target);
  };
  const owed = pending ? owedBefore(pending, project.checklist) : [];

  return (
    <div className="jov-line">
      <nav className="jcl-line" aria-label="Where the project is up to">
        {PROJECT_STAGES.map((s, i) => {
          const state = i < current ? "done" : i === current ? "now" : "next";
          return (
            <button
              key={s}
              type="button"
              className={`jcl-step ${state}`}
              aria-current={state === "now" ? "step" : undefined}
              disabled={!manage || busy}
              onClick={() => tryMove(s)}
            >
              <i className="jcl-dot" aria-hidden />
              <span className="jcl-sl">
                <b>{s}</b>
              </span>
            </button>
          );
        })}
      </nav>
      {pending && (
        <ConfirmMove
          target={pending}
          from={project.stage}
          body={owedWords(owed)}
          onClose={() => setPending(null)}
          onMove={() => move(pending)}
        />
      )}
    </div>
  );
}


function ConfirmMove({ target, from, body, onClose, onMove }: { target: string; from: string; body: string; onClose: () => void; onMove: () => void }) {
  return (
    <ConfirmDialog heading={`Move to ${target}?`} confirm={`Move to ${target}`} cancel={`Keep at ${from}`} danger={false} onConfirm={onMove} onClose={onClose}>
      <p>{body}</p>
    </ConfirmDialog>
  );
}

/* ── Overview: the strip of facts (the job page's, job-facts.tsx) ── */

function Fact({ label, onOpen, children }: { label: string; onOpen?: () => void; children: ReactNode }) {
  const id = useId();
  return (
    <section className={`jov-fact${onOpen ? " jov-fact--door" : ""}`} aria-labelledby={id}>
      <div className="jov-lab">
        {onOpen ? (
          <button type="button" className="jov-open" id={id} onClick={onOpen}>
            {label}
          </button>
        ) : (
          <span id={id}>{label}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function ProjectFacts({
  project,
  openTrips,
  onTrips,
  onMoney,
}: {
  project: ProjectDetail;
  openTrips: ProjectBoardVisit[];
  onTrips: () => void;
  onMoney: () => void;
}) {
  /* who to ring: the first linked job's first contact in ServiceM8 */
  const withContact = project.jobs.find((j) => j.mirror?.contacts.length);
  const contact = withContact?.mirror?.contacts[0] ?? null;
  const next = openTrips[0] ?? null;
  const placed = next ? projectPlacedDayOf(next) : null;
  const money = project.moneyVisible ? deriveProjectMoney({ budgetCents: project.budgetCents, variations: project.variations, claims: project.claims }) : null;
  const tel = contact?.phone ? telHref(contact.phone) : null;

  return (
    <div className={`jov-facts${money ? "" : " jov-facts--3"}`} role="group" aria-label="The project's facts">
      <Fact label="Site">
        {project.siteLabel && <b className="jov-strong">{project.siteLabel}</b>}
        {project.siteAddress && <p className="jov-addr">{project.siteAddress}</p>}
        {!project.siteLabel && !project.siteAddress && <p className="jov-cap">No site yet</p>}
      </Fact>

      <Fact label="Client">
        {project.clientName || contact ? (
          <div className="pj-client">
            <Initials name={project.clientName || contact?.name || "Client"} size={32} beside />
            <span className="jov-person">
              <b className="jov-strong">{project.clientName || contact?.name}</b>
              {contact && <span className="jov-cap">{`${contactRole(contact.type)} on ${withContact!.jobNumber}`}</span>}
              {contact?.phone &&
                (tel ? (
                  <a className="jov-tel" href={tel}>
                    {phoneWords(contact.phone)}
                  </a>
                ) : (
                  <span className="jov-tel">{contact.phone}</span>
                ))}
            </span>
          </div>
        ) : (
          <p className="jov-cap">No client yet</p>
        )}
      </Fact>

      <Fact label="Next trip" onOpen={onTrips}>
        {next ? (
          <>
            <b className="jov-strong">{placed ? fmtAuWeekdayDayMonth(placed) : `Around ${fmtAuWeekdayDayMonth(next.dueDate)}`}</b>
            <p className="jov-cap">{next.label}</p>
            {!placed && <StateWord tone="look">Not placed</StateWord>}
          </>
        ) : (
          <>
            <b className="jov-strong">Nothing booked</b>
            <StateWord tone="info">No trips yet</StateWord>
          </>
        )}
      </Fact>

      {money && (
        <Fact label="Money" onOpen={onMoney}>
          {money.revisedTotalCents !== null ? (
            <>
              <b className="jov-fig">{fmtAud(money.revisedTotalCents)}</b>
              <p className="jov-cap">{totalBasis(project)}</p>
            </>
          ) : (
            <b className="jov-strong">No total yet</b>
          )}
          {money.claimedCents > 0 ? (
            <StateWord tone={money.awaitingCents > 0 ? "look" : "good"}>
              {money.awaitingCents > 0 ? `${fmtAud(money.awaitingCents)} awaiting payment` : `${fmtAud(money.claimedCents)} claimed`}
            </StateWord>
          ) : (
            <StateWord tone="info">Nothing claimed yet</StateWord>
          )}
        </Fact>
      )}
    </div>
  );
}

/** ServiceM8 types a contact "JOB" or "BILLING"; the others it spells out. */
function contactRole(type: string | null): string {
  const t = (type ?? "").trim().toLowerCase();
  if (t === "job" || t === "") return "Job contact";
  if (t === "billing") return "Billing contact";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* ── Overview: the checklist ── */

type Sections = [string, ProjectDetail["checklist"]][];

function sectionsOf(items: ProjectDetail["checklist"]): Sections {
  const by = new Map<string, ProjectDetail["checklist"]>();
  for (const item of items) {
    const list = by.get(item.section) ?? [];
    list.push(item);
    by.set(item.section, list);
  }
  return [...by.entries()];
}

function ChecklistSection({
  project,
  sections,
  manage,
  live,
  busy,
  run,
  addingTo,
  onAdding,
  onOpen,
}: {
  project: ProjectDetail;
  sections: Sections;
  manage: boolean;
  live: boolean;
  busy: boolean;
  run: Run;
  addingTo: string | null;
  onAdding: (section: string | null) => void;
  onOpen: (form: OpenForm) => void;
}) {
  const progress = checklistProgress(project.checklist);
  const advice = stageAdvice(project.stage, project.checklist);
  return (
    <JobSection
      name="Checklist"
      icon="check"
      hue="yellow"
      note={progress.total > 0 ? `${progress.done} of ${progress.total} ticked` : null}
      action={
        manage ? (
          <Button size={32} onClick={() => onOpen({ kind: "section" })}>
            Add section
          </Button>
        ) : null
      }
    >
      {sections.length === 0 && <p className="pj-none">No items yet.</p>}
      {sections.map(([section, items]) => {
        const all = items.length > 0 && items.every((i) => i.done);
        const nudge = manage && live && advice.nudge && advice.next && advice.gateSection === section ? advice.next : null;
        return (
          <div className="pj-group" key={section}>
            <div className="pj-sub">
              <span>{section}</span>
              <span className="pj-end">
                {all && <StateWord tone="good">All ticked</StateWord>}
                {nudge && (
                  <Button kind="quiet" size={32} disabled={busy} onClick={() => run(() => setProjectStage(project.id, nudge))}>
                    {`Move to ${nudge}`}
                  </Button>
                )}
              </span>
            </div>
            <ul className="jov-rows" aria-label={section}>
              {items.map((item) => (
                <li className={`jov-row pj-row${item.done ? " pj-done" : ""}`} key={item.id}>
                  <Tick label={item.label} checked={item.done} disabled={busy} onChange={(on) => run(() => toggleChecklistItem(item.id, on))} />
                  <span className="pj-end">
                    {item.done && item.doneAt && <span className="pj-when">{fmtAuWeekdayDayMonth(auDayOf(item.doneAt))}</span>}
                    {manage && (
                      <Button kind="quiet" size={32} className="pj-rm" aria-label={`Remove ${item.label}`} disabled={busy} onClick={() => run(() => removeChecklistItem(item.id))}>
                        Remove
                      </Button>
                    )}
                  </span>
                </li>
              ))}
              {addingTo === section && (
                <li className="jov-row pj-row">
                  <ItemAdder
                    section={section}
                    busy={busy}
                    onAdd={(label) => {
                      onAdding(null);
                      run(() => addChecklistItem(project.id, section, label));
                    }}
                    onCancel={() => onAdding(null)}
                  />
                </li>
              )}
            </ul>
            {manage && addingTo !== section && (
              <div className="jov-more">
                <Button kind="quiet" size={32} aria-label={`Add an item to ${section}`} onClick={() => onAdding(section)}>
                  Add item
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </JobSection>
  );
}

function ItemAdder({ section, busy, onAdd, onCancel }: { section: string; busy: boolean; onAdd: (label: string) => void; onCancel: () => void }) {
  const [label, setLabel] = useState("");
  const add = () => {
    if (label.trim()) onAdd(label.trim());
  };
  return (
    <span className="pj-adder">
      <TextInput
        size={32}
        autoFocus
        aria-label={`A new item under ${section}`}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
          if (e.key === "Escape") onCancel();
        }}
      />
      <Button kind="quiet" size={32} onClick={onCancel}>
        Cancel
      </Button>
      <Button size={32} disabled={busy || !label.trim()} onClick={add}>
        Add item
      </Button>
    </span>
  );
}

/* ── Overview: the jobs ── */

const ROLE_WORD: Record<string, string> = {
  quote: "The quote",
  install: "The install",
  variation: "A variation",
  service: "A service",
  other: "Other work",
};

/** '2026-07-29 07:30:00' → '7:30am Wed 29/7': string maths on the mirror's
    wall-clock value, no Date() reinterpretation. */
function bookingLabel(naive: string): string {
  const [d, t] = [naive.slice(0, 10), naive.slice(11, 16)];
  const h = parseInt(t.slice(0, 2), 10);
  const hh = h % 12 === 0 ? 12 : h % 12;
  const [y, m, day] = d.split("-").map((x) => parseInt(x, 10));
  const dow = new Date(Date.UTC(y!, m! - 1, day)).getUTCDay();
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${hh}:${t.slice(3, 5)}${h < 12 ? "am" : "pm"} ${dows[dow]} ${day}/${m}`;
}

function JobsSection({ project, manage, busy, run, onOpen }: { project: ProjectDetail; manage: boolean; busy: boolean; run: Run; onOpen: (form: OpenForm) => void }) {
  return (
    <JobSection
      name="Jobs"
      icon="briefcase"
      hue="purple"
      action={
        manage ? (
          <Button size={32} onClick={() => onOpen({ kind: "attach" })}>
            Attach job
          </Button>
        ) : null
      }
    >
      {project.jobs.length === 0 ? (
        <p className="pj-none">No jobs attached yet.</p>
      ) : (
        <ul className="jov-rows" aria-label="Jobs on this project">
          {project.jobs.map((j) => {
            const m = j.mirror;
            const line = m
              ? [
                  m.status,
                  m.suburb,
                  m.nextBooking ? `${bookingLabel(m.nextBooking.start)}${m.nextBooking.staffName ? ` with ${m.nextBooking.staffName}` : ""}` : null,
                  m.checklist && m.checklist.total > 0 ? `SM8 list ${m.checklist.done}/${m.checklist.total}` : null,
                ]
                  .filter(Boolean)
                  .join(", ")
              : j.provider
                ? "Not in the mirror yet"
                : "Typed by hand";
            const who = m?.contacts[0];
            return (
              <li className="jov-row pj-row pj-job" key={j.id} data-job={j.jobNumber}>
                <span className="pj-jobno">{j.jobNumber}</span>
                <span className="pj-text">
                  {j.remoteId && m ? (
                    <Link href={jobPageHref(j.remoteId)} className="pj-name pj-joblink">
                      {ROLE_WORD[j.role] ?? j.role}
                    </Link>
                  ) : (
                    <b className="pj-name">{ROLE_WORD[j.role] ?? j.role}</b>
                  )}
                  <span className="pj-line">{line}</span>
                </span>
                <span className="pj-end">
                  {who && <span className="pj-when">{[who.name, who.phone].filter(Boolean).join(", ")}</span>}
                  {manage && (
                    <Button kind="quiet" size={32} aria-label={`Detach job ${j.jobNumber}`} disabled={busy} onClick={() => run(() => detachJob(j.id))}>
                      Detach
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </JobSection>
  );
}

/* ── the two journals: one table behind them, told apart by kind ── */

function JournalSection({
  project,
  entries,
  busy,
  run,
  kind,
  name,
  icon,
  placeholder,
  press,
  action,
}: {
  project: ProjectDetail;
  entries: ProjectEntry[];
  busy: boolean;
  run: Run;
  kind: "progress" | "commissioning";
  name: string;
  icon: string;
  placeholder: string;
  press: string;
  action?: ReactNode;
}) {
  const [text, setText] = useState("");
  const rows = entries.filter((e) => e.kind === kind);
  const add = () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    run(() => addProjectEntry(project.id, kind, body));
  };
  return (
    <JobSection name={name} icon={icon} hue="green" action={action}>
      <div className="pj-compose">
        <TextInput
          aria-label={name}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <Button disabled={busy || !text.trim()} onClick={add}>
          {press}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="pj-none">Nothing recorded yet.</p>
      ) : (
        <ul className="jov-rows" aria-label={name}>
          {rows.map((e) => (
            <li className="jov-row pj-row pj-entry" key={e.id}>
              <span className="pj-lead">{fmtAuWeekdayDayMonth(e.entryDate)}</span>
              <span className="pj-name pj-plain pj-wrap">{e.body}</span>
            </li>
          ))}
        </ul>
      )}
    </JobSection>
  );
}

/* ── Overview: the notes ── */

function NotesSection({ notes, manage, busy, onSave }: { notes: string | null; manage: boolean; busy: boolean; onSave: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(notes ?? "");
  return (
    <JobSection
      name="Notes"
      icon="file"
      hue="pink"
      action={
        manage && !editing ? (
          <Button
            size={32}
            onClick={() => {
              setText(notes ?? "");
              setEditing(true);
            }}
          >
            Edit notes
          </Button>
        ) : null
      }
    >
      {editing ? (
        <div className="pj-col pj-notes-edit">
          <NoteToken as="field" label="project notes" value={text} onChange={setText} rows={5} />
          <div className="pj-end">
            <Button kind="quiet" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              kind="main"
              disabled={busy}
              onClick={() => {
                onSave(text);
                setEditing(false);
              }}
            >
              Save notes
            </Button>
          </div>
        </div>
      ) : notes ? (
        <p className="pj-notes">{notes}</p>
      ) : (
        <p className="pj-none">No notes yet.</p>
      )}
    </JobSection>
  );
}

/* ── Trips ── */

/* The `??`s read first, into their own names: React Compiler 1.0 refuses a
   ternary whose test is itself a logical and gives up on the whole
   component. */
const mostRecentlyCompleted = (a: ProjectBoardVisit, b: ProjectBoardVisit) => {
  const at = a.completedAt ?? "";
  const bt = b.completedAt ?? "";
  return at < bt ? 1 : -1;
};

function TripsSection({
  trips,
  openTrips,
  today,
  canAdd,
  onAdd,
  onOpenTrip,
}: {
  trips: ProjectBoardVisit[];
  openTrips: ProjectBoardVisit[];
  today: string;
  canAdd: boolean;
  onAdd: () => void;
  onOpenTrip: (id: string) => void;
}) {
  const done = trips
    .filter((t) => t.status === "done" || t.status === "skipped")
    .sort(mostRecentlyCompleted);
  return (
    <JobSection
      name="Trips to site"
      icon="car"
      hue="purple"
      action={
        canAdd ? (
          <Button size={32} onClick={onAdd}>
            Add trip
          </Button>
        ) : null
      }
    >
      {openTrips.length === 0 && done.length === 0 && <p className="pj-none">No trips yet.</p>}
      {openTrips.length > 0 && (
        <ul className="jov-rows" aria-label="Trips to come">
          {openTrips.map((t) => {
            const missing = projectMissingOf(t);
            const placed = projectPlacedDayOf(t);
            const late = t.dueDate < today;
            const packed = t.bringList.filter((i) => i.packed).length;
            return (
              <li className="pj-trip" key={t.id}>
                <button type="button" className="pj-trip-hit" aria-label={`Open ${t.label}`} onClick={() => onOpenTrip(t.id)} />
                <span className="pj-text">
                  <b className="pj-name">{t.label}</b>
                  <span className="pj-line">
                    {[
                      `Around ${fmtAuWeekdayDayMonth(t.dueDate)}`,
                      t.jobNumber ? `job ${t.jobNumber}` : null,
                      t.bringList.length ? `bring ${packed} of ${t.bringList.length}` : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </span>
                <span className="pj-text">
                  {placed ? (
                    <>
                      <b className="pj-name">{fmtAuWeekdayDayMonth(placed)}</b>
                      <span className="pj-line">{t.techs.length ? t.techs.map((x) => x.name).join(", ") : "Nobody assigned yet"}</span>
                    </>
                  ) : (
                    <StateWord tone={late ? "wrong" : "look"}>{late ? untilLabel(t.dueDate, today).t : "Not placed"}</StateWord>
                  )}
                </span>
                <span className="pj-gates">
                  {missing.length === 0 ? (
                    <StateWord tone="good">Ready</StateWord>
                  ) : (
                    (["equipment", "access", "crew"] as const).map((g) => (
                      <StateWord key={g} tone={missing.includes(g) ? "info" : "good"}>
                        {GATE_LABEL[g]}
                        <span className="pj-sr">{missing.includes(g) ? ", not yet" : ", confirmed"}</span>
                      </StateWord>
                    ))
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {done.length > 0 && (
        <>
          <div className="pj-sub">
            <span>Ran</span>
          </div>
          <ul className="jov-rows" aria-label="Trips that ran">
            {done.map((t) => (
              <li className="pj-trip" key={t.id}>
                <button type="button" className="pj-trip-hit" aria-label={`Open ${t.label}`} onClick={() => onOpenTrip(t.id)} />
                <span className="pj-text">
                  <b className="pj-name">{t.label}</b>
                  <span className="pj-line">{t.completionNote || "No close-out note"}</span>
                </span>
                <span className="pj-text">
                  <b className="pj-name">{t.completedAt ? fmtAuWeekdayDayMonth(t.completedAt) : "No day"}</b>
                  <span className="pj-line">{t.status === "skipped" ? "Skipped" : t.completedAt ? `Ran ${agoLabel(t.completedAt, today)}` : ""}</span>
                </span>
                <span className="pj-gates">
                  <StateWord tone={t.status === "done" ? "good" : "info"}>
                    {t.status === "done" ? (t.actualHours !== null ? `${t.actualHours} h on site` : "Done") : "Skipped"}
                  </StateWord>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </JobSection>
  );
}

/* ── Site ── */

function EquipmentSection({ project, manage, busy, run, onOpen }: { project: ProjectDetail; manage: boolean; busy: boolean; run: Run; onOpen: (form: OpenForm) => void }) {
  return (
    <JobSection
      name="Equipment on site"
      icon="unit"
      hue="yellow"
      action={
        manage ? (
          <Button size={32} onClick={() => onOpen({ kind: "equipment" })}>
            Add equipment
          </Button>
        ) : null
      }
    >
      {project.equipment.length === 0 ? (
        <p className="pj-none">Nothing recorded yet.</p>
      ) : (
        <ul className="jov-rows" aria-label="Equipment on site">
          {project.equipment.map((e) => (
            <li className="jov-row pj-row" key={e.id}>
              <span className="pj-text">
                <b className="pj-name">{e.description}</b>
                <span className="pj-line">{[e.model, e.serial && `s/n ${e.serial}`, e.locationNote].filter(Boolean).join(", ")}</span>
              </span>
              <span className="pj-end">
                <Tick label="Manual left" checked={e.manualLeft} disabled={busy} onChange={(on) => run(() => setEquipmentManualLeft(e.id, on))} />
                {manage && (
                  <Button kind="quiet" size={32} className="pj-rm" aria-label={`Remove ${e.description}`} disabled={busy} onClick={() => run(() => removeEquipment(e.id))}>
                    Remove
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </JobSection>
  );
}

function DesignSection({ project, manage, onOpen }: { project: ProjectDetail; manage: boolean; onOpen: (form: OpenForm) => void }) {
  return (
    <JobSection
      name="Design"
      icon="design"
      hue="purple"
      action={
        manage ? (
          <Button size={32} onClick={() => onOpen({ kind: "design" })}>
            {project.designId ? "Change design" : "Link design"}
          </Button>
        ) : null
      }
    >
      {project.designId ? (
        <ul className="jov-rows">
          <li className="jov-row pj-row">
            <b className="pj-name">{project.designName ?? "A Studio design"}</b>
            {/* opens THE design, not the Studio's front door */}
            <Button kind="quiet" size={32} href={`/dashboard/studio?design=${encodeURIComponent(project.designId)}`}>
              Open in Studio
            </Button>
          </li>
        </ul>
      ) : (
        <p className="pj-none">No design linked.</p>
      )}
    </JobSection>
  );
}

function IssuesSection({ issues }: { issues: IssueRow[] }) {
  return (
    <JobSection name="Recurring issues" icon="alert" hue="grey">
      <ul className="jov-rows" aria-label="Recurring issues">
        {issues.map((i) => (
          <li className="jov-row pj-row" key={i.id}>
            <span className="pj-text">
              <b className="pj-name">{i.summary}</b>
              <span className="pj-line">
                {[
                  i.equipmentRef,
                  i.occurrences > 1 ? `${fmtAuWeekdayDayMonth(i.firstSeen)} to ${fmtAuWeekdayDayMonth(i.lastSeen)}` : fmtAuWeekdayDayMonth(i.lastSeen),
                ]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </span>
            {i.occurrences > 1 && <StateWord tone="look">{`Logged ${i.occurrences} times`}</StateWord>}
          </li>
        ))}
      </ul>
    </JobSection>
  );
}

/* ── Documents ── */

function DocumentsSection({
  project,
  today,
  busy,
  run,
  onToast,
  onRefresh,
}: {
  project: ProjectDetail;
  today: string;
  busy: boolean;
  run: Run;
  onToast: (message: string) => void;
  onRefresh: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    setUploading(true);
    await withCleanup(async () => {
      const up = await uploadFile(file, "project_file");
      if (!up.ok) return onToast(up.error);
      const attached = await attachDocumentToProject(up.file.documentId, project.id);
      if (!attached.ok) onToast(attached.error);
      onRefresh();
    }, () => setUploading(false));
  };
  return (
    <div className="pj-one">
      <JobSection
        name="Documents and photos"
        icon="file"
        hue="pink"
        action={
          <Button size={32} icon="upload" disabled={uploading} onClick={() => picker.current?.click()}>
            {uploading ? "Uploading the file" : "Upload file"}
          </Button>
        }
      >
        <input
          ref={picker}
          type="file"
          accept="image/*,application/pdf"
          hidden
          aria-label="A file for this project"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
        {project.documents.length === 0 ? (
          <p className="pj-none">No files yet.</p>
        ) : (
          <ul className="jov-rows" aria-label="Documents and photos">
            {project.documents.map((d) => (
              <li className="jov-row pj-row" key={d.id}>
                <span className="pj-text">
                  <b className="pj-name">
                    <Fade>{d.fileName}</Fade>
                  </b>
                  <span className="pj-line">
                    {`${d.mimeType.startsWith("image/") ? "Photo" : "File"}, ${fmtBytes(d.sizeBytes)}, ${agoLabel(auDayOf(d.uploadedAt), today)}`}
                  </span>
                </span>
                <span className="pj-end">
                  {d.url && (
                    <LinkButton href={d.url} target="_blank" rel="noreferrer">
                      Open
                    </LinkButton>
                  )}
                  <Button kind="quiet" size={32} aria-label={`Remove ${d.fileName}`} disabled={busy || uploading} onClick={() => run(() => deleteDocument(d.id))}>
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </JobSection>
    </div>
  );
}

/* ── the forms over the page (project-forms.tsx), one at a time ── */

function Forms({
  form,
  project,
  today,
  sm8Connected,
  close,
  submit,
  onOpenAgreement,
  onToast,
}: {
  form: OpenForm | null;
  project: ProjectDetail;
  today: string;
  sm8Connected: boolean;
  close: () => void;
  submit: Run;
  onOpenAgreement: (id: string) => void;
  onToast: (message: string, undo?: () => void | Promise<void>) => void;
}) {
  if (!form) return null;
  const id = project.id;
  switch (form.kind) {
    case "block":
      return <BlockForm onClose={close} onBlock={(reason, on) => submit(() => setProjectBlocked(id, { reason, on }))} />;
    case "edit":
      return <EditProjectForm project={project} onClose={close} onSave={(patch) => submit(() => updateProjectMeta(id, patch))} />;
    case "attach":
      return <AttachJobForm sm8Connected={sm8Connected} onClose={close} onAttach={(input) => submit(() => attachJob(id, input))} />;
    case "equipment":
      return (
        <EquipmentForm
          onClose={close}
          onAdd={(input, photo) =>
            submit(async () => {
              const res = await addEquipment(id, input);
              if (!res.ok) return res;
              if (photo) {
                // the nameplate photo is site evidence: it lands with the
                // project's files through the same slot flow as any upload
                const up = await uploadFile(photo, "project_file");
                if (up.ok) await attachDocumentToProject(up.file.documentId, id);
              }
              return res;
            })
          }
        />
      );
    case "claim":
      return <ClaimForm project={project} onClose={close} onAdd={(input) => submit(() => addClaim(id, input))} />;
    case "variation":
      return <VariationForm onClose={close} onAdd={(input) => submit(() => addVariation(id, input))} />;
    case "decide": {
      const v = project.variations.find((x) => x.id === form.id);
      if (!v) return null;
      return <DecideForm to={form.to} variation={v} onClose={close} onDecide={(who) => submit(() => decideVariation(v.id, form.to, who))} />;
    }
    case "total":
      return (
        <TotalForm
          cents={project.budgetCents}
          onClose={close}
          onSave={(cents) => submit(() => setProjectBudget(id, cents === null ? { cents: null } : { cents, source: "manual" }))}
        />
      );
    case "trip":
      return <TripForm today={today} onClose={close} onAdd={(input) => submit(() => createProjectVisit(id, input))} />;
    case "milestone":
      return <MilestoneForm today={today} onClose={close} onAdd={(input) => submit(() => addMilestone(id, input))} />;
    case "promise":
      return <DayForm heading="Promised finish" value={project.promisedFinish} today={today} onClose={close} onSave={(d) => submit(() => setProjectPromise(id, d))} />;
    case "defects":
      return <DayForm heading="Defects period ends" value={project.defectsEnd} today={today} onClose={close} onSave={(d) => submit(() => setProjectDefectsEnd(id, d))} />;
    case "hours":
      return <HoursForm hours={project.hoursBudget} onClose={close} onSave={(h) => submit(() => setProjectHoursBudget(id, h))} />;
    case "section":
      return <SectionForm onClose={close} onAdd={(section, label) => submit(() => addChecklistItem(id, section, label))} />;
    case "design":
      return <DesignForm designId={project.designId} onClose={close} onSave={(d) => submit(() => setProjectDesign(id, d))} />;
    case "agreement":
      /* New agreement, filled in from the project; Create is the handover
         action, which carries the equipment and serials over */
      return (
        <AgreementForm
          project={{ id, name: project.name, clientName: project.clientName, siteLabel: project.siteLabel, siteAddress: project.siteAddress }}
          onOpenAgreement={onOpenAgreement}
          onToast={onToast}
          onClose={close}
        />
      );
  }
}
