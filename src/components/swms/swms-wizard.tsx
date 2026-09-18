"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { ViewTabs } from "@/components/shell/view-tabs";
import {
  issueSwms,
  swmsPrevious,
  swmsWizardContext,
  type SwmsPrevious,
  type SwmsWizardContext,
} from "@/app/actions/swms";
import { BELL_REFRESH_EVENT } from "@/lib/dashboard/chips";
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

   IT WEARS THE CARD. It opens over the job card inside the card's portal, so
   it takes the card's band, tabs, fields and buttons rather than a dress of
   its own — two sets of controls stacked on one screen is the first thing a
   daily user notices. */

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
  ["R32", "R32"],
  ["R410A", "R410A"],
  ["R454B", "R454B"],
  ["R290", "R290"],
] as const;
type Refrigerant = (typeof REFRIGERANTS)[number][0];

const REGULATION = {
  NSW: "Work Health and Safety Regulation 2025 (NSW)",
  QLD: "Work Health and Safety Regulation 2011 (Qld)",
} as const;
const PLAIN = new Map(HRCW.map((c) => [c.n, c.plain]));

/** A current first aid ticket on their staff card. */
const hasFirstAid = (t: SwmsTeamMember) => t.tickets.some((k) => k.current && isFirstAidTicket(k.name));
const capital = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
  id,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  id?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text], i) => (
        <button
          key={v}
          id={i === 0 ? id : undefined}
          type="button"
          className={value === v ? "on" : undefined}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Choice({
  name,
  checked,
  onChange,
  title,
  sub,
  kind = "radio",
  id,
  disabled = false,
}: {
  name: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  title: string;
  sub?: string | null;
  kind?: "radio" | "checkbox";
  id?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`sw-opt${checked ? " on" : ""}${disabled ? " off" : ""}`}>
      <input id={id} type={kind} name={name} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <b>{title}</b>
        {sub && <em>{sub}</em>}
      </span>
    </label>
  );
}

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
  const closeRef = useRef<HTMLButtonElement>(null);
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

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  /* A field, reached: after its screen has painted, focus it and bring it
     into view. Two frames — the first commits the tab, the second lays it out. */
  const focusSoon = (id: string) => {
    const land = () => {
      const el = document.getElementById(id);
      el?.scrollIntoView?.({ block: "center" });
      el?.focus();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(land));
    else setTimeout(land, 0);
  };

  const askClose = () => {
    if (dirty && !issued) setConfirmClose(true);
    else onClose();
  };

  /* Escape closes the wizard, never the card under it — the card's own
     listener stands aside while the wizard is open. A wizard with choices in
     it asks first: a stray key shouldn't throw away a site walk. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmClose) setConfirmClose(false);
      else if (dirty && !issued) setConfirmClose(true);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmClose, dirty, issued, onClose]);

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

  const issue = async () => {
    if (!ctx || ctx === "failed" || !responsible) return;
    setBusy(true);
    setError(null);
    try {
      const res = await issueSwms({
        jobUuid,
        swmsId: prev?.swmsId ?? null,
        reason: prev ? reason : null,
        material: !correction,
        answers: a,
        staffIds: covers,
        outsiders: named.map((o) => ({ name: o.name.trim(), company: o.company.trim() || null })),
        responsibleStaffId: responsible,
        electrician: stepOn(a, "power") ? serverKey(electrician) : null,
        firstAider: serverKey(aider),
        siteChecked: checked,
      });
      if (res.ok) {
        setIssued({ versionId: res.versionId, version: res.version });
        /* the people it names are asked in their bells — this one included */
        window.dispatchEvent(new Event(BELL_REFRESH_EVENT));
        onIssued();
      } else {
        setError(res.problems[0] ?? "Couldn't issue the SWMS. Try again.");
      }
    } catch {
      setError("Couldn't issue the SWMS. Try again.");
    } finally {
      setBusy(false);
    }
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
    <>
      {job?.description && (
        <div className="sw-grp">
          <div className="sw-gh">
            <b>The work</b>
          </div>
          <p className="sw-text">{job.description}</p>
        </div>
      )}
      <div className="sw-qas">
        <div className="sw-qa">
          <span>
            The job
            {kindFromJob && job?.categoryName && <em>{`From the job's category, ${job.categoryName}`}</em>}
          </span>
          <Seg id="swz-kind" label="The job" value={a.kind} options={[["install", "Install or replace"], ["service", "Service or repair"]] as const} onChange={setKind} />
        </div>
        {/* what the address says is a fact, not a question */}
        {job?.jurisdiction ? (
          <div className="sw-qa">
            <span>
              State
              <em>From the site address</em>
            </span>
            <b>{STATE_NAME[job.jurisdiction]}</b>
          </div>
        ) : (
          <div className="sw-qa">
            <span>
              <label htmlFor="swz-state">State</label>
              <em>The address doesn&apos;t say</em>
            </span>
            <select
              id="swz-state"
              className="wb2-sel"
              value={pickedState}
              onChange={(e) => {
                const picked = e.target.value as AuState | "";
                setPickedState(picked);
                const rules = jurisdictionOf(picked || null);
                if (rules) set({ jurisdiction: rules, roofPower: rules === "QLD" ? "off" : a.roofPower });
                else touch();
              }}
            >
              <option value="">Choose the state</option>
              {AU_STATES.map((st) => (
                <option key={st} value={st}>
                  {STATE_NAME[st]}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="sw-qa">
          <span>Overhead powerlines near the work?</span>
          <Seg label="Overhead powerlines" value={a.site.powerlines ? "yes" : "no"} options={[["no", "No"], ["yes", "Yes"]] as const} onChange={(v) => setSite("powerlines", v === "yes")} />
        </div>
        <div className="sw-qa">
          <span>Next to a road or driveway with traffic?</span>
          <Seg label="Traffic" value={a.site.traffic ? "yes" : "no"} options={[["no", "No"], ["yes", "Yes"]] as const} onChange={(v) => setSite("traffic", v === "yes")} />
        </div>
        <div className="sw-qa">
          <span>
            A builder running the site?<em>They get a copy before work starts</em>
          </span>
          <Seg label="Builder" value={a.site.builder ? "yes" : "no"} options={[["no", "No"], ["yes", "Yes"]] as const} onChange={(v) => setSite("builder", v === "yes")} />
        </div>
        {/* named, so the document says who was handed a copy */}
        {a.site.builder && (
          <div className="sw-qa">
            <label htmlFor="swz-builder">The builder</label>
            <input id="swz-builder" className="wb2-fi" placeholder="Their name" value={a.builderName} onChange={(e) => set({ builderName: e.target.value })} />
          </div>
        )}
      </div>
      {pickedOut && siteState && <p className="sw-state bad">{stateNotCovered(siteState)}</p>}
      {a.kind === "service" && (
        <p className="sw-note">A service or repair needs a SWMS only for high-risk work, like going on the roof or into the roof space.</p>
      )}
    </>
  );

  const asks: Partial<Record<StepKey, React.ReactNode>> = {
    roof: (
      <div className="sw-ask">
        <span className="sw-al">Fall protection on this roof</span>
        <div className="sw-opts">
          <Choice name="fall" checked={a.fall === "edge"} onChange={() => set({ fall: "edge" })} title="Edge protection" />
          <Choice name="fall" checked={a.fall === "scaffold"} onChange={() => set({ fall: "scaffold" })} title="Scaffold with a stair" />
          <Choice name="fall" checked={a.fall === "ewp"} onChange={() => set({ fall: "ewp" })} title="Elevating work platform" />
          <Choice name="fall" checked={a.fall === "harness"} onChange={() => set({ fall: "harness" })} title="Harness to a roof anchor" />
        </div>
        {a.fall === "harness" && (
          <input id="swz-anchor" className="wb2-fi" aria-label="Which roof anchor" placeholder="Which anchor, and where" value={a.anchor} onChange={(e) => set({ anchor: e.target.value })} />
        )}
        {a.fall === "harness" && a.jurisdiction === "QLD" && (
          <textarea
            id="swz-qldreason"
            className="wb2-notes"
            rows={2}
            aria-label="Why a harness and not something higher"
            placeholder="Why edge protection, a scaffold or an EWP won't work here"
            value={a.qldFallReason}
            onChange={(e) => set({ qldFallReason: e.target.value })}
          />
        )}
      </div>
    ),
    lift: (
      <div className="sw-ask">
        <span className="sw-al">How the unit goes up</span>
        <div className="sw-opts row">
          <Choice name="lift" checked={a.lift === "hoist"} onChange={() => set({ lift: "hoist" })} title="Rope hoist" />
          <Choice name="lift" checked={a.lift === "crane"} onChange={() => set({ lift: "crane" })} title="Crane or Hiab" />
        </div>
      </div>
    ),
    drill: (
      <div className="sw-ask">
        {/* asked where it changes something: the wall being drilled */}
        <span className="sw-al">Built before 1990?</span>
        <Seg
          label="Built before 1990"
          value={a.site.pre1990 ? "yes" : "no"}
          options={[["no", "No"], ["yes", "Yes or not sure"]] as const}
          onChange={(v) => setSite("pre1990", v === "yes")}
        />
        <span className="sw-al">Dust control</span>
        <div className="sw-opts row">
          <Choice name="dust" checked={a.dust === "wet"} onChange={() => set({ dust: "wet" })} title="Wet drilling" />
          <Choice name="dust" checked={a.dust === "extract"} onChange={() => set({ dust: "extract" })} title="On-tool extraction" />
        </div>
        <span className="sw-al">Silica dust</span>
        <div className="sw-opts">
          <Choice name="silica" checked={a.silica === "high"} onChange={() => set({ silica: "high" })} title="High risk" sub="Power-tool drilling of brick or concrete" />
          <Choice name="silica" checked={a.silica === "low"} onChange={() => set({ silica: "low" })} title="Not high risk" />
        </div>
        {a.silica === "low" && (
          <input id="swz-silicawhy" className="wb2-fi" aria-label="Why it isn't high risk" placeholder="Why it isn't high risk" value={a.silicaWhy} onChange={(e) => set({ silicaWhy: e.target.value })} />
        )}
      </div>
    ),
    ceiling: (
      <div className="sw-ask">
        <span className="sw-al">Power while in the roof space</span>
        <div className="sw-opts">
          <Choice
            id="swz-roofpower"
            name="roofPower"
            checked={a.roofPower === "off"}
            onChange={() => set({ roofPower: "off" })}
            title="Mains off at the main switchboard, locked and tagged"
            sub={a.jurisdiction === "QLD" ? "Required in Queensland for a house roof space" : null}
          />
          {a.jurisdiction !== "QLD" && (
            <Choice name="roofPower" checked={a.roofPower === "rcd"} onChange={() => set({ roofPower: "rcd" })} title="Only the RCD-protected socket circuit left on" />
          )}
        </div>
      </div>
    ),
    power: (
      <div className="sw-ask">
        <label className="sw-al" htmlFor="swz-isolation">
          Isolation point
        </label>
        <input id="swz-isolation" className="wb2-fi" placeholder="Where the circuit is isolated" value={a.isolation} onChange={(e) => set({ isolation: e.target.value })} />
        <label className="sw-al" htmlFor="swz-elec">
          Electrician connecting it
        </label>
        <select id="swz-elec" className="wb2-sel" value={electrician} onChange={(e) => chooseElectrician(e.target.value)}>
          <option value="">Choose</option>
          {team.map((t) => (
            <option key={t.id} value={`staff:${t.id}`}>
              {t.role ? `${t.name}, ${t.role}` : t.name}
            </option>
          ))}
          {named.map((o) => (
            <option key={o.id} value={`out:${o.id}`}>
              {o.company ? `${o.name}, ${o.company}` : o.name}
            </option>
          ))}
          {/* a helper not named yet holds the choice until they are */}
          {electricianRow && !electricianRow.name.trim() ? (
            <option value={electrician}>Someone from outside the business</option>
          ) : (
            <option value="new">Someone from outside the business</option>
          )}
        </select>
        {electricianRow && (
          <div className="sw-addrow">
            <input id="swz-elec-name" className="wb2-fi" aria-label="Electrician's name" placeholder="Name" value={electricianRow.name} onChange={(e) => editOutsider(electricianRow.id, { name: e.target.value })} />
            <input className="wb2-fi" aria-label="Electrician's company" placeholder="Company" value={electricianRow.company} onChange={(e) => editOutsider(electricianRow.id, { company: e.target.value })} />
          </div>
        )}
      </div>
    ),
    charge: (
      <div className="sw-ask">
        <span className="sw-al">Refrigerant</span>
        <Seg label="Refrigerant" value={a.refrigerant as Refrigerant} options={REFRIGERANTS} onChange={(v) => set({ refrigerant: v })} />
      </div>
    ),
  };

  const offered = stepsFor(a.kind);
  const how = (
    <>
      <div className="sw-grp">
        <div className="sw-gh">
          <b>Steps on this job</b>
          <span>{`${offered.filter((k) => a.steps[k]).length} of ${offered.length}`}</span>
        </div>
        <div className="sw-steps">
          {offered.map((k, i) => (
            <div key={k} className={`sw-stepbox${a.steps[k] ? " on" : ""}`}>
              <label className="sw-stephd">
                <input id={i === 0 ? "swz-step-first" : undefined} type="checkbox" checked={a.steps[k]} onChange={(e) => setStepOn(k, e.target.checked)} />
                <span>
                  <b>{STEP_TITLE[k]}</b>
                  <em>{STEP_SUB[k]}</em>
                </span>
              </label>
              {a.steps[k] && asks[k]}
            </div>
          ))}
        </div>
      </div>
      <div className="sw-grp">
        <label className="sw-gh" htmlFor="swz-notes">
          <b>Anything different about this site</b>
        </label>
        <textarea id="swz-notes" className="wb2-notes" rows={3} value={a.siteNotes} onChange={(e) => set({ siteNotes: e.target.value })} />
      </div>
    </>
  );

  /* the hospital the last SWMS in this postcode named, while it's still the one filled in */
  const nearby = !prev && ctx && ctx !== "failed" && ctx.hospital && a.hospital === ctx.hospital.name ? ctx.hospital : null;
  const who = (
    <>
      <div className="sw-grp">
        <div className="sw-gh">
          <b>From your team</b>
          <span>{`${coveredTeam.length} chosen`}</span>
        </div>
        <div className="sw-crew">
          {team.map((t, i) => {
            const on = covers.includes(t.id);
            return (
              <label key={t.id} className={`sw-person${on ? " on" : ""}`}>
                <input id={i === 0 ? "swz-team" : undefined} type="checkbox" checked={on} onChange={(e) => toggleCover(t.id, e.target.checked)} />
                <span className="sw-who">
                  <b>{t.name}</b>
                  <em>{t.booked ? (t.role ? `${t.role}, booked on this job` : "Booked on this job") : t.role || "Team member"}</em>
                  {on && (
                    <span className="sw-tickets">
                      {t.tickets.length === 0 ? (
                        <span className="sw-state warn">No tickets on file</span>
                      ) : (
                        t.tickets.map((k) => (
                          <span key={k.name} className={k.current ? undefined : "sw-state warn"}>
                            {k.current ? k.name : `${k.name}, expired`}
                          </span>
                        ))
                      )}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
          {team.length === 0 && <p className="sw-note">Nobody active on the team yet.</p>}
        </div>
      </div>

      <div className="sw-grp">
        <div className="sw-gh">
          <b>Someone from outside the business</b>
        </div>
        <div className="sw-outsiders">
          {[...outsiders, { id: blankId, name: "", company: "" }].map((o, i) => (
            <div key={o.id} className="sw-addrow">
              <input
                className="wb2-fi"
                aria-label={o.id === blankId ? "Their name" : `Name ${i + 1}`}
                placeholder="Name"
                value={o.name}
                onChange={(e) => editOutsider(o.id, { name: e.target.value })}
              />
              <input
                className="wb2-fi"
                aria-label={o.id === blankId ? "Their company" : `Company ${i + 1}`}
                placeholder="Company"
                value={o.company}
                onChange={(e) => editOutsider(o.id, { company: e.target.value })}
              />
              {o.id !== blankId ? (
                <button type="button" className="wb2-ico" aria-label={`Clear ${o.name.trim() || "this row"}`} onClick={() => clearOutsider(o.id)}>
                  <Icon name="x" size={14} />
                </button>
              ) : (
                <span className="sw-rowgap" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="sw-grp">
        <div className="sw-gh">
          <b>In charge on site</b>
        </div>
        {coveredTeam.length === 0 ? (
          <p className="sw-note">Choose someone from your team first.</p>
        ) : (
          <div className="sw-opts row">
            {coveredTeam.map((t, i) => (
              <Choice
                key={t.id}
                id={i === 0 ? "swz-resp" : undefined}
                name="responsible"
                checked={responsible === t.id}
                onChange={() => {
                  setResponsible(t.id);
                  touch();
                }}
                title={t.name}
              />
            ))}
          </div>
        )}
      </div>

      <div className="sw-grp">
        <div className="sw-gh">
          <b>Emergency</b>
        </div>
        <div className="sw-qas">
          <div className="sw-qa">
            <span>
              <label htmlFor="swz-aid">First aider</label>
              {!aiderChosen && autoAider && <em>Has first aid on file</em>}
            </span>
            <select
              id="swz-aid"
              className="wb2-sel"
              value={aider}
              onChange={(e) => {
                setFirstAider(e.target.value);
                setAiderChosen(true);
                touch();
              }}
            >
              <option value="">Not named</option>
              {people.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sw-qa">
            <span>Fire extinguisher</span>
            <Seg label="Fire extinguisher" value={a.extinguisher} options={[["van", "In the van"], ["site", "On site"]] as const} onChange={(v) => set({ extinguisher: v })} />
          </div>
          <div className="sw-qa">
            <span>
              <label htmlFor="swz-hosp">Nearest hospital</label>
              {nearby && <em>{nearby.jobNumber ? `From job #${nearby.jobNumber}, in the same postcode` : "From a SWMS in the same postcode"}</em>}
            </span>
            <input id="swz-hosp" className="wb2-fi" value={a.hospital} onChange={(e) => set({ hospital: e.target.value })} />
          </div>
        </div>
      </div>
    </>
  );

  const extras = new Set(a.extraCategories);
  const auto = new Set(categoriesOf({ ...a, extraCategories: [] }).map((c) => c.n));
  const review = (
    <>
      <dl className="sw-rev">
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
            {/* the Who screen warns about this in red; the read-back used to
                let it through in silence, and paper printed "None on file" */}
            {noTickets.length > 0 && (
              <small className="sw-state warn">{`${andList(noTickets.map((t) => t.name))} ${noTickets.length === 1 ? "has" : "have"} no current ticket on file`}</small>
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
              <span className="sw-state warn">{`${a.builderName.trim() || "The builder"} gets a copy before work starts`}</span>
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
            {personName(aider) ?? <span className="sw-state warn">Nobody named as first aider</span>}
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
              <span className="sw-state bad">{siteState ? `${STATE_NAME[siteState]}, which this template doesn't cover` : "No state chosen yet"}</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="sw-grp">
        <div className="sw-gh">
          <b>High-risk construction work</b>
          <span>{cats.length === 1 ? "1 on this job" : `${cats.length} on this job`}</span>
        </div>
        {cats.length === 0 ? (
          <p className="sw-note">None from the steps ticked.</p>
        ) : (
          <div className="sw-crew">
            {cats.map((cat) => (
              <div key={cat.n} className="sw-person out">
                <span className="sw-who">
                  <b>{PLAIN.get(cat.n)}</b>
                  <em>{cat.reason}</em>
                </span>
                {!auto.has(cat.n) && (
                  <button
                    type="button"
                    className="wb2-ico"
                    aria-label={`Clear ${PLAIN.get(cat.n)}`}
                    onClick={() => set({ extraCategories: a.extraCategories.filter((n) => n !== cat.n) })}
                  >
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {moreCategories ? (
          <div className="sw-cats">
            {HRCW.filter((h) => !auto.has(h.n) && !extras.has(h.n)).map((h) => (
              <label key={h.n} className="sw-cat">
                <input type="checkbox" checked={false} onChange={() => set({ extraCategories: [...a.extraCategories, h.n].sort((x, y) => x - y) })} />
                <span>{h.plain}</span>
              </label>
            ))}
          </div>
        ) : (
          <button type="button" className="sw-more" onClick={() => setMoreCategories(true)}>
            Add another category
          </button>
        )}
      </div>

      <div className="sw-grp">
        <div className="sw-gh">
          <b>Risk scores</b>
        </div>
        <Choice
          kind="checkbox"
          name="riskAppendix"
          checked={a.riskAppendix}
          onChange={(on) => set({ riskAppendix: on })}
          title="Add a risk score appendix"
          sub="Likelihood and consequence for each step, before and after its controls, on a page of its own"
        />
      </div>

      {prev && (
        <div className="sw-grp">
          <label className="sw-gh" htmlFor="swz-reason">
            <b>What changed</b>
          </label>
          <textarea
            id="swz-reason"
            className="wb2-notes"
            rows={2}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              touch();
            }}
          />
          <div className="sw-opts">
            <Choice
              name="material"
              checked={!correction}
              onChange={() => {
                setMaterial(true);
                touch();
              }}
              title="It changes how the work is done"
              sub="Everyone signs on again, and the site is walked again"
            />
            <Choice
              name="material"
              checked={correction}
              disabled={changes.length > 0}
              onChange={() => {
                setMaterial(false);
                touch();
              }}
              title="It's a correction"
              sub={changes.length > 0 ? `${capital(andList(changes))} changed, so everyone signs on again` : "Sign-ons and the site walk carry over"}
            />
          </div>
        </div>
      )}

      {problems.filter((p) => p.field !== "siteChecked").length > 0 && (
        <ul className="sw-problems">
          {problems
            .filter((p) => p.field !== "siteChecked")
            .map((p) => (
              <li key={p.text}>
                <button type="button" onClick={() => jump(p.field)}>
                  {p.text}
                </button>
              </li>
            ))}
        </ul>
      )}

      {/* a correction stands on the walk the version it corrects was issued on */}
      {!correction && (
        <Choice
          id="swz-walked"
          kind="checkbox"
          name="checked"
          checked={checked}
          onChange={(on) => {
            setChecked(on);
            touch();
          }}
          title="I've walked this site and this SWMS matches it"
          sub="Recorded with your name and the time"
        />
      )}
    </>
  );

  /* What the last screen's greyed-out button is waiting for: the problems
     the list shows, counted as the list shows them — the site walk is a tick
     on the screen, not a line in the list, so it is named rather than counted. */
  const listed = problems.filter((p) => p.field !== "siteChecked");
  const waitingFor = listed.length
    ? listed.length === 1
      ? listed[0].text
      : `${listed.length} things to answer above`
    : problems.length > 0
      ? problems[0].text
      : "";

  /* ── the frame ───────────────────────────────────────────────────────── */

  let body: React.ReactNode;
  let foot: React.ReactNode = null;
  let tabs = false;
  let title = prev ? "Revise the SWMS" : "Safe Work Method Statement";

  if (ctx === null) {
    body = <p className="sw-note">Reading the job and the team…</p>;
  } else if (ctx === "failed") {
    body = <p className="sw-note">Couldn&apos;t open the SWMS for this job. Close it and try again.</p>;
    foot = (
      <>
        <span />
        <button type="button" className="pbtn" onClick={onClose}>
          Close
        </button>
      </>
    );
  } else if (stale) {
    /* the version this was opened to revise has been replaced; carrying on
       would file a second SWMS on the job */
    title = "This SWMS has moved on";
    body = (
      <p className="sw-text">
        A newer version was issued while this card was open. Close it and open the job again to revise the current one.
      </p>
    );
    foot = (
      <>
        <span />
        <button type="button" className="pbtn" onClick={onClose}>
          Close
        </button>
      </>
    );
  } else if (ctx.job.state && !ctx.job.jurisdiction) {
    /* named, and nothing to press: a SWMS to another state's rules is worse than none */
    body = <p className="sw-text">{stateNotCovered(ctx.job.state)}</p>;
    foot = (
      <>
        <span />
        <button type="button" className="pbtn" onClick={onClose}>
          Close
        </button>
      </>
    );
  } else if (!ctx.libraryApproved) {
    if (ctx.canApprove) {
      title = "Approve the SWMS template";
      body = (
        <>
          <p className="sw-text">
            Every SWMS is written from these steps and controls. Anything specific to a site is typed on site and printed as it was
            entered. Approve them once, and anyone on the team can issue a SWMS.
          </p>
          <TemplateSteps />
        </>
      );
      foot = (
        <>
          <span />
          <button type="button" className="pbtn ghost" onClick={onClose}>
            Cancel
          </button>
          <ApproveTemplate onApproved={() => setCtx((c) => (c && c !== "failed" ? { ...c, libraryApproved: true } : c))} />
        </>
      );
    } else {
      title = "The SWMS template needs approving";
      body = (
        <p className="sw-text">
          {`${ctx.ownerName ?? "The owner"} approves it before the first SWMS can be issued, and it's waiting in their bell.`}
        </p>
      );
      foot = (
        <>
          <span />
          <button type="button" className="pbtn" onClick={onClose}>
            Close
          </button>
        </>
      );
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
      <div className="sw-issued">
        <p className="sw-text">
          {correction ? "Filed under Documents, Compliance. Anyone who signed on before stays signed on." : "Filed under Documents, Compliance."}
        </p>
        {inBells.length > 0 && (
          <div className="sw-grp">
            <div className="sw-gh">
              <b>Asked in their bell</b>
            </div>
            <p className="sw-text">{inBells.map((t) => t.name).join(", ")}</p>
          </div>
        )}
        {here.length > 0 && (
          <div className="sw-grp">
            <div className="sw-gh">
              <b>Signing on here</b>
            </div>
            <div className="sw-crew">
              {here.map((p) => (
                <div key={p.key} className="sw-person out">
                  <span className="sw-who">
                    <b>{p.name}</b>
                    <em>{p.sub}</em>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {a.site.builder && (
          <p className="sw-state warn">{`${a.builderName.trim() || "The builder"} gets a copy before work starts — open the SWMS and send them the PDF.`}</p>
        )}
      </div>
    );
    foot = (
      <>
        <span />
        <button type="button" className="pbtn ghost" onClick={() => onOpen(issued.versionId)}>
          Open the SWMS
        </button>
        {here.length > 0 ? (
          <>
            <button type="button" className="pbtn ghost" onClick={onClose}>
              Done
            </button>
            <button type="button" className="pbtn" onClick={() => onSignOn(issued.versionId)}>
              Sign on now
            </button>
          </>
        ) : (
          <button type="button" className="pbtn" onClick={onClose}>
            Done
          </button>
        )}
      </>
    );
  } else {
    tabs = true;
    const at = TABS.findIndex((t) => t.key === tab);
    foot = confirmClose ? (
      <>
        <span>Discard this SWMS?</span>
        <button type="button" className="pbtn ghost" onClick={() => setConfirmClose(false)}>
          Keep editing
        </button>
        <button type="button" className="pbtn" onClick={onClose}>
          Discard
        </button>
      </>
    ) : (
      <>
        {/* the tabs say which screen this is; the last one says what the
            greyed-out button is still waiting for */}
        <span className={error || (at === 3 && problems.length > 0) ? "sw-state bad" : undefined}>
          {error ?? (at === 3 ? waitingFor : "")}
        </span>
        {at > 0 && (
          <button type="button" className="pbtn ghost" onClick={() => go(TABS[at - 1].key)}>
            Back
          </button>
        )}
        {at < 3 ? (
          <button type="button" className="pbtn" onClick={() => go(TABS[at + 1].key)}>
            Continue
          </button>
        ) : (
          <button type="button" className="pbtn" disabled={busy || problems.length > 0} onClick={issue}>
            {busy ? "Issuing…" : prev ? `Issue version ${version}` : "Issue the SWMS"}
          </button>
        )}
      </>
    );
  }

  const panels: Record<Tab, React.ReactNode> = { work, how, who, review };

  return (
    <>
      <div className="swz-scrim" onClick={askClose} />
      <aside className={`swz${tabs ? " tall" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className={`wb2-jcband${tabs ? "" : " bare"}`}>
          <div className="wb2-shtop">
            {job?.number && <span className="wb2-shno">{`#${job.number}`}</span>}
            <span className="wb2-jcid">
              <h2 className="wb2-shname">{title}</h2>
              <p className="wb2-jcaddr">{job?.address ?? (ctx === null ? "Reading the job…" : "No address on the job")}</p>
            </span>
          </div>
          <button ref={closeRef} type="button" className="wb2-ico" aria-label="Close the SWMS" onClick={askClose}>
            <Icon name="x" size={14} />
          </button>
          {tabs && (
            <ViewTabs
              items={TABS}
              active={tab}
              onGo={(k) => go(k as Tab)}
              ariaLabel="SWMS steps"
              idPrefix="swztab"
              panelPrefix="swzsec"
            />
          )}
        </div>
        <div className="wb2-jcbody swz-body" ref={bodyRef}>
          {tabs
            ? TABS.map((t) => (
                <section key={t.key} className="wb2-jcface" id={`swzsec-${t.key}`} role="tabpanel" aria-labelledby={`swztab-${t.key}`} hidden={tab !== t.key}>
                  {panels[t.key]}
                </section>
              ))
            : body}
        </div>
        {foot && <div className="wb2-shft">{foot}</div>}
      </aside>
    </>
  );
}
