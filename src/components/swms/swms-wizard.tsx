"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import {
  approveSwmsLibrary,
  issueSwms,
  swmsPrevious,
  swmsWizardContext,
  type SwmsPrevious,
  type SwmsWizardContext,
} from "@/app/actions/swms";
import {
  buildSwms,
  categoriesOf,
  DEFAULT_ANSWERS,
  HRCW,
  issueProblems,
  LEVEL_LABEL,
  STEP_KEYS,
  STEP_TITLE,
  type StepKey,
  type SwmsAnswers,
} from "@/lib/swms/library";
import "./swms.css";

/* THE SWMS WIZARD — four screens of choices on the job card, and the library
   writes the rest.

   SIMPLE ENTRY, DETAILED OUTPUT. Every question is a choice the site forces
   (how the fall is stopped, where the circuit is isolated) or a fact only the
   person standing there knows; everything else is written from the library.
   The rules that stop an issue are the library's own (`issueProblems`), asked
   live here so the reason is on screen, and asked again by the server.

   IT OPENS OVER THE CARD, inside the card's portal, the way a claim does — a
   second portal is how a scrim ends up over the thing it should dim. */

type Outsider = { name: string; company: string };

const STEPS = ["The work", "How it's done", "Who it covers", "Review"] as const;

const STEP_SUB: Record<StepKey, string> = {
  roof: "Work at height",
  lift: "Work at height",
  drill: "Live services and silica dust",
  ceiling: "Live cables and roof-space heat",
  braze: "Hot work",
  test: "High-pressure gas",
  power: "Energised electrical work",
  charge: "Charged refrigerant lines",
};

const REFRIGERANTS = [["R32", "R32"], ["R410A", "R410A"], ["R454B", "R454B"], ["R290", "R290"]] as const;
type Refrigerant = (typeof REFRIGERANTS)[number][0];

/* What the owner reads before adopting: every step, as the library writes it
   with nothing chosen on site. Pure, so it is built once. */
const LIBRARY_PREVIEW = buildSwms(
  { ...DEFAULT_ANSWERS, isolation: "the isolation point", hospital: "—" },
  { work: "", electricianName: "the electrician", firstAiderName: null }
);

const STATE_NAME = { NSW: "New South Wales", QLD: "Queensland" } as const;
const REGULATION = {
  NSW: "Work Health and Safety Regulation 2025 (NSW)",
  QLD: "Work Health and Safety Regulation 2011 (Qld)",
} as const;

