"use client";

/* THE RATE CALCULATOR (v2, 27 October 2026, on his mock). Its five steps
   down the left, the step in the middle, Your rates on the right as you
   type; then Your rates and Insights across the width. Every number comes
   from runEngine; nothing here works one out.

   The outer <RateCalculator> owns persistence (debounced org-scoped save via
   server action, localStorage crash buffer); the inner <CalculatorApp> is the
   calculator itself and is remounted (key) after Start fresh so all view
   state resets. */

import React from "react";
import "./rate-calculator.css";
import type { CalcResult, StaffMember } from "./engine";
import {
  allStepsDone,
  daysSinceReviewed,
  DONE_COMPLETIONS,
  emptyState,
  hydrateState,
  runEngine,
  timesheetWeeks,
  type RateCalcState,
} from "./state";
import { listed, money, rate0, gstOf } from "./format";
import { parseRate } from "./ui";
import { Button, LinkButton } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Field, TextInput } from "@/components/parts/field";
import { StateWord, type Tone } from "@/components/parts/state";
import { StaffStep, BusinessStep, VehiclesStep, RiskStep, ProfitStep } from "./steps";
import { YourRates } from "./overview";
import { InsightsView } from "./insights";
import { HelpDialog } from "./help-modal";
import { SettingsDialog } from "./settings-panel";
import { ReviewDue } from "./notif-banner";

/** The engine's health, as a state word (rule 17). */
const HEALTH_TONE: Record<string, Tone> = { danger: "wrong", warning: "look", success: "good", neutral: "info" };

// Lazy-load the server action module so importing this component never drags
// the auth0 runtime into client bundles/tests (studio.tsx pattern).
const actions = () => import("@/app/actions/rate-calc");

const BUFFER_KEY = "heytiff.rate-calc.buffer";
const HELP_DISMISSED_KEY = "rc-help-dismissed";

/* "Don't show again" is a CLIENT-ONLY fact, so what it decides has to diverge
   from the HTML the server sent. It used to be restored by a mount effect,
   which needed a `react-hooks/set-state-in-effect` disable — and one disable
   anywhere makes React Compiler skip the whole component, whatever the rule
   and however good the reason (see studio/canvas.tsx).

   `useSyncExternalStore` says the same thing in the supported way: not
   dismissed through hydration, the real answer after, and React re-renders
   for the swap. A boolean snapshot is stable by value, so nothing has to be
   cached, and this screen's own write is picked up on its next render. */
const helpDismissedNow = () => {
  try {
    return window.sessionStorage.getItem(HELP_DISMISSED_KEY) === "1";
  } catch {
    return false; /* storage unavailable */
  }
};
const helpNotDismissed = () => false;
const noStorageSubscription = () => () => {};

/* THE CRASH BUFFER, READ ONCE — as this mount found it, and never again.

   It cannot be a live read. `persist` REWRITES the buffer on every keystroke
   (with a fresh `savedAt`) and REMOVES it after a successful save, so a store
   that followed localStorage would hand back a different value mid-session —
   and `restored` decides `hasData` and the `key` below, so that would remount
   the whole calculator under the person using it.

   So the read is latched at the first snapshot, which React asks for once
   hydration is done — before any edit can have touched the buffer. The latch
   is dropped on unmount, so a later mount reads the buffer as IT finds it,
   which is what the old mount effect did. */
type BufferRead = { state: RateCalcState | null; retired: boolean };
const NO_BUFFER: BufferRead = { state: null, retired: false };
let latchedBuffer: BufferRead | undefined;

const readBuffer = (): BufferRead => {
  let buf: { state?: unknown } | null = null;
  try {
    const raw = window.localStorage.getItem(BUFFER_KEY);
    buf = raw ? (JSON.parse(raw) as { state?: unknown }) : null;
  } catch {
    buf = null;
  }
  if (buf?.state == null) return NO_BUFFER;
  const state = hydrateState(buf.state);
  // One-time cleanup: the retired "Blue Sky Air Conditioning" example org
  // could be left in a stale buffer, and restoring it would write the demo
  // straight back onto a clean org. Drop such a buffer instead.
  if (state.businessName === RETIRED_EXAMPLE_ORG) return { state: null, retired: true };
  return { state, retired: false };
};

const bufferAtMount = (): BufferRead => {
  if (latchedBuffer === undefined) latchedBuffer = readBuffer();
  return latchedBuffer;
};
const forgetBufferAtMount = () => {
  latchedBuffer = undefined;
};
const noBufferOnServer = () => NO_BUFFER;
/** The example org the calculator used to ship with. Only referenced to
    recognise and discard leftovers of it — see the crash-buffer restore. */
