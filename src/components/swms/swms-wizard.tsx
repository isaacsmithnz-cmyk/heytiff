"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, IconButton } from "@/components/parts/button";
import { ConfirmDialog } from "@/components/parts/dialog";
import { Chooser } from "@/components/parts/chooser";
import { Field, TextArea, TextInput } from "@/components/parts/field";
import { Tray } from "@/components/parts/tabs";
import { Tick } from "@/components/parts/tick";
import {
  issueSwms,
  swmsPrevious,
  swmsWizardContext,
  type SwmsPrevious,
  type SwmsWizardContext,
} from "@/app/actions/swms";
import { BELL_REFRESH_EVENT } from "@/lib/dashboard/chips";
import { withCleanup } from "@/lib/ui/with-cleanup";
import {
  andList,
  AU_STATES,
  buildSwms,
  categoriesOf,
  HRCW,
  isFirstAidTicket,
  issueProblemList,
  kindFromCategory,
  methodChanges,
  jurisdictionOf,
  startingAnswers,
  STATE_NAME,
  stateNotCovered,
  type AuState,
  STEP_TITLE,
  stepOn,
  stepsFor,
  type ProblemField,
  type StepKey,
  type SwmsAnswers,
} from "@/lib/swms/library";
import type { SwmsTeamMember } from "@/lib/swms/query";
import { ApproveTemplate } from "./approve-template";
import { TemplateSteps } from "./template-steps";
import { focusSoon, FootWord, Group, jobLine, Jumps, Q, Radio, TickWords, WizardDialog } from "./wizard";
import "./swms.css";

/* THE SWMS WIZARD — four screens of choices on the job card, and the template
   writes the rest.

   SIMPLE ENTRY, DETAILED OUTPUT. Every question is a choice the site forces
   (how the fall is stopped, where the circuit is isolated) or a fact only the
   person standing there knows; everything else is written from the template.
   What the job already says — its category, its state, who's booked — is
   filled in, not asked. The rules that stop an issue are the template's own
   (`issueProblemList`), each with the answer it is about, so the review takes
   you to the field instead of telling you to go and find it.

   IT IS THE V2 DIALOG (Isaac, 25 October 2026: "every pop-up is the v2
   dialog"): the title, the job's number and address in grey, the four
   screens as section tabs, and only v2's parts inside — a step is a box
   with its tick, a one-of-a-few is a tray, a list to pick from is a
   chooser. The frame is ./wizard. */

type Tab = "work" | "how" | "who" | "review";
type Outsider = { id: string; name: string; company: string };

const TABS: { key: Tab; label: string }[] = [
  { key: "work", label: "The work" },
  { key: "how", label: "How it's done" },
  { key: "who", label: "Who it covers" },
  { key: "review", label: "Review" },
];

/** Where each problem is answered: the screen, and the field to land on. */
const FIELD_AT: Record<ProblemField | "reason" | "state", { tab: Tab; id: string }> = {
  kind: { tab: "work", id: "swz-kind" },
  state: { tab: "work", id: "swz-state" },
  builderName: { tab: "work", id: "swz-builder" },
  steps: { tab: "how", id: "swz-step-first" },
  anchor: { tab: "how", id: "swz-anchor" },
  qldFallReason: { tab: "how", id: "swz-qldreason" },
  silicaWhy: { tab: "how", id: "swz-silicawhy" },
  roofPower: { tab: "how", id: "swz-roofpower" },
  isolation: { tab: "how", id: "swz-isolation" },
  electrician: { tab: "how", id: "swz-elec" },
  siteNotes: { tab: "how", id: "swz-notes" },
  people: { tab: "who", id: "swz-team" },
  responsible: { tab: "who", id: "swz-resp" },
  hospital: { tab: "who", id: "swz-hosp" },
  siteChecked: { tab: "review", id: "swz-walked" },
  reason: { tab: "review", id: "swz-reason" },
};

const STEP_SUB: Record<StepKey, string> = {
  roof: "Work at height",
  lift: "Work at height",
  drill: "Live wiring and silica dust",
  ceiling: "Live cables and roof-space heat",
  braze: "Hot work",
  test: "High-pressure gas",
  power: "Live electrical work",
  charge: "Charged refrigerant lines",
};

const REFRIGERANTS = [
  { value: "R32", label: "R32" },
  { value: "R410A", label: "R410A" },
  { value: "R454B", label: "R454B" },
  { value: "R290", label: "R290" },
] as const;
type Refrigerant = (typeof REFRIGERANTS)[number]["value"];
const NO_YES = [
  { value: "no", label: "No" },
  { value: "yes", label: "Yes" },
] as const;

const REGULATION = {
  NSW: "Work Health and Safety Regulation 2025 (NSW)",
  QLD: "Work Health and Safety Regulation 2011 (Qld)",
} as const;
const PLAIN = new Map(HRCW.map((c) => [c.n, c.plain]));

/** A current first aid ticket on their staff card. */
const hasFirstAid = (t: SwmsTeamMember) => t.tickets.some((k) => k.current && isFirstAidTicket(k.name));
const capital = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

const ISSUE_FAILED = "Couldn't issue the SWMS. Try again.";
/* the first thing the server refused it for — out here, not in issue's
   try, where React Compiler 1.0 cannot lower the `??` */
const issueRefusal = (problems: string[]) => problems[0] ?? ISSUE_FAILED;