function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="sw-seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
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
  disabled = false,
}: {
  name: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  title: string;
  sub?: string | null;
  kind?: "radio" | "checkbox";
  disabled?: boolean;
}) {
  return (
    <label className={`sw-opt${checked ? " on" : ""}${disabled ? " fixed" : ""}`}>
      <input
        type={kind}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
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
}: {
  jobUuid: string;
  /** Set to revise: the latest version this one replaces. */
  reviseVersionId?: string | null;
  onClose: () => void;
  onIssued: () => void;
}) {
  const [ctx, setCtx] = useState<SwmsWizardContext | null | "failed">(null);
  const [prev, setPrev] = useState<SwmsPrevious | null>(null);
  const [step, setStep] = useState(0);
  const [a, setA] = useState<SwmsAnswers>(DEFAULT_ANSWERS);
  const [showAll, setShowAll] = useState(false);
  const [covers, setCovers] = useState<string[]>([]);
  const [outsiders, setOutsiders] = useState<Outsider[]>([]);
  const [draft, setDraft] = useState<Outsider>({ name: "", company: "" });
  const [responsible, setResponsible] = useState<string | null>(null);
  const [electrician, setElectrician] = useState<string>("");
  const [firstAider, setFirstAider] = useState<string>("");
  const [checked, setChecked] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ versionId: string; version: number } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

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
        const onTeam = (id: string) => c.team.some((t) => t.id === id);
        if (p) {
          setPrev(p);
          setA(p.answers);
          setCovers(p.staffIds.filter(onTeam));
          setOutsiders(p.outsiders.map((o) => ({ name: o.name, company: o.company ?? "" })));
          setResponsible(onTeam(p.responsibleStaffId) ? p.responsibleStaffId : null);
        } else {
          const booked = c.team.filter((t) => t.booked).map((t) => t.id);
          const people = booked.length ? booked : c.viewerStaffId && onTeam(c.viewerStaffId) ? [c.viewerStaffId] : [];
          setA({ ...DEFAULT_ANSWERS, jurisdiction: c.job.jurisdiction ?? DEFAULT_ANSWERS.jurisdiction });
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

  useEffect(() => {
    bodyRef.current?.scrollTo?.({ top: 0 });
  }, [step]);

  const set = (patch: Partial<SwmsAnswers>) => {
    setA((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const setSite = (k: keyof SwmsAnswers["site"], v: boolean) => set({ site: { ...a.site, [k]: v } });
  const setStepOn = (k: StepKey, v: boolean) => set({ steps: { ...a.steps, [k]: v } });

  const team = ctx && ctx !== "failed" ? ctx.team : [];
  const coveredTeam = team.filter((t) => covers.includes(t.id));
  const namedOutsiders = outsiders.filter((o) => o.name.trim());
  const people = [
    ...coveredTeam.map((t) => ({ key: `staff:${t.id}`, name: t.name })),
    ...namedOutsiders.map((o, i) => ({ key: `outside:${i}`, name: o.name.trim() })),
  ];
  const personName = (key: string) => people.find((p) => p.key === key)?.name ?? null;
  const electricianOk = !!personName(electrician);
  const responsibleOk = !!responsible && covers.includes(responsible);

  const cats = categoriesOf(a);
  /* what the answers switch on by themselves, with why — a category the
     answers turned on is untied by changing the answer, not by unticking it */
  const auto = new Map(categoriesOf({ ...a, extraCategories: [] }).map((c) => [c.n, c.reason]));
  const content = buildSwms(a, {
    work: "",
    electricianName: a.steps.power ? personName(electrician) : null,
    firstAiderName: personName(firstAider),
  });
  const problems = issueProblems(a, {
    people: people.length,
    responsibleChosen: responsibleOk,
    electricianChosen: electricianOk,
    siteChecked: checked,
  });
  if (prev && !reason.trim()) problems.unshift("Say what changed and why.");
  const version = prev ? prev.version + 1 : 1;

  const issue = async () => {
    if (!ctx || ctx === "failed" || !responsible) return;
    setBusy(true);
    setError(null);
    try {
      const res = await issueSwms({
        jobUuid,
        swmsId: prev?.swmsId ?? null,
        reason: prev ? reason : null,
        answers: a,
        staffIds: covers,
        outsiders: namedOutsiders.map((o) => ({ name: o.name.trim(), company: o.company.trim() || null })),
        responsibleStaffId: responsible,
        electrician: a.steps.power ? electrician : null,
        firstAider: firstAider || null,
        siteChecked: checked,
      });
      if (res.ok) {
        setIssued({ versionId: res.versionId, version: res.version });
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

  const adopt = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await approveSwmsLibrary();
      if (res.ok) setCtx((c) => (c && c !== "failed" ? { ...c, libraryApproved: true } : c));
      else setError(res.error);
    } catch {
      setError("Couldn't record the adoption. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const job = ctx && ctx !== "failed" ? ctx.job : null;
  const heading = job
    ? [job.number ? `Job #${job.number}` : null, job.address].filter(Boolean).join(", ")
    : "Reading the job…";

  /* ── the screens ─────────────────────────────────────────────────────── */

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
      <div className="sw-grp">
        <div className="sw-gh">
          <b>What&apos;s the job</b>
        </div>
        <div className="sw-opts">
          <Choice name="kind" checked={a.kind === "install"} onChange={() => set({ kind: "install" })} title="Install or replace a system" sub="Construction work" />
          <Choice name="kind" checked={a.kind === "service"} onChange={() => set({ kind: "service" })} title="Service or repair" sub="Not construction work unless it involves high-risk work" />
        </div>
      </div>

      <div className="sw-grp">
        <div className="sw-gh">
          <b>About the site</b>
        </div>
        <div className="sw-qas">
          <div className="sw-qa">
            <span>
              State<em>{job?.jurisdiction ? "From the site address" : "The site's state, for its rules"}</em>
            </span>
            <Seg label="State" value={a.jurisdiction} options={[["NSW", "NSW"], ["QLD", "QLD"]] as const} onChange={(v) => set({ jurisdiction: v, roofPower: v === "QLD" ? "off" : a.roofPower })} />
          </div>
          <div className="sw-qa">
            <span>Built before 1990?</span>
            <Seg label="Built before 1990" value={a.site.pre1990 ? "yes" : "no"} options={[["no", "No"], ["yes", "Yes or not sure"]] as const} onChange={(v) => setSite("pre1990", v === "yes")} />
          </div>
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
              A builder running the site?<em>A principal contractor gets a copy before work starts</em>
            </span>
            <Seg label="Builder" value={a.site.builder ? "yes" : "no"} options={[["no", "No"], ["yes", "Yes"]] as const} onChange={(v) => setSite("builder", v === "yes")} />
          </div>
        </div>
      </div>

      <div className="sw-grp">
        <div className="sw-gh">
          <b>High-risk construction work</b>
          <span>{`${cats.length} of 18 apply`}</span>
        </div>
        <div className="sw-cats">
          {HRCW.filter((c) => showAll || cats.some((x) => x.n === c.n)).map((c) => {
            const why = auto.get(c.n);
            const on = cats.some((x) => x.n === c.n);
            return (
              <label key={c.n} className={`sw-cat${on ? " on" : ""}`}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!!why}
                  onChange={(e) =>
                    set({
                      extraCategories: e.target.checked
                        ? [...a.extraCategories, c.n].sort((x, y) => x - y)
                        : a.extraCategories.filter((n) => n !== c.n),
                    })
                  }
                />
                <span className="sw-catn">{c.n}</span>
                <span>
                  {c.label}
                  {on && <em>{why ?? "Ticked on site"}</em>}
                </span>
              </label>
            );
          })}
        </div>
        <button type="button" className="sw-more" onClick={() => setShowAll((x) => !x)}>
          {showAll ? "Show only what applies" : "Show all 18"}
        </button>
      </div>
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
          <Choice name="fall" checked={a.fall === "harness"} onChange={() => set({ fall: "harness" })} title="Harness to a roof anchor" sub={a.jurisdiction === "QLD" ? "Queensland needs the reason higher controls weren't used" : null} />
        </div>
        {a.fall === "harness" && (
          <input className="sw-field" aria-label="Which roof anchor" placeholder="Which anchor, and where" value={a.anchor} onChange={(e) => set({ anchor: e.target.value })} />
        )}
        {a.fall === "harness" && a.jurisdiction === "QLD" && (
          <textarea className="sw-field" rows={2} aria-label="Why higher controls weren't reasonably practicable" placeholder="Why edge protection, a scaffold or an EWP wasn't reasonably practicable" value={a.qldFallReason} onChange={(e) => set({ qldFallReason: e.target.value })} />
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
        <span className="sw-al">Dust control</span>
        <div className="sw-opts row">
          <Choice name="dust" checked={a.dust === "wet"} onChange={() => set({ dust: "wet" })} title="Wet drilling" />
          <Choice name="dust" checked={a.dust === "extract"} onChange={() => set({ dust: "extract" })} title="On-tool extraction" />
        </div>
        <span className="sw-al">Silica risk</span>
        <div className="sw-opts">
          <Choice name="silica" checked={a.silica === "high"} onChange={() => set({ silica: "high" })} title="High-risk silica processing" sub="Power-tool drilling of brick or concrete" />
          <Choice name="silica" checked={a.silica === "low"} onChange={() => set({ silica: "low" })} title="Not high risk" />
        </div>
        {a.silica === "low" && (
          <input className="sw-field" aria-label="Why it isn't high risk" placeholder="Why it isn't high risk" value={a.silicaWhy} onChange={(e) => set({ silicaWhy: e.target.value })} />
        )}
      </div>
    ),
    ceiling: (
      <div className="sw-ask">
        <span className="sw-al">Power while in the roof space</span>
        <div className="sw-opts">
          <Choice name="roofPower" checked={a.roofPower === "off"} onChange={() => set({ roofPower: "off" })} title="Mains off at the main switchboard, locked and tagged" sub={a.jurisdiction === "QLD" ? "Required in Queensland for a house roof space" : null} />
          {a.jurisdiction !== "QLD" && (
            <Choice name="roofPower" checked={a.roofPower === "rcd"} onChange={() => set({ roofPower: "rcd" })} title="Only the RCD-protected socket circuit left on" />
          )}
        </div>
      </div>
    ),
    power: (
      <div className="sw-ask">
        <span className="sw-al">Isolation point</span>
        <input className="sw-field" aria-label="Isolation point" placeholder="Where the circuit is isolated" value={a.isolation} onChange={(e) => set({ isolation: e.target.value })} />
      </div>
    ),
    charge: (
      <div className="sw-ask">
        <span className="sw-al">Refrigerant</span>
        <Seg label="Refrigerant" value={a.refrigerant as Refrigerant} options={REFRIGERANTS} onChange={(v) => set({ refrigerant: v })} />
      </div>
    ),
  };

  const how = (
    <>
      <div className="sw-grp">
        <div className="sw-gh">
          <b>Steps on this job</b>
          <span>{`${STEP_KEYS.filter((k) => a.steps[k]).length} of ${STEP_KEYS.length}`}</span>
        </div>
        <div className="sw-steps">
          {STEP_KEYS.map((k) => (
            <div key={k} className={`sw-stepbox${a.steps[k] ? " on" : ""}`}>
              <label className="sw-stephd">
                <input type="checkbox" checked={a.steps[k]} onChange={(e) => setStepOn(k, e.target.checked)} />
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
        <textarea id="swz-notes" className="sw-field" rows={3} value={a.siteNotes} onChange={(e) => set({ siteNotes: e.target.value })} />
      </div>
    </>
  );

  const addOutsider = () => {
    if (!draft.name.trim()) return;
    setOutsiders((o) => [...o.filter((x) => x.name.trim()), { name: draft.name.trim(), company: draft.company.trim() }]);
    setDraft({ name: "", company: "" });
    setDirty(true);
  };
  const removeOutsider = (i: number) => {
    const key = `outside:${i}`;
    /* later helpers move up one, and so do the choices that named them */
    const shift = (k: string) => (k.startsWith("outside:") && Number(k.slice(8)) > i ? `outside:${Number(k.slice(8)) - 1}` : k);
    setElectrician((k) => (k === key ? "" : shift(k)));
    setFirstAider((k) => (k === key ? "" : shift(k)));
    setOutsiders((o) => o.filter((_, j) => j !== i));
    setDirty(true);
  };
  const toggleCover = (id: string, on: boolean) => {
    const next = on ? [...covers, id] : covers.filter((x) => x !== id);
    setCovers(next);
    if (!on && responsible === id) setResponsible(next[0] ?? null);
    if (!on && electrician === `staff:${id}`) setElectrician("");
    if (!on && firstAider === `staff:${id}`) setFirstAider("");
    if (on && !responsible) setResponsible(id);
    setDirty(true);
  };

  const who = (
    <>
      <div className="sw-grp">
        <div className="sw-gh">
          <b>From your team</b>
          <span>{`${coveredTeam.length} chosen`}</span>
        </div>
        <div className="sw-crew">
          {team.map((t) => {
            const on = covers.includes(t.id);
            return (
              <label key={t.id} className={`sw-person${on ? " on" : ""}`}>
                <input type="checkbox" checked={on} onChange={(e) => toggleCover(t.id, e.target.checked)} />
                <span className="sw-who">
                  <b>{t.name}</b>
                  <em>{[t.role, t.booked ? "Booked on this job" : null].filter(Boolean).join(", ") || "Team member"}</em>
                  {on && (
                    <span className="sw-tickets">
                      {t.tickets.length === 0 ? (
                        <span className="sw-state warn">No tickets on file</span>
                      ) : (
                        t.tickets.map((k) => (
                          <span key={k.name} className={k.current ? "" : "sw-state warn"}>
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
        {namedOutsiders.length > 0 && (
          <div className="sw-crew">
            {outsiders.map((o, i) =>
              o.name.trim() ? (
                <div key={`${o.name}-${i}`} className="sw-person out">
                  <span className="sw-who">
                    <b>{o.name}</b>
                    <em>{o.company || "Outside the business"}</em>
                  </span>
                  <button type="button" className="sw-x" aria-label={`Clear ${o.name}`} onClick={() => removeOutsider(i)}>
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ) : null
            )}
          </div>
        )}
        <div className="sw-addrow">
          <input
            className="sw-field"
            aria-label="Their name"
            placeholder="Name"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && addOutsider()}
          />
          <input
            className="sw-field"
            aria-label="Their company"
            placeholder="Company"
            value={draft.company}
            onChange={(e) => setDraft((d) => ({ ...d, company: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && addOutsider()}
          />
          <button type="button" className="sw-btn" disabled={!draft.name.trim()} onClick={addOutsider}>
            Add them
          </button>
        </div>
      </div>

      <div className="sw-grp">
        <div className="sw-gh">
          <b>Responsible on site</b>
        </div>
        {coveredTeam.length === 0 ? (
          <p className="sw-note">Choose someone from your team first.</p>
        ) : (
          <div className="sw-opts row">
            {coveredTeam.map((t) => (
              <Choice key={t.id} name="responsible" checked={responsible === t.id} onChange={() => {
                  setResponsible(t.id);
                  setDirty(true);
                }} title={t.name} />
            ))}
          </div>
        )}
      </div>

      <div className="sw-grp">
        <div className="sw-gh">
          <b>Emergency</b>
        </div>
        <div className="sw-qas">
          {a.steps.power && (
            <div className="sw-qa">
              <label htmlFor="swz-elec">Electrician connecting power</label>
              <select id="swz-elec" className="sw-field sw-select" value={electrician} onChange={(e) => {
                  setElectrician(e.target.value);
                  setDirty(true);
                }}>
                <option value="">Choose</option>
                {people.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="sw-qa">
            <label htmlFor="swz-aid">First aider</label>
            <select id="swz-aid" className="sw-field sw-select" value={firstAider} onChange={(e) => {
                setFirstAider(e.target.value);
                setDirty(true);
              }}>
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
            <label htmlFor="swz-hosp">Nearest hospital</label>
            <input id="swz-hosp" className="sw-field" value={a.hospital} onChange={(e) => set({ hospital: e.target.value })} />
          </div>
        </div>
      </div>
    </>
  );

  const controls = content.steps.reduce((n, s) => n + s.controls.length, 0);
  const shown = problems.filter((p) => !p.startsWith("Confirm you've walked"));
  const review = (
    <>
      <dl className="sw-rev">
        <div>
          <dt>Document</dt>
          <dd>
            {`${content.steps.length} steps, ${controls} controls`}
            <small>{`${content.steps.filter((s) => s.site).length} written for this site`}</small>
          </dd>
        </div>
        <div>
          <dt>High-risk work</dt>
          <dd>
            {`${cats.length} of 18 categories`}
            {cats.length > 0 && <small>{cats.map((c) => c.n).join(", ")}</small>}
          </dd>
        </div>
        <div>
          <dt>Covers</dt>
          <dd>
            {people.length === 1 ? "1 person" : `${people.length} people`}
            {people.length > 0 && <small>{people.map((p) => p.name).join(", ")}</small>}
          </dd>
        </div>
        <div>
          <dt>Responsible</dt>
          <dd>{responsibleOk ? team.find((t) => t.id === responsible)?.name : "—"}</dd>
        </div>
        <div>
          <dt>Principal contractor</dt>
          <dd>{a.site.builder ? <span className="sw-state warn">Needs a copy before work starts</span> : "None"}</dd>
        </div>
        <div>
          <dt>Rules</dt>
          <dd>
            {STATE_NAME[a.jurisdiction]}
            <small>{REGULATION[a.jurisdiction]}</small>
          </dd>
        </div>
      </dl>

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
            <span>{`Version ${prev.version} is replaced, and everyone signs on again`}</span>
          </label>
          <textarea id="swz-reason" className="sw-field" rows={2} value={reason} onChange={(e) => {
              setReason(e.target.value);
              setDirty(true);
            }} />
        </div>
      )}

      {shown.length > 0 && (
        <ul className="sw-problems">
          {shown.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <Choice
        kind="checkbox"
        name="checked"
        checked={checked}
        onChange={(on) => {
          setChecked(on);
          setDirty(true);
        }}
        title="I've walked this site and this SWMS matches it"
        sub="Recorded with your name and the time"
      />
    </>
  );

  /* ── frame ───────────────────────────────────────────────────────────── */

  let body: React.ReactNode;
  let foot: React.ReactNode;
  let tabs = false;

  if (ctx === null) {
    body = <p className="sw-note">Reading the job and the team…</p>;
    foot = null;
  } else if (ctx === "failed") {
    body = <p className="sw-note">Couldn&apos;t open the SWMS for this job. Close it and try again.</p>;
    foot = (
      <button type="button" className="sw-btn pri" onClick={onClose}>
        Close
      </button>
    );
  } else if (!ctx.libraryApproved) {
    body = ctx.canApprove ? (
      <>
        <div className="sw-grp">
          <div className="sw-gh">
            <b>Adopt the SWMS library</b>
            <span>{`Version ${ctx.libraryVersion}`}</span>
          </div>
          <p className="sw-text">
            Every SWMS is written from these steps and controls, drawn from the regulators&apos; codes of practice. Anything
            specific to a site is chosen or typed on site and printed as it was entered. Read them, then adopt them for the
            business.
          </p>
        </div>
        {LIBRARY_PREVIEW.steps.map((s) => (
          <div key={s.key} className="sw-grp">
            <div className="sw-gh">
              <b>{s.title}</b>
            </div>
            <p className="sw-text">{s.hazards}</p>
            <ul className="sw-lib">
              {s.controls.map((c) => (
                <li key={c.text}>
                  <span>{LEVEL_LABEL[c.level]}</span>
                  {c.text}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </>
    ) : (
      <div className="sw-grp">
        <div className="sw-gh">
          <b>The SWMS library isn&apos;t adopted yet</b>
        </div>
        <p className="sw-text">The owner adopts the library before the first SWMS can be issued from it.</p>
      </div>
    );
    foot = ctx.canApprove ? (
      <>
        <span>{error}</span>
        <button type="button" className="sw-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="sw-btn pri" disabled={busy} onClick={adopt}>
          Adopt the library
        </button>
      </>
    ) : (
      <button type="button" className="sw-btn pri" onClick={onClose}>
        Close
      </button>
    );
  } else if (issued) {
    const outside = namedOutsiders;
    body = (
      <div className="sw-issued">
        <span className="sw-state ok">{`Version ${issued.version} issued`}</span>
        <h3>The SWMS is on the job</h3>
        <p className="sw-note">Filed under Documents, Compliance.</p>
        <div className="sw-grp">
          <div className="sw-gh">
            <b>Your team</b>
          </div>
          <div className="sw-crew">
            {coveredTeam.map((t) => (
              <div key={t.id} className="sw-person out">
                <span className="sw-who">
                  <b>{t.name}</b>
                  <em>{t.id === ctx.viewerStaffId ? "Sign on from your bell" : "Asked in their bell"}</em>
                </span>
              </div>
            ))}
          </div>
        </div>
        {outside.length > 0 && (
          <div className="sw-grp">
            <div className="sw-gh">
              <b>Outside the business</b>
              <span>They sign on a team member&apos;s phone after the briefing</span>
            </div>
            <div className="sw-crew">
              {outside.map((o, i) => (
                <div key={`${o.name}-${i}`} className="sw-person out">
                  <span className="sw-who">
                    <b>{o.name}</b>
                    <em>{o.company || "Outside the business"}</em>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {a.site.builder && <p className="sw-state warn">Send the builder a copy before work starts.</p>}
      </div>
    );
    foot = (
      <>
        <span />
        <a className="sw-btn" href={`/swms/${issued.versionId}`} target="_blank" rel="noreferrer">
          Open the SWMS
        </a>
        {outside.length > 0 || coveredTeam.some((t) => t.id === ctx.viewerStaffId) ? (
          <Link className="sw-btn" href={`/dashboard/swms/${issued.versionId}`}>
            Sign on now
          </Link>
        ) : null}
        <button type="button" className="sw-btn pri" onClick={onClose}>
          Done
        </button>
      </>
    );
  } else {
    tabs = true;
    body = [work, how, who, review][step];
    foot = confirmClose ? (
      <>
        <span>Discard this SWMS?</span>
        <button type="button" className="sw-btn" onClick={() => setConfirmClose(false)}>
          Keep editing
        </button>
        <button type="button" className="sw-btn pri" onClick={onClose}>
          Discard
        </button>
      </>
    ) : (
      <>
        <span className={error ? "sw-state bad" : undefined}>{error ?? `Step ${step + 1} of 4`}</span>
        {step > 0 && (
          <button type="button" className="sw-btn" onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {step < 3 ? (
          <button type="button" className="sw-btn pri" onClick={() => setStep(step + 1)}>
            Continue
          </button>
        ) : (
          <button type="button" className="sw-btn pri" disabled={busy || problems.length > 0} onClick={issue}>
            {busy ? "Issuing…" : `Issue version ${version}`}
          </button>
        )}
      </>
    );
  }

  return (
    <>
      <div className="swz-scrim" onClick={askClose} />
      <aside className="swz" role="dialog" aria-modal="true" aria-label={prev ? "Revise the Safe Work Method Statement" : "Create a Safe Work Method Statement"}>
        <div className="swz-head">
          <div className="swz-title">
            <em>{heading}</em>
            <h2>{prev ? "Revise the Safe Work Method Statement" : "Safe Work Method Statement"}</h2>
          </div>
          <button ref={closeRef} type="button" className="sw-x" aria-label="Close the SWMS" onClick={askClose}>
            <Icon name="x" size={15} />
          </button>
        </div>
        {tabs && (
          <nav className="swz-tabs" aria-label="Steps">
            {STEPS.map((s, i) => (
              <button key={s} type="button" aria-current={step === i ? "step" : undefined} onClick={() => setStep(i)}>
                {s}
              </button>
            ))}
          </nav>
        )}
        <div className="swz-body" ref={bodyRef}>
          {body}
        </div>
        {foot && <div className="swz-foot">{foot}</div>}
      </aside>
    </>
  );
}