const RETIRED_EXAMPLE_ORG = "Blue Sky Air Conditioning";

const STEP_META = [
  { key: "staff", title: "Staff and wages" },
  { key: "business", title: "Business costs" },
  { key: "vehicles", title: "Vehicles" },
  { key: "risk", title: "HVAC risk" },
  { key: "profit", title: "Profit target" },
] as const;

/** What a step comes to, for its line in the path: a figure, never a
    description, and nothing at all until the step has been started. */
function stepSummary(key: string, s: RateCalcState, calc: CalcResult): string {
  switch (key) {
    case "staff": {
      const n = s.mode.staff === "Simple" ? (s.simpleLabour.staff_count || s.staff.length) : s.staff.length;
      return `${n} staff, ${money(calc.instLab + calc.svcLab + calc.adminLab)} a year`;
    }
    case "business": return `${money(calc.enteredBiz)} a year`;
    case "vehicles": {
      if (s.noVehicles) return "No vehicles";
      const n = s.vehicles.length;
      const fleet = money(calc.instVehicle + calc.svcVehicle + calc.adminVehicle);
      return n > 0 ? `${n} vehicle${n === 1 ? "" : "s"}, ${fleet} a year` : `${fleet} a year`;
    }
    case "risk": return `Install ${s.risk.warranty + s.risk.defect}%, service ${s.risk.callback + s.risk.diagnostic}%`;
    case "profit": return `${s.profit.margin}% margin`;
    default: return "";
  }
}

const TICK = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m4 8.5 2.5 2.5L12 5.5" />
  </svg>
);

/* THE PATH. The way back to Quoting, the five steps with what each comes
   to, then Your rates and Insights, which open once every step is done.
   The step you are on is outlined in ink (rule 10, as a tab you are on);
   a step with your figures in it wears a tick in green's word value, and
   one running on the defaults a grey tick, since grey is for your
   information (rule 17). No step is ever a black disc (rule 22). */
function Path({ step, completions, s, calc, allDone, go }: {
  step: number; completions: string[]; s: RateCalcState; calc: CalcResult; allDone: boolean; go: (n: number) => void;
}) {
  return (
    <nav className="rc-path" aria-label="Rate calculator">
      <LinkButton href="/dashboard/admin/quoting" className="rc-back">Back to Quoting</LinkButton>
      <p className="rc-head">Set up</p>
      {STEP_META.map((m, i) => {
        const comp = completions[i];
        const cur = i === step;
        const done = comp === "complete" || comp === "customised";
        const dflt = comp === "defaults";
        const cls = ["rc-node", done ? "is-done" : dflt ? "is-dflt" : ""].filter(Boolean).join(" ");
        return (
          <button key={m.key} type="button" className={cls} aria-current={cur ? "step" : undefined} onClick={() => go(i)}>
            <span className="rc-mark" aria-hidden="true">{(done || dflt) && !cur ? TICK : i + 1}</span>
            <span className="rc-node-w">
              <b>{m.title}</b>
              {comp !== "not_started" && <span>{stepSummary(m.key, s, calc)}{dflt ? ", the usual" : ""}</span>}
            </span>
          </button>
        );
      })}
      <p className="rc-head">Then</p>
      {([["Your rates", 5], ["Insights", 6]] as const).map(([name, n]) => (
        <button key={name} type="button" className="rc-node is-out" aria-current={step === n ? "page" : undefined} disabled={!allDone} onClick={() => go(n)}>
          <span className="rc-mark" aria-hidden="true" />
          <span className="rc-node-w">
            <b>{name}</b>
            {!allDone && <span>Once the five steps are done</span>}
          </span>
        </button>
      ))}
    </nav>
  );
}

/** How far what you charge sits from what's recommended, as a state word. */
function Gap({ rec, cur }: { rec: number | null; cur: number | null }) {
  if (rec == null || cur == null) return null;
  const diff = Math.round(rec) - cur;
  if (diff > 0) return <StateWord tone="look">{`$${diff} under`}</StateWord>;
  return <StateWord tone="good">{diff < 0 ? `$${-diff} above` : "On target"}</StateWord>;
}