export function SwmsWizard({
  jobUuid,
  reviseVersionId = null,
  onClose,
  onIssued,
  onSignOn,
  onOpen,
}: {
  jobUuid: string;
  /** Set to revise: the latest version this one replaces. */
  reviseVersionId?: string | null;
  onClose: () => void;
  onIssued: () => void;
  /** Takes the reader to the sign-on for a version. */
  onSignOn: (versionId: string) => void;
  /** Opens a version in the card's own viewer. */
  onOpen: (versionId: string) => void;
}) {
  const [ctx, setCtx] = useState<SwmsWizardContext | null | "failed">(null);
  const [prev, setPrev] = useState<SwmsPrevious | null>(null);
  /* Revise pressed on a card opened before someone else issued a version:
     there is no previous to start from, and carrying on would file a SECOND
     SWMS on the job. */
  const [stale, setStale] = useState(false);
  const [tab, setTab] = useState<Tab>("work");
  const [a, setA] = useState<SwmsAnswers>(() => startingAnswers("install", "NSW"));
  const [covers, setCovers] = useState<string[]>([]);
  const [outsiders, setOutsiders] = useState<Outsider[]>([]);
  const [responsible, setResponsible] = useState<string | null>(null);
  const [electrician, setElectrician] = useState("");
  const [firstAider, setFirstAider] = useState("");
  /* Until someone picks one, the first aider is whoever the staff records say
     holds first aid — the person in charge first. */
  const [aiderChosen, setAiderChosen] = useState(false);
  /* The state, when the address doesn't name one: asked, never assumed — a
     Melbourne job whose address never spells VIC was written to NSW rules. */
  const [pickedState, setPickedState] = useState<AuState | "">("");
  /* Whether the steps are the person's own choices or the template's opener,
     so changing install/service doesn't throw away what they ticked. */
  const [stepsTouched, setStepsTouched] = useState(false);
  const [checked, setChecked] = useState(false);
  const [reason, setReason] = useState("");
  const [material, setMaterial] = useState(true);
  const [moreCategories, setMoreCategories] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ versionId: string; version: number } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  /* The blank row's id is the id its helper will have, so the row a name is
     typed into stays the same element — and keeps the cursor — as it becomes
     a person, while a new blank row opens below it. */
  const [blankId, setBlankId] = useState("o0");
  const bodyRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const newId = () => `o${++seq.current}`;

  /* Keyed by job and version at the call site, so these reads run once per
     wizard and never need resetting. */
  useEffect(() => {
    let live = true;
    Promise.all([
      swmsWizardContext(jobUuid),
      reviseVersionId ? swmsPrevious(reviseVersionId) : Promise.resolve(null),
    ])
      .then(([c, p]) => {
        if (!live) return;
        if (!c) return setCtx("failed");
        setCtx(c);
        if (reviseVersionId && !p) setStale(true);
        const onTeam = (id: string) => c.team.some((t) => t.id === id);
        if (p) {
          const rows = p.outsiders.map((o) => ({ id: `o${++seq.current}`, name: o.name, company: o.company ?? "" }));
          const covered = p.staffIds.filter(onTeam);
          /* who the last version named, found again by name */
          const keyFor = (name: string | null) => {
            if (!name) return "";
            const t = c.team.find((m) => m.name === name && covered.includes(m.id));
            if (t) return `staff:${t.id}`;
            const o = rows.find((r) => r.name === name);
            return o ? `out:${o.id}` : "";
          };
          setPrev(p);
          /* the site's rules are its address's, even when an old version guessed */
          setA(c.job.jurisdiction ? { ...p.answers, jurisdiction: c.job.jurisdiction } : p.answers);
          /* the state the last version was written to, so an address that
             doesn't name one isn't asked about twice */
          if (!c.job.state) setPickedState(p.answers.jurisdiction);
          setCovers(covered);
          setOutsiders(rows);
          setResponsible(onTeam(p.responsibleStaffId) ? p.responsibleStaffId : null);
          setElectrician(keyFor(p.electricianName));
          setFirstAider(keyFor(p.firstAiderName));
          /* what the last version said stands until someone changes it — a
             correction that quietly added a first aider changed the SWMS */
          setAiderChosen(true);
          /* these steps are the last version's choices, not the template's
             opener, so changing install/service must not clear them */
          setStepsTouched(true);
        } else {
          const booked = c.team.filter((t) => t.booked).map((t) => t.id);
          const people = booked.length ? booked : c.viewerStaffId && onTeam(c.viewerStaffId) ? [c.viewerStaffId] : [];
          setA({
            ...startingAnswers(kindFromCategory(c.job.categoryName) ?? "install", c.job.jurisdiction ?? "NSW"),
            /* the area's hospital, from the last SWMS in the same postcode */
            hospital: c.hospital?.name ?? "",
          });
          setCovers(people);
          setResponsible(c.viewerStaffId && people.includes(c.viewerStaffId) ? c.viewerStaffId : people[0] ?? null);
        }
      })
      .catch(() => live && setCtx("failed"));
    return () => {
      live = false;
    };
  }, [jobUuid, reviseVersionId]);

  /* Escape, the scrim and Cancel close the wizard, never the page under it:
     the dialog is in front (the overlay stack). A wizard with choices in it
     asks first: a stray key shouldn't throw away a site walk. While it asks,
     the question is in front, so Escape there keeps editing. */
  const askClose = () => {
    if (dirty && !issued) setConfirmClose(true);
    else onClose();
  };

  const go = (t: Tab) => {
    setTab(t);
    bodyRef.current?.scrollTo?.({ top: 0 });
  };
  const jump = (field: ProblemField | "reason" | "state") => {
    const at = FIELD_AT[field];
    setTab(at.tab);
    focusSoon(at.id);
  };

  const touch = () => setDirty(true);
  const set = (patch: Partial<SwmsAnswers>) => {
    setA((x) => ({ ...x, ...patch }));
    touch();
  };
  const setSite = (k: keyof SwmsAnswers["site"], v: boolean) => set({ site: { ...a.site, [k]: v } });
  const setStepOn = (k: StepKey, v: boolean) => {
    setStepsTouched(true);
    set({ steps: { ...a.steps, [k]: v } });
  };
  /* The steps someone has ticked survive a change of kind — one tap on
     "Service or repair" used to clear them all, silently. Untouched, the
     kind's own opener applies; `stepOn` hides any step that kind doesn't do
     and brings it back if the kind changes back. */
  const setKind = (kind: "install" | "service") => {
    if (kind === a.kind) return;
    set(stepsTouched ? { kind } : { kind, steps: startingAnswers(kind, a.jurisdiction).steps });
  };

  const team = ctx && ctx !== "failed" ? ctx.team : [];
  const coveredTeam = team.filter((t) => covers.includes(t.id));
  const named = outsiders.filter((o) => o.name.trim());
  const people = [
    ...coveredTeam.map((t) => ({ key: `staff:${t.id}`, name: t.name })),
    ...named.map((o) => ({ key: `out:${o.id}`, name: o.name.trim() })),
  ];
  const personName = (key: string) => people.find((p) => p.key === key)?.name ?? null;
  const cover = (id: string) => setCovers((c) => (c.includes(id) ? c : [...c, id]));
  const electricianOk = !!personName(electrician);
  const responsibleOk = !!responsible && covers.includes(responsible);
  const noTickets = coveredTeam.filter((t) => !t.tickets.some((k) => k.current));
  const autoAider = coveredTeam.find((t) => t.id === responsible && hasFirstAid(t)) ?? coveredTeam.find(hasFirstAid) ?? null;
  const aider = aiderChosen ? firstAider : autoAider ? `staff:${autoAider.id}` : "";

  const job = ctx && ctx !== "failed" ? ctx.job : null;

  /* The site's state: the address's when it names one, otherwise the one the
     person on site picks — from every state, so a job the template can't
     write for says so instead of taking New South Wales by default. */
  const jobState = job?.state ?? null;
  const siteState = jobState ?? (pickedState || null);
  const stateCovered = jurisdictionOf(siteState);
  const pickedOut = !jobState && !!siteState && !stateCovered;

  /* A CORRECTION CARRIES the sign-ons and the site walk, so it is offered
     only while how the work is done is unchanged. */
  const changes = prev ? methodChanges(prev.answers, a) : [];
  const correction = !!prev && !material && changes.length === 0;

  const cats = categoriesOf(a);
  const content = buildSwms(a, {
    work: "",
    electricianName: stepOn(a, "power") ? personName(electrician) : null,
    firstAiderName: personName(aider),
  });
  const problems: { field: ProblemField | "reason" | "state"; text: string }[] = issueProblemList(a, {
    people: people.length,
    responsibleChosen: responsibleOk,
    electricianChosen: electricianOk,
    siteChecked: checked || correction,
  });
  if (pickedOut && siteState) problems.unshift({ field: "state", text: stateNotCovered(siteState) });
  else if (!siteState) problems.unshift({ field: "state", text: "Choose the state this job is in." });
  if (prev && !reason.trim()) problems.unshift({ field: "reason", text: "Say what changed and why." });
  const version = prev ? prev.version + 1 : 1;

  /** The key the server reads: a helper by their place among the named. */
  const serverKey = (key: string): string | null => {
    if (!key) return null;
    if (key.startsWith("out:")) {
      const i = named.findIndex((o) => `out:${o.id}` === key);
      return i < 0 ? null : `outside:${i}`;
    }
    return key;
  };

  /* What issue sends, built by a function its try CALLS rather than written
     inside it: React Compiler 1.0 cannot lower a value block — these `??`s
     and ternaries — inside a try/catch, and gives up on the whole component
     when it meets one. Called from the try, a throw while it is built still
     lands in the same catch. */
  const request = (responsibleStaffId: string) => ({
    jobUuid,
    swmsId: prev?.swmsId ?? null,
    reason: prev ? reason : null,
    material: !correction,
    answers: a,
    staffIds: covers,
    outsiders: named.map((o) => ({ name: o.name.trim(), company: o.company.trim() || null })),
    responsibleStaffId,
    electrician: stepOn(a, "power") ? serverKey(electrician) : null,
    firstAider: serverKey(aider),
    siteChecked: checked,
  });

  const issue = async () => {
    if (!ctx || ctx === "failed" || !responsible) return;
    setBusy(true);
    setError(null);
    await withCleanup(async () => {
      try {
        const res = await issueSwms(request(responsible));
        if (res.ok) {
          setIssued({ versionId: res.versionId, version: res.version });
          /* the people it names are asked in their bells — this one included */
          window.dispatchEvent(new Event(BELL_REFRESH_EVENT));
          onIssued();
        } else {
          setError(issueRefusal(res.problems));
        }
      } catch {
        setError(ISSUE_FAILED);
      }
    }, () => setBusy(false));
  };


  /* ── helpers from outside the business, as rows ──────────────────────────
     A typed name IS a person on the SWMS. There is no "add" to forget: the
     last row is always blank, and typing into it makes it a helper. */
  const editOutsider = (id: string, patch: Partial<Outsider>) => {
    if (id === blankId) {
      setOutsiders((rows) => [...rows, { id, name: "", company: "", ...patch }]);
      setBlankId(newId());
    } else {
      setOutsiders((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    }
    touch();
  };
  const clearOutsider = (id: string) => {
    setOutsiders((rows) => rows.filter((r) => r.id !== id));
    if (electrician === `out:${id}`) setElectrician("");
    if (aider === `out:${id}`) {
      setFirstAider("");
      setAiderChosen(false);
    }
    touch();
  };
  const toggleCover = (id: string, on: boolean) => {
    const next = on ? [...covers, id] : covers.filter((x) => x !== id);
    setCovers(next);
    if (!on && responsible === id) setResponsible(next[0] ?? null);
    if (!on && electrician === `staff:${id}`) setElectrician("");
    if (!on && aiderChosen && firstAider === `staff:${id}`) {
      setFirstAider("");
      setAiderChosen(false);
    }
    if (on && !responsible) setResponsible(id);
    touch();
  };
  const chooseElectrician = (value: string) => {
    if (value === "new") {
      const id = newId();
      setOutsiders((rows) => [...rows, { id, name: "", company: "" }]);
      setElectrician(`out:${id}`);
      focusSoon("swz-elec-name");
    } else {
      setElectrician(value);
      /* the electrician is on the SWMS: choosing them covers them */
      if (value.startsWith("staff:")) cover(value.slice(6));
    }
    touch();
  };
  const electricianRow = electrician.startsWith("out:") ? outsiders.find((o) => `out:${o.id}` === electrician) : undefined;

  /* ── the screens ─────────────────────────────────────────────────────── */

  const kindFromJob = job ? kindFromCategory(job.categoryName) : null;
  const work = (
    <div className="wzd-form">
      {job?.description && (
        <Group heading="The work">
          <p className="wzd-text">{job.description}</p>
        </Group>
      )}
      <Q label="The job" id="swz-kind" sub={kindFromJob && job?.categoryName ? `From the job's category, ${job.categoryName}` : null}>
        <Tray
          ariaLabel="The job"
          value={a.kind}
          options={[
            { value: "install", label: "Install or replace" },
            { value: "service", label: "Service or repair" },
          ]}
          onChange={setKind}
        />
      </Q>
      {/* what the address says is a fact, not a question */}
      {job?.jurisdiction ? (
        <Q label="State" sub="From the site address">
          <span className="wzd-said">{STATE_NAME[job.jurisdiction]}</span>
        </Q>
      ) : (
        <Q label="State" htmlFor="swz-state" sub="The address doesn't say">
          <Chooser
            id="swz-state"
            className="wzd-short"
            placeholder="Choose the state"
            value={pickedState || null}
            options={AU_STATES.map((st) => ({ value: st, label: STATE_NAME[st] }))}
            onChange={(v) => {
              const picked = v as AuState;
              setPickedState(picked);
              const rules = jurisdictionOf(picked);
              if (rules) set({ jurisdiction: rules, roofPower: rules === "QLD" ? "off" : a.roofPower });
              else touch();
            }}
          />
        </Q>
      )}
      <Q label="Overhead powerlines near the work?">
        <Tray ariaLabel="Overhead powerlines" value={a.site.powerlines ? "yes" : "no"} options={NO_YES} onChange={(v) => setSite("powerlines", v === "yes")} />
      </Q>
      <Q label="Next to a road or driveway with traffic?">
        <Tray ariaLabel="Traffic" value={a.site.traffic ? "yes" : "no"} options={NO_YES} onChange={(v) => setSite("traffic", v === "yes")} />
      </Q>
      <Q label="A builder running the site?" sub="They get a copy before work starts">
        <Tray ariaLabel="Builder" value={a.site.builder ? "yes" : "no"} options={NO_YES} onChange={(v) => setSite("builder", v === "yes")} />
      </Q>
      {/* named, so the document says who was handed a copy */}
      {a.site.builder && (
        <Field label="The builder" id="swz-builder">
          <TextInput className="wzd-short" placeholder="Their name" value={a.builderName} onChange={(e) => set({ builderName: e.target.value })} />
        </Field>
      )}
      {pickedOut && siteState && <p className="wzd-wrong">{stateNotCovered(siteState)}</p>}
      {a.kind === "service" && <p className="wzd-note">A service or repair needs a SWMS only for high-risk work, like going on the roof or into the roof space.</p>}
    </div>
  );

  /* a set of radio rows, named by the words over them */
  const radios = (id: string, label: string, rows: ReactNode) => (
    <div className="wzd-radios" role="radiogroup" aria-labelledby={id}>
      <span className="wzd-ql" id={id}>
        {label}
      </span>
      {rows}
    </div>
  );

  const asks: Partial<Record<StepKey, ReactNode>> = {
    roof: (
      <>
        {radios(
          "swz-fall-l",
          "Fall protection on this roof",
          <>
            <Radio name="fall" checked={a.fall === "edge"} onChange={() => set({ fall: "edge" })} label="Edge protection" />
            <Radio name="fall" checked={a.fall === "scaffold"} onChange={() => set({ fall: "scaffold" })} label="Scaffold with a stair" />
            <Radio name="fall" checked={a.fall === "ewp"} onChange={() => set({ fall: "ewp" })} label="Elevating work platform" />
            <Radio name="fall" checked={a.fall === "harness"} onChange={() => set({ fall: "harness" })} label="Harness to a roof anchor" />
          </>,
        )}
        {a.fall === "harness" && (
          <Field label="Which roof anchor" id="swz-anchor">
            <TextInput placeholder="Which anchor, and where" value={a.anchor} onChange={(e) => set({ anchor: e.target.value })} />
          </Field>
        )}
        {a.fall === "harness" && a.jurisdiction === "QLD" && (
          <Field label="Why a harness and not something higher" id="swz-qldreason">
            <TextArea rows={2} placeholder="Why edge protection, a scaffold or an EWP won't work here" value={a.qldFallReason} onChange={(e) => set({ qldFallReason: e.target.value })} />
          </Field>
        )}
      </>
    ),
    lift: (
      <Q label="How the unit goes up">
        <Tray
          ariaLabel="How the unit goes up"
          value={a.lift}
          options={[
            { value: "hoist", label: "Rope hoist" },
            { value: "crane", label: "Crane or Hiab" },
          ]}
          onChange={(v) => set({ lift: v })}
        />
      </Q>
    ),
    drill: (
      <>
        {/* asked where it changes something: the wall being drilled */}
        <Q label="Built before 1990?">
          <Tray
            ariaLabel="Built before 1990"
            value={a.site.pre1990 ? "yes" : "no"}
            options={[
              { value: "no", label: "No" },
              { value: "yes", label: "Yes or not sure" },
            ]}
            onChange={(v) => setSite("pre1990", v === "yes")}
          />
        </Q>
        <Q label="Dust control">
          <Tray
            ariaLabel="Dust control"
            value={a.dust}
            options={[
              { value: "wet", label: "Wet drilling" },
              { value: "extract", label: "On-tool extraction" },
            ]}
            onChange={(v) => set({ dust: v })}
          />
        </Q>
        {radios(
          "swz-silica-l",
          "Silica dust",
          <>
            <Radio name="silica" checked={a.silica === "high"} onChange={() => set({ silica: "high" })} label="High risk" sub="Power-tool drilling of brick or concrete" />
            <Radio name="silica" checked={a.silica === "low"} onChange={() => set({ silica: "low" })} label="Not high risk" />
          </>,
        )}
        {a.silica === "low" && (
          <Field label="Why it isn't high risk" id="swz-silicawhy">
            <TextInput value={a.silicaWhy} onChange={(e) => set({ silicaWhy: e.target.value })} />
          </Field>
        )}
      </>
    ),
    ceiling: radios(
      "swz-roofpower-l",
      "Power while in the roof space",
      <>
        <Radio
          id="swz-roofpower"
          name="roofPower"
          checked={a.roofPower === "off"}
          onChange={() => set({ roofPower: "off" })}
          label="Mains off at the main switchboard, locked and tagged"
          sub={a.jurisdiction === "QLD" ? "Required in Queensland for a house roof space" : null}
        />
        {a.jurisdiction !== "QLD" && (
          <Radio name="roofPower" checked={a.roofPower === "rcd"} onChange={() => set({ roofPower: "rcd" })} label="Only the RCD-protected socket circuit left on" />
        )}
      </>,
    ),
    power: (
      <>
        <Field label="Isolation point" id="swz-isolation">
          <TextInput placeholder="Where the circuit is isolated" value={a.isolation} onChange={(e) => set({ isolation: e.target.value })} />
        </Field>
        <Field label="Electrician connecting it" id="swz-elec">
          <Chooser
            className="wzd-short"
            placeholder="Choose"
            value={electrician || null}
            options={[
              ...team.map((t) => ({ value: `staff:${t.id}`, label: t.name, hint: t.role || undefined })),
              ...named.map((o) => ({ value: `out:${o.id}`, label: o.name, hint: o.company || undefined })),
              /* a helper not named yet holds the choice until they are */
              electricianRow && !electricianRow.name.trim()
                ? { value: electrician, label: "Someone from outside the business" }
                : { value: "new", label: "Someone from outside the business" },
            ]}
            onChange={chooseElectrician}
          />
        </Field>
        {electricianRow && (
          <div className="wzd-pair">
            <Field label="Electrician's name" id="swz-elec-name">
              <TextInput value={electricianRow.name} onChange={(e) => editOutsider(electricianRow.id, { name: e.target.value })} />
            </Field>
            <Field label="Electrician's company">
              <TextInput value={electricianRow.company} onChange={(e) => editOutsider(electricianRow.id, { company: e.target.value })} />
            </Field>
          </div>
        )}
      </>
    ),
    charge: (
      <Q label="Refrigerant">
        <Tray ariaLabel="Refrigerant" value={a.refrigerant as Refrigerant} options={REFRIGERANTS} onChange={(v) => set({ refrigerant: v })} />
      </Q>
    ),
  };

  const offered = stepsFor(a.kind);
  const how = (
    <div className="wzd-form">
      <Group heading="Steps on this job" fact={`${offered.filter((k) => a.steps[k]).length} of ${offered.length}`}>
        <div className="wzd-steps">
          {offered.map((k, i) => (
            <div key={k} className="wzd-step">
              <Tick
                id={i === 0 ? "swz-step-first" : undefined}
                className="wzd-tick"
                checked={a.steps[k]}
                onChange={(on) => setStepOn(k, on)}
                label={<TickWords main={STEP_TITLE[k]} sub={STEP_SUB[k]} />}
              />
              {a.steps[k] && asks[k] && <div className="wzd-ask">{asks[k]}</div>}
            </div>
          ))}
        </div>
      </Group>
      <Field label="Anything different about this site" id="swz-notes">
        <TextArea rows={3} value={a.siteNotes} onChange={(e) => set({ siteNotes: e.target.value })} />
      </Field>
    </div>
  );

  /* the hospital the last SWMS in this postcode named, while it's still the one filled in */
  const nearby = !prev && ctx && ctx !== "failed" && ctx.hospital && a.hospital === ctx.hospital.name ? ctx.hospital : null;
  const who = (
    <div className="wzd-form">
      <Group heading="From your team" fact={`${coveredTeam.length} chosen`}>
        {team.length === 0 ? (
          <p className="wzd-note">Nobody active on the team yet.</p>
        ) : (
          <ul className="wzd-rows">
            {team.map((t, i) => {
              const on = covers.includes(t.id);
              return (
                <li key={t.id} className="wzd-row">
                  <Tick
                    id={i === 0 ? "swz-team" : undefined}
                    className="wzd-tick"
                    checked={on}
                    onChange={(next) => toggleCover(t.id, next)}
                    label={
                      <span className="wzd-words">
                        <span className="wzd-title">{t.name}</span>
                        <span className="wzd-sub">{t.booked ? (t.role ? `${t.role}, booked on this job` : "Booked on this job") : t.role || "Team member"}</span>
                        {on && (
                          <span className="wzd-tickets">
                            {t.tickets.length === 0 ? (
                              <span className="wzd-look">No tickets on file</span>
                            ) : (
                              t.tickets.map((k) => (
                                <span key={k.name} className={k.current ? undefined : "wzd-look"}>
                                  {k.current ? k.name : `${k.name}, expired`}
                                </span>
                              ))
                            )}
                          </span>
                        )}
                      </span>
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Group>

      <Group heading="Someone from outside the business">
        <div className="wzd-outsiders">
          {[...outsiders, { id: blankId, name: "", company: "" }].map((o, i) => (
            <div key={o.id} className="wzd-addrow">
              <TextInput
                aria-label={o.id === blankId ? "Their name" : `Name ${i + 1}`}
                placeholder="Name"
                value={o.name}
                onChange={(e) => editOutsider(o.id, { name: e.target.value })}
              />
              <TextInput
                aria-label={o.id === blankId ? "Their company" : `Company ${i + 1}`}
                placeholder="Company"
                value={o.company}
                onChange={(e) => editOutsider(o.id, { company: e.target.value })}
              />
              {o.id !== blankId ? (
                <IconButton glyph="clear" label={`Clear ${o.name.trim() || "this row"}`} onClick={() => clearOutsider(o.id)} />
              ) : (
                <span aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      </Group>

      <Group heading="In charge on site">
        {coveredTeam.length === 0 ? (
          <p className="wzd-note">Choose someone from your team first.</p>
        ) : (
          <div className="wzd-radios" role="radiogroup" aria-label="In charge on site">
            {coveredTeam.map((t, i) => (
              <Radio
                key={t.id}
                id={i === 0 ? "swz-resp" : undefined}
                name="responsible"
                checked={responsible === t.id}
                onChange={() => {
                  setResponsible(t.id);
                  touch();
                }}
                label={t.name}
              />
            ))}
          </div>
        )}
      </Group>

      <Group heading="Emergency">
        <div className="wzd-form">
          <Q label="First aider" htmlFor="swz-aid" sub={!aiderChosen && autoAider ? "Has first aid on file" : null}>
            <Chooser
              id="swz-aid"
              className="wzd-short"
              value={aider}
              options={[{ value: "", label: "Not named" }, ...people.map((p) => ({ value: p.key, label: p.name }))]}
              onChange={(v) => {
                setFirstAider(v);
                setAiderChosen(true);
                touch();
              }}
            />
          </Q>
          <Q label="Fire extinguisher">
            <Tray
              ariaLabel="Fire extinguisher"
              value={a.extinguisher}
              options={[
                { value: "van", label: "In the van" },
                { value: "site", label: "On site" },
              ]}
              onChange={(v) => set({ extinguisher: v })}
            />
          </Q>
          <Q label="Nearest hospital" htmlFor="swz-hosp" sub={nearby ? (nearby.jobNumber ? `From job #${nearby.jobNumber}, in the same postcode` : "From a SWMS in the same postcode") : null}>
            <TextInput id="swz-hosp" className="wzd-short" value={a.hospital} onChange={(e) => set({ hospital: e.target.value })} />
          </Q>
        </div>
      </Group>
    </div>
  );

  const extras = new Set(a.extraCategories);
  const auto = new Set(categoriesOf({ ...a, extraCategories: [] }).map((c) => c.n));
  const listed = problems.filter((p) => p.field !== "siteChecked");
  const review = (
    <div className="wzd-form">
      <dl className="wzd-rev">
        <div>
          <dt>Steps</dt>
          <dd>
            {content.steps.length === 1 ? "1 step" : `${content.steps.length} steps`}
            {content.steps.length > 0 && <small>{content.steps.map((st) => st.title).join(", ")}</small>}
          </dd>
        </div>
        <div>
          <dt>Covers</dt>
          <dd>
            {people.length === 1 ? "1 person" : `${people.length} people`}
            {people.length > 0 && <small>{people.map((p) => p.name).join(", ")}</small>}
            {/* the Who screen warns about this; the read-back used to let it
                through in silence, and paper printed "None on file" */}
            {noTickets.length > 0 && (
              <small className="wzd-look">{`${andList(noTickets.map((t) => t.name))} ${noTickets.length === 1 ? "has" : "have"} no current ticket on file`}</small>
            )}
          </dd>
        </div>
        <div>
          <dt>In charge on site</dt>
          <dd>{responsibleOk ? team.find((t) => t.id === responsible)?.name : "—"}</dd>
        </div>
        <div>
          <dt>Builder</dt>
          <dd>
            {a.site.builder ? (
              <span className="wzd-look">{`${a.builderName.trim() || "The builder"} gets a copy before work starts`}</span>
            ) : (
              "No builder on this job"
            )}
          </dd>
        </div>
        {/* the emergency answers, where the rest of the SWMS is read back —
            a SWMS with nobody named as first aider went out unnoticed */}
        <div>
          <dt>Emergency</dt>
          <dd>
            {personName(aider) ?? <span className="wzd-look">Nobody named as first aider</span>}
            <small>{`Nearest hospital: ${a.hospital.trim() || "not named yet"}. Fire extinguisher: ${a.extinguisher === "van" ? "in the van" : "on site"}.`}</small>
          </dd>
        </div>
        <div>
          <dt>Rules</dt>
          <dd>
            {stateCovered ? (
              <>
                {STATE_NAME[stateCovered]}
                <small>{REGULATION[stateCovered]}</small>
              </>
            ) : (
              /* never assert New South Wales over a site just said to be elsewhere */
              <span className="wzd-wrong">{siteState ? `${STATE_NAME[siteState]}, which this template doesn't cover` : "No state chosen yet"}</span>
            )}
          </dd>
        </div>
      </dl>

      <Group heading="High-risk construction work" fact={cats.length === 1 ? "1 on this job" : `${cats.length} on this job`}>
        {cats.length === 0 ? (
          <p className="wzd-note">None from the steps ticked.</p>
        ) : (
          <ul className="wzd-rows">
            {cats.map((cat) => (
              <li key={cat.n} className="wzd-row wzd-row--end">
                <span className="wzd-words">
                  <span className="wzd-title">{PLAIN.get(cat.n)}</span>
                  <span className="wzd-sub">{cat.reason}</span>
                </span>
                {!auto.has(cat.n) && (
                  <IconButton glyph="clear" label={`Clear ${PLAIN.get(cat.n)}`} onClick={() => set({ extraCategories: a.extraCategories.filter((n) => n !== cat.n) })} />
                )}
              </li>
            ))}
          </ul>
        )}
        {moreCategories ? (
          <ul className="wzd-rows">
            {HRCW.filter((h) => !auto.has(h.n) && !extras.has(h.n)).map((h) => (
              <li key={h.n} className="wzd-row">
                <Tick checked={false} onChange={() => set({ extraCategories: [...a.extraCategories, h.n].sort((x, y) => x - y) })} label={h.plain} />
              </li>
            ))}
          </ul>
        ) : (
          <Button kind="quiet" size={32} className="wzd-start" onClick={() => setMoreCategories(true)}>
            Add another category
          </Button>
        )}
      </Group>

      <Group heading="Risk scores">
        <Tick
          className="wzd-tick"
          checked={a.riskAppendix}
          onChange={(on) => set({ riskAppendix: on })}
          label={<TickWords main="Add a risk score appendix" sub="Likelihood and consequence for each step, before and after its controls, on a page of its own" />}
        />
      </Group>

      {prev && (
        <div className="wzd-form">
          <Field label="What changed" id="swz-reason">
            <TextArea
              rows={2}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                touch();
              }}
            />
          </Field>
          <div className="wzd-radios" role="radiogroup" aria-label="What kind of change">
            <Radio
              name="material"
              checked={!correction}
              onChange={() => {
                setMaterial(true);
                touch();
              }}
              label="It changes how the work is done"
              sub="Everyone signs on again, and the site is walked again"
            />
            <Radio
              name="material"
              checked={correction}
              disabled={changes.length > 0}
              onChange={() => {
                setMaterial(false);
                touch();
              }}
              label="It's a correction"
              sub={changes.length > 0 ? `${capital(andList(changes))} changed, so everyone signs on again` : "Sign-ons and the site walk carry over"}
            />
          </div>
        </div>
      )}

      <Jumps items={listed.map((p) => ({ key: p.field, text: p.text }))} onJump={(_, i) => jump(listed[i]!.field)} />

      {/* a correction stands on the walk the version it corrects was issued on */}
      {!correction && (
        <Tick
          id="swz-walked"
          className="wzd-tick"
          checked={checked}
          onChange={(on) => {
            setChecked(on);
            touch();
          }}
          label={<TickWords main="I've walked this site and this SWMS matches it" sub="Recorded with your name and the time" />}
        />
      )}
    </div>
  );

  /* What the last screen's greyed-out button is waiting for: the problems
     the list shows, counted as the list shows them — the site walk is a tick
     on the screen, not a line in the list, so it is named rather than counted. */
  const waitingFor = listed.length
    ? listed.length === 1
      ? listed[0].text
      : `${listed.length} things to answer above`
    : problems.length > 0
      ? problems[0].text
      : "";

  /* ── the frame ───────────────────────────────────────────────────────── */

  let body: ReactNode;
  let foot: ReactNode = null;
  let tabs = false;
  let title = prev ? "Revise the SWMS" : "Safe Work Method Statement";
  const closeOnly = (
    <Button kind="main" onClick={onClose}>
      Close
    </Button>
  );

  if (ctx === null) {
    body = <p className="wzd-note">Reading the job and the team</p>;
  } else if (ctx === "failed") {
    body = <p className="wzd-note">Couldn&apos;t open the SWMS for this job. Close it and try again.</p>;
    foot = closeOnly;
  } else if (stale) {
    /* the version this was opened to revise has been replaced; carrying on
       would file a second SWMS on the job */
    title = "This SWMS has moved on";
    body = <p className="wzd-text">A newer version was issued while this card was open. Close it and open the job again to revise the current one.</p>;
    foot = closeOnly;
  } else if (ctx.job.state && !ctx.job.jurisdiction) {
    /* named, and nothing to press: a SWMS to another state's rules is worse than none */
    body = <p className="wzd-text">{stateNotCovered(ctx.job.state)}</p>;
    foot = closeOnly;
  } else if (!ctx.libraryApproved) {
    if (ctx.canApprove) {
      title = "Approve the SWMS template";
      body = (
        <div className="wzd-form">
          <p className="wzd-text">
            Every SWMS is written from these steps and controls. Anything specific to a site is typed on site and printed as it was
            entered. Approve them once, and anyone on the team can issue a SWMS.
          </p>
          <TemplateSteps />
        </div>
      );
      foot = (
        <>
          <Button kind="second" onClick={onClose}>
            Cancel
          </Button>
          <ApproveTemplate onApproved={() => setCtx((c) => (c && c !== "failed" ? { ...c, libraryApproved: true } : c))} />
        </>
      );
    } else {
      title = "The SWMS template needs approving";
      body = <p className="wzd-text">{`${ctx.ownerName ?? "The owner"} approves it before the first SWMS can be issued, and it's waiting in their bell.`}</p>;
      foot = closeOnly;
    }
  } else if (issued) {
    /* who a correction carried is signed on already; everyone else — anyone
       it added, anyone who hadn't signed — is asked, here or in their bell */
    const carriedStaff = new Set(correction && prev ? prev.signedStaffIds : []);
    const carriedOutside = new Set(correction && prev ? prev.signedOutsideNames : []);
    const me = coveredTeam.find((t) => t.id === ctx.viewerStaffId && !carriedStaff.has(t.id));
    const inBells = coveredTeam.filter((t) => t.id !== ctx.viewerStaffId && !carriedStaff.has(t.id));
    const here = [
      ...(me ? [{ key: "me", name: me.name, sub: "You" }] : []),
      ...named
        .filter((o) => !carriedOutside.has(o.name.trim().toLowerCase()))
        .map((o) => ({ key: o.id, name: o.name.trim(), sub: o.company.trim() || "Outside the business" })),
    ];
    title = issued.version > 1 ? `Version ${issued.version} is on the job` : "The SWMS is on the job";
    body = (
      <div className="wzd-form">
        <p className="wzd-text">
          {correction ? "Filed under Documents, Compliance. Anyone who signed on before stays signed on." : "Filed under Documents, Compliance."}
        </p>
        {inBells.length > 0 && (
          <Group heading="Asked in their bell">
            <p className="wzd-text">{inBells.map((t) => t.name).join(", ")}</p>
          </Group>
        )}
        {here.length > 0 && (
          <Group heading="Signing on here">
            <ul className="wzd-rows">
              {here.map((p) => (
                <li key={p.key} className="wzd-row">
                  <span className="wzd-words">
                    <span className="wzd-title">{p.name}</span>
                    <span className="wzd-sub">{p.sub}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Group>
        )}
        {a.site.builder && (
          <p className="wzd-look">{`${a.builderName.trim() || "The builder"} gets a copy before work starts — open the SWMS and send them the PDF.`}</p>
        )}
      </div>
    );
    foot = (
      <>
        <Button kind="second" onClick={() => onOpen(issued.versionId)}>
          Open the SWMS
        </Button>
        {here.length > 0 ? (
          <>
            <Button kind="second" onClick={onClose}>
              Done
            </Button>
            <Button kind="main" onClick={() => onSignOn(issued.versionId)}>
              Sign on now
            </Button>
          </>
        ) : (
          <Button kind="main" onClick={onClose}>
            Done
          </Button>
        )}
      </>
    );
  } else {
    tabs = true;
    const at = TABS.findIndex((t) => t.key === tab);
    foot = (
      <>
        {/* the tabs say which screen this is; the last one says what the
            greyed-out button is still waiting for */}
        {error ? <FootWord tone="wrong">{error}</FootWord> : at === 3 && waitingFor ? <FootWord tone="look">{waitingFor}</FootWord> : null}
        {at > 0 ? (
          <Button kind="second" onClick={() => go(TABS[at - 1].key)}>
            Back
          </Button>
        ) : (
          <Button kind="second" onClick={askClose}>
            Cancel
          </Button>
        )}
        {at < 3 ? (
          <Button kind="main" onClick={() => go(TABS[at + 1].key)}>
            Continue
          </Button>
        ) : (
          <Button kind="main" disabled={busy || problems.length > 0} onClick={issue}>
            {busy ? "Issuing the SWMS" : prev ? `Issue version ${version}` : "Issue the SWMS"}
          </Button>
        )}
      </>
    );
  }

  const panels: Record<Tab, ReactNode> = { work, how, who, review };

  return (
    <>
      <WizardDialog
        heading={title}
        line={jobLine(job)}
        width={720}
        tall={tabs}
        onClose={askClose}
        foot={foot}
        scrollRef={bodyRef}
        tabs={tabs ? { items: TABS, current: tab, onGo: (k) => go(k as Tab), ariaLabel: "SWMS steps", idPrefix: "swztab", panelPrefix: "swzsec" } : null}
      >
        {tabs
          ? TABS.map((t) => (
              <section key={t.key} id={`swzsec-${t.key}`} role="tabpanel" aria-labelledby={`swztab-${t.key}`} hidden={tab !== t.key}>
                {panels[t.key]}
              </section>
            ))
          : body}
      </WizardDialog>
      <ConfirmDialog
        open={confirmClose}
        heading="Discard this SWMS?"
        confirm="Discard"
        cancel="Keep editing"
        onConfirm={onClose}
        onClose={() => setConfirmClose(false)}
      />
    </>
  );
}