function RateBlock({ label, k, rec, be, ready, currentRates, patch }: {
  label: string; k: "install" | "service"; rec: number | null; be: number | null; ready: boolean;
  currentRates: RateCalcState["currentRates"]; patch: (p: Partial<RateCalcState>) => void;
}) {
  const cur = currentRates[k];
  const shown = ready && rec != null;
  return (
    <div className="rc-rate">
      <div className="rc-rate-top"><span>{label}</span><b>{shown ? rate0(rec) : "—"}</b></div>
      {shown && <div className="rc-line"><span>an hour, {gstOf(rec)} with GST</span></div>}
      <div className="rc-line"><span>Breaks even at</span><b>{ready && be != null ? rate0(be) : "—"}</b></div>
      <div className="rc-line">
        <span className="rc-charge">
          You charge
          <TextInput
            size={32}
            inputMode="decimal"
            className="rc-num"
            aria-label={`Current ${label.toLowerCase()} rate`}
            value={cur == null ? "" : String(cur)}
            onChange={(e) => patch({ currentRates: { ...currentRates, [k]: parseRate(e.target.value) } })}
          />
        </span>
        {ready && <Gap rec={rec} cur={cur} />}
      </div>
    </div>
  );
}

/* YOUR RATES, beside every step. A card, since what you charge is typed
   into it (rule 35). Until the numbers are in it says what's missing and
   nothing else (rule 40). */
function RatesCard({ s, calc, uplift, ready, missing, patch }: {
  s: RateCalcState; calc: CalcResult; uplift: number | null; ready: boolean;
  missing: string[]; patch: (p: Partial<RateCalcState>) => void;
}) {
  return (
    <aside className="rc-card" aria-labelledby="rc-yours">
      <h2 id="rc-yours">Your rates</h2>
      {!ready && <p>To see your rates, enter {listed(missing)}.</p>}
      <RateBlock label="Install" k="install" rec={calc.recInst} be={calc.beInst} ready={ready} currentRates={s.currentRates} patch={patch} />
      <RateBlock label="Service" k="service" rec={calc.recSvc} be={calc.beSvc} ready={ready} currentRates={s.currentRates} patch={patch} />
      <dl className="rc-rows">
        <div><dt>A full day on site</dt><dd>{ready && calc.daily != null ? money(calc.daily) : "—"}</dd></div>
        <div><dt>After hours, emergency</dt><dd>{ready ? `${rate0(calc.afterHrs)}, ${rate0(calc.emergency)}` : "—"}</dd></div>
        <div><dt>How sure</dt><dd>{ready ? calc.confidence.label : "—"}</dd></div>
      </dl>
      {ready && uplift != null && uplift > 0 && <p>Charging these recovers <b>{money(uplift)}</b> a year.</p>}
    </aside>
  );
}

/* WHAT YOU CHARGE NOW, on the first visit (his mock's "First visit"). The
   figures the gap words in Your rates are measured from. */
function FirstRates({ s, patch, onDone }: {
  s: RateCalcState; patch: (p: Partial<RateCalcState>) => void; onDone: () => void;
}) {
  const [inst, setInst] = React.useState(s.currentRates.install != null ? String(s.currentRates.install) : "");
  const [svc, setSvc] = React.useState(s.currentRates.service != null ? String(s.currentRates.service) : "");
  const save = () => {
    patch({ currentRates: { install: parseRate(inst), service: parseRate(svc) } });
    onDone();
  };
  const skip = () => { patch({ currentRates: { install: null, service: null } }); onDone(); };
  return (
    <Dialog
      heading="What do you charge right now?"
      onClose={skip}
      width={560}
      foot={
        <>
          <Button onClick={skip}>I don&apos;t know yet</Button>
          <Button kind="main" onClick={save}>Start</Button>
        </>
      }
    >
      <div className="rc-two-fields">
        <Field label="Install, an hour">
          <TextInput inputMode="decimal" className="rc-num" data-autofocus value={inst} onChange={(e) => setInst(e.target.value.replace(/[^0-9.]/g, ""))} />
        </Field>
        <Field label="Service, an hour">
          <TextInput inputMode="decimal" className="rc-num" value={svc} onChange={(e) => setSvc(e.target.value.replace(/[^0-9.]/g, ""))} />
        </Field>
      </div>
    </Dialog>
  );
}

type SaveState = "idle" | "saving" | "saved" | "local";

const SAVE_WORDS: Record<SaveState, string> = {
  idle: "saves as you type",
  saving: "saving",
  saved: "saved",
  local: "saved on this computer, trying again",
};

// ── Calculator app (remounted per data mode) ────────────────────────────
function CalculatorApp({ initial, hasData, showOnboarding, onPersist, onReset, saveState, xeroConnected, superOwned = false }: {
  initial: RateCalcState;
  hasData: boolean;
  showOnboarding: boolean;
  onPersist: ((next: RateCalcState) => void) | null;
  /** Clear the org's saved setup — see RateCalculator.reset. */
  onReset: () => Promise<boolean>;
  saveState: SaveState;
  xeroConnected?: boolean;
  /** pay_settings holds a super rate — the settings show it read-only. */
  superOwned?: boolean;
}) {
  // Returning users with a complete setup land on Your rates (the review
  // moment); a first run or an unfinished setup lands on Step 1.
  const [step, setStep] = React.useState(() => {
    if (!hasData) return 0;
    const run = runEngine(initial);
    return run.ready && allStepsDone(run.steps) ? 5 : 0;
  }); // 0–4 steps, 5 = your rates, 6 = insights
  // Onboarding chain (How to use, then what you charge) runs once per fresh
  // empty setup; reopening How to use must NOT re-trigger the second.
  // "Don't show this again" is remembered for the session.
  const helpDismissed = React.useSyncExternalStore(
    noStorageSubscription,
    helpDismissedNow,
    helpNotDismissed
  );
  /* Each is null until somebody acts on that dialog; until then the chain says
     where we are. Dismissed already ⇒ How to use is skipped and what you
     charge is where a fresh setup lands. */
  const [helpOpen, setHelpOpen] = React.useState<boolean | null>(null);
  const [introOpen, setIntroOpen] = React.useState<boolean | null>(null);
  const [chainDone, setChainDone] = React.useState(false);
  const showHelp = helpOpen ?? (showOnboarding && !helpDismissed);
  const showRatesIntro = introOpen ?? (showOnboarding && helpDismissed);
  /* Still owed the intro — false once it has been handed over, and false from
     the start when How to use was dismissed before this screen opened. */
  const chainOwed = showOnboarding && !chainDone && !helpDismissed;
  const [showSettings, setShowSettings] = React.useState(false);
  const [showBanner, setShowBanner] = React.useState(true);
  const [s, setS] = React.useState(initial);
  const patch = (p: Partial<RateCalcState>) => setS(prev => ({ ...prev, ...p }));
  // Persist AFTER render commits — calling the host mid-updater would set
  // parent state while this component renders (React error).
  const firstRender = React.useRef(true);
  const pushUp = React.useEffectEvent(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (onPersist) { try { onPersist(s); } catch { /* host handles save errors */ } }
  });
  React.useEffect(() => {
    pushUp();
  }, [s]);
  const { calc, health, steps, uplift, ready, missing } = runEngine(s);
  const results = step === 5;
  const insights = step === 6;
  const StepBody = [StaffStep, BusinessStep, VehiclesStep, RiskStep, ProfitStep][step] || StaffStep;
  const completions = [steps.staff.completion, steps.business.completion, steps.vehicles.completion, steps.risk.completion, steps.profit.completion];
  const allDone = allStepsDone(steps);

  // Continue doubles as acceptance on the defaults steps, and the final
  // Continue only reaches Your rates when every step is done — otherwise it
  // walks back to the first unfinished step.
  const onContinue = () => {
    if (step === 3 && !s.riskAccepted) patch({ riskAccepted: true });
    if (step === 4) {
      if (!s.profitAccepted) patch({ profitAccepted: true });
      // patch is async — evaluate doneness with profit locally accepted
      const doneWithProfit = completions
        .map((c, i) => (i === 4 && c === "not_started") ? "defaults" : c)
        .every(c => DONE_COMPLETIONS.includes(c));
      if (doneWithProfit) { setStep(5); return; }
      const firstIncomplete = completions.findIndex((c, i) => i !== 4 && !DONE_COMPLETIONS.includes(c));
      setStep(firstIncomplete === -1 ? 5 : firstIncomplete);
      return;
    }
    setStep(step + 1);
  };

  // Simple/Detailed is hidden for the first-run session and returns on later
  // visits (hasData) — per step, only where Detailed has data it can actually
  // edit: Staff needs ~3 months of timesheets, Vehicles needs vehicle
  // records; Business is ungated. Gates decide whether the choice SHOWS only —
  // a state already saved in Detailed keeps rendering Detailed.
  const allowToggles = hasData;
  const toggleGates = [
    allowToggles && timesheetWeeks(s) >= 12,
    allowToggles,
    allowToggles && s.vehicles.length > 0,
    false, // risk — no Detailed mode
    false, // profit — no Detailed mode
  ];

  // Review reminder — derived from the stored timestamp, shown only once the
  // configured reminder period has actually elapsed.
  const daysSince = daysSinceReviewed(s.reviewState.lastReviewed);
  const reviewDue = daysSince != null && daysSince >= (s.settings.review_reminder_months ?? 6) * 30;

  const onHelpClose = (dontShow: boolean) => {
    setHelpOpen(false);
    if (dontShow) { try { window.sessionStorage.setItem(HELP_DISMISSED_KEY, "1"); } catch { /* storage unavailable */ } }
    if (chainOwed) { setChainDone(true); setIntroOpen(true); }
  };

  const allButProfitDone = completions.slice(0, 4).every(c => DONE_COMPLETIONS.includes(c));

  return (
    <div className="rc">
      {showHelp && <HelpDialog onClose={onHelpClose} />}
      {showRatesIntro && <FirstRates s={s} patch={patch} onDone={() => setIntroOpen(false)} />}
      {showSettings && <SettingsDialog st={s} patch={patch} onClose={() => setShowSettings(false)} onReset={onReset} superOwned={superOwned} />}

      <Path step={step} completions={completions} s={s} calc={calc} allDone={allDone} go={setStep} />

      <div className="rc-body">
        <div className="rc-top">
          <h1>Rate calculator</h1>
          <StateWord tone={HEALTH_TONE[health.type] ?? "info"}>{health.status}</StateWord>
          <Button kind="quiet" onClick={() => setHelpOpen(true)}>How to use</Button>
          <Button kind="second" icon="settings" onClick={() => setShowSettings(true)}>Settings</Button>
        </div>

        {showBanner && !results && !insights && reviewDue && (
          <ReviewDue daysSince={daysSince} message={s.reviewState.message || null} onReview={() => { setShowBanner(false); setStep(0); }} onDismiss={() => setShowBanner(false)} />
        )}

        {results ? (
          <YourRates s={s} calc={calc} uplift={uplift} ready={ready} missing={missing} go={setStep} patch={patch} />
        ) : insights ? (
          <InsightsView s={s} patch={patch} calc={calc} ready={ready} go={setStep} />
        ) : (
          <div className="rc-cols">
            <section className="rc-step" aria-label={STEP_META[step]?.title}>
              <StepBody s={s} patch={patch} calc={calc} showToggle={toggleGates[step] ?? false} xeroConnected={xeroConnected} />
              <div className="rc-foot">
                <Button disabled={step === 0} onClick={() => setStep(Math.max(0, step - 1))}>Back</Button>
                <span>Step {step + 1} of 5, {SAVE_WORDS[saveState]}</span>
                <Button kind="main" onClick={onContinue}>{step === 4 && allButProfitDone ? "See your rates" : "Continue"}</Button>
              </div>
            </section>
            <RatesCard s={s} calc={calc} uplift={uplift} ready={ready} missing={missing} patch={patch} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Root: persistence + example-data mode ───────────────────────────────
export function RateCalculator({ initialState, initialUpdatedAt, roster = [], xeroConnected = false, orgSuperPct = null }: {
  initialState: unknown;
  initialUpdatedAt?: string | null;
  /** Staff come from the roster (staff_profiles) now — the calculator reads
      them, never stores them. Wages are managed in Team. */
  roster?: StaffMember[];
  /** Whether a Xero grant exists, so the Business step can offer its figures
      as a source. A boolean only — the connection is owner business. */
  xeroConnected?: boolean;
  /** The org's super rate from pay_settings — its owner since the audit
      moved it home. Non-null overrides whatever the stored blob carries, so
      a pricing session can never run on a super figure Time & Pay doesn't
      hold; null (never set) leaves the calculator's own default editable. */
  orgSuperPct?: number | null;
}) {
  void initialUpdatedAt; // reserved for buffer-vs-server reconciliation
  // "Start fresh" clears the saved row; from that point this page behaves
  // exactly like a first run — empty state, onboarding, nothing written until
  // the user edits. A counter rather than a flag so a second reset still
  // changes the key and remounts the calculator.
  const [resetCount, setResetCount] = React.useState(0);
  const hasServerState = initialState != null && resetCount === 0;
  const buffer = React.useSyncExternalStore(
    noStorageSubscription,
    bufferAtMount,
    noBufferOnServer
  );
  /* "Start fresh" wipes the buffer; nothing may restore it afterwards. */
  const [bufferDropped, setBufferDropped] = React.useState(false);
  const restored = hasServerState || bufferDropped ? null : buffer.state;
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = React.useRef<RateCalcState | null>(null);

  /* THE SAVE IS SPLIT FROM WHAT IT SAYS ABOUT ITSELF. This half touches only
     the outside world — the crash buffer and the debounced write — which is
     exactly what an effect may do, and the crash restore below calls it
     directly for that reason. `persist` is this plus the header's "saving your numbers",
     and it belongs to a keystroke. The two used to be one function with a
     `setSaveState` in it, so restoring a buffer meant setting state
     synchronously inside an effect: a `set-state-in-effect` disable, and one
     disable costs the whole component its compilation. */
  const scheduleSave = React.useCallback((next: RateCalcState) => {
    // The staff array is roster-sourced now, so it is NEVER persisted — the
    // stored row slims to the org's settings and it's re-fed from the roster on
    // every load. (Empty array keeps the save-shape guard happy.)
    next = { ...next, staff: [] };
    // Crash buffer first — synchronous, survives tab close mid-debounce.
    try { window.localStorage.setItem(BUFFER_KEY, JSON.stringify({ state: next, savedAt: Date.now() })); } catch { /* storage full/blocked */ }
    pendingRef.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      saveTimer.current = null;
      const payload = pendingRef.current;
      pendingRef.current = null;
      if (!payload) return;
      try {
        const { saveRateCalcState } = await actions();
        await saveRateCalcState(payload);
        setSaveState("saved");
        try { window.localStorage.removeItem(BUFFER_KEY); } catch { /* ignore */ }
      } catch {
        setSaveState("local"); // buffer still holds it; next edit retries
      }
    }, 600);
  }, []);

  const persist = React.useCallback(
    (next: RateCalcState) => {
      setSaveState("saving");
      scheduleSave(next);
    },
    [scheduleSave]
  );

  // Wipe everything: the pending debounced save (so it can't resurrect what we
  // just deleted), the crash buffer, the restored buffer state, and the server
  // row. The row is deleted last — only a real success is allowed to look like
  // one, and a failure leaves the user's setup where it was on the next load.
  const reset = React.useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    pendingRef.current = null;
    try {
      const { resetRateCalcState } = await actions();
      await resetRateCalcState();
    } catch {
      return false;
    }
    try { window.localStorage.removeItem(BUFFER_KEY); } catch { /* storage unavailable */ }
    setBufferDropped(true);
    setSaveState("idle");
    setResetCount(n => n + 1);
    return true;
  }, []);

  // The latch belongs to this mount — see bufferAtMount.
  React.useEffect(() => forgetBufferAtMount, []);

  // Crash-buffer restore: only when the org has never saved — a buffer means
  // a previous session's edits never reached the server.
  React.useEffect(() => {
    if (hasServerState) return;
    if (buffer.retired) {
      try { window.localStorage.removeItem(BUFFER_KEY); } catch { /* ignore */ }
      return;
    }
    if (restored) scheduleSave(restored); // push the recovered edits up immediately
  }, [hasServerState, buffer, restored, scheduleSave]);

  // Flush a pending debounced save when navigating away.
  React.useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const payload = pendingRef.current;
    if (payload) { actions().then(({ saveRateCalcState }) => saveRateCalcState(payload)).catch(() => { /* buffer holds it */ }); }
  }, []);

  // Staff always come from the roster, whatever the stored/buffered row held —
  // it's the source of truth for wages now, and it's read-only in the tool.
  // Same rule for the super rate: pay_settings owns it, so a non-null server
  // value overrides the blob's copy on every load.
  const merged = hasServerState ? hydrateState(initialState) : (restored ?? emptyState());
  const initial = {
    ...merged,
    staff: roster,
    settings:
      orgSuperPct != null ? { ...merged.settings, super_pct: orgSuperPct } : merged.settings,
  };
  const hasData = hasServerState || restored != null;
  return (
    <CalculatorApp
      key={`${resetCount}:${hasServerState ? "server" : restored ? "buffer" : "fresh"}`}
      initial={initial}
      hasData={hasData}
      showOnboarding={!hasData}
      onPersist={persist}
      onReset={reset}
      saveState={saveState}
      xeroConnected={xeroConnected}
      superOwned={orgSuperPct != null}
    />
  );
}
