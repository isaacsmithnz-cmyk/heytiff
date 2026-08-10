"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { DateField } from "@/components/ui/date-field";
import { TimeWheel } from "@/components/ui/time-wheel";
import { type RateRule, type Settings, fmtHval, ruleSummary } from "./logic";

/* Pay-settings modal: a 7-step wizard on first run, then a flat menu with the
   same controls. Edits happen on a draft; nothing applies until Save. */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIMES = (() => {
  const t: string[] = [];
  for (let h = 6; h <= 21; h++) t.push((((h + 11) % 12) + 1) + ":00 " + (h < 12 ? "AM" : "PM"));
  return t;
})();
/* stepper limits: [min, max, step] */
const LIM: Record<string, [number, number, number]> = {
  standard: [4, 12, 0.5],
  otAfterDay: [4, 14, 0.5],
  otAfterWeek: [30, 60, 1],
  dblAfter: [8, 16, 0.5],
};
const RULE_DEFS: [keyof Settings["rules"], string, string][] = [
  ["sat", "Saturdays", ""],
  ["sun", "Sundays", ""],
  ["ph", "Public holidays", ""],
  ["night", "Night shift", "10 PM – 6 AM"],
];

function Toggle({ on, label, onFlip }: { on: boolean; label: string; onFlip: () => void }) {
  return (
    <button className="wz-tglrow" onClick={onFlip}>
      <span>{label}</span>
      <span className={`wz-sw${on ? " on" : ""}`}>
        <i></i>
      </span>
    </button>
  );
}

export function TimePaySettings({
  settings,
  firstRun,
  canPay,
  holidaySection,
  xeroSection,
  onClose,
  onSave,
}: {
  settings: Settings;
  firstRun: boolean;
  /** `financials` — gates every pay control, the wizard and Save */
  canPay: boolean;
  /** admin+ public-holiday manager, or null when the viewer isn't one */
  holidaySection?: React.ReactNode;
  /** staff↔Xero payroll matching, or null when Xero isn't connected. Rendered
      only with `canPay`: it decides whose pay attaches to which payroll record
      and reports drift in pay-adjacent fields. */
  xeroSection?: React.ReactNode;
  onClose: () => void;
  onSave: (s: Settings) => void;
}) {
  const [draft, setDraft] = useState<Settings>(() => JSON.parse(JSON.stringify(settings)));
  // an admin without `financials` only ever sees the menu (holidays live there)
  const [mode, setMode] = useState<"wizard" | "menu">(firstRun && canPay ? "wizard" : "menu");
  const [step, setStep] = useState(0);
  /* At most one of the two folding sections is open, so the menu can't grow
     into two long lists at once — and the one you opened stays where you can
     see it. Nothing is open on arrival: pay settings are what this modal is
     for. */
  const [openSection, setOpenSection] = useState<"holidays" | "xero" | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const patch = (p: Partial<Settings>) => setDraft((d) => ({ ...d, ...p }));
  const patchRule = (k: keyof Settings["rules"], p: Partial<RateRule>) =>
    setDraft((d) => ({ ...d, rules: { ...d.rules, [k]: { ...d.rules[k], ...p } } }));
  const stepVal = (key: "standard" | "otAfter" | "dblAfter", dir: 1 | -1) => {
    const lim = key === "otAfter" ? (draft.otUnit === "week" ? LIM.otAfterWeek : LIM.otAfterDay) : LIM[key];
    setDraft((d) => ({ ...d, [key]: Math.min(lim[1], Math.max(lim[0], d[key] + lim[2] * dir)) }));
  };

  /* centre the selected day/time in the scroll wheels */
  useEffect(() => {
    panelRef.current?.querySelectorAll(".wz-scroll").forEach((sc) => {
      const on = sc.querySelector<HTMLElement>(".on");
      if (on) sc.scrollTop = Math.max(0, on.offsetTop - (sc.clientHeight - on.offsetHeight) / 2);
    });
  }, [mode, step]);

  const stepper = (key: "standard" | "otAfter" | "dblAfter") => (
    <div className="wz-step">
      <button className="wz-sbtn" aria-label="Decrease" onClick={() => stepVal(key, -1)}>−</button>
      <span className="wz-val">{fmtHval(draft[key])}</span>
      <button className="wz-sbtn" aria-label="Increase" onClick={() => stepVal(key, 1)}>+</button>
    </div>
  );

  /* The org's super guarantee %. Owned here — My Pay shows it to every staff
     member and the Rate Calculator prices from it, so this is the ONE place
     it is set. Displayed as the statutory default until the org names one. */
  const superStepper = () => {
    const shown = draft.superPct ?? 12;
    const stepSuper = (dir: 1 | -1) =>
      patch({ superPct: Math.min(25, Math.max(0, Math.round((shown + 0.25 * dir) * 100) / 100)) });
    return (
      <div className="wz-step">
        <button className="wz-sbtn" aria-label="Decrease" onClick={() => stepSuper(-1)}>−</button>
        <span className="wz-val">{shown}%{draft.superPct == null ? " · default" : ""}</span>
        <button className="wz-sbtn" aria-label="Increase" onClick={() => stepSuper(1)}>+</button>
      </div>
    );
  };

  /* Where the chosen cycle actually begins. A fortnight has no natural start,
     so the owner names one; a month can run from any day. Shown inline with
     the cycle choice, since it's meaningless for a weekly cycle. */
  const anchorField = () => {
    if (draft.cycle === "Fortnightly")
      return (
        <label className="wz-anchor">
          <span>First fortnight starts</span>
          <DateField
            size="lg"
            clearable
            value={draft.fortnightAnchor ?? null}
            onChange={(iso) => patch({ fortnightAnchor: iso })}
          />
          <em>Every pay fortnight is counted from this date. Snaps to that week&rsquo;s Monday.</em>
        </label>
      );
    if (draft.cycle === "Monthly")
      return (
        <label className="wz-anchor">
          <span>Pay month starts on the</span>
          <select
            className="fl-i"
            value={draft.monthStartDay}
            onChange={(e) => patch({ monthStartDay: Number(e.target.value) })}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
                {d === 1 ? "st" : d === 2 ? "nd" : d === 3 ? "rd" : d === 21 ? "st" : d === 22 ? "nd" : d === 23 ? "rd" : "th"}
              </option>
            ))}
          </select>
          <em>1st = calendar month. Runs to the day before next month&rsquo;s start.</em>
        </label>
      );
    return null;
  };

  const unitPills = (extraClass = "") => (
    <div className={`wz-pills sm ${extraClass}`.trim()}>
      {([["day", "Per day"], ["week", "Per week"]] as const).map(([u, label]) => (
        <button
          key={u}
          className={`wz-pill${draft.otUnit === u ? " on" : ""}`}
          onClick={() => patch({ otUnit: u, otAfter: u === "week" ? 38 : 8 })}
        >
          {label}
        </button>
      ))}
    </div>
  );

  /* THE WHOLE LADDER, IN ONE PLACE. `otAfter` was its own section; `dblAfter`
     — the rung directly above it — sat at the bottom of "Weekend & holiday
     rates", below the night-shift row, behind a label reading "AND ON ANY DAY
     — 2× AFTER A LONG DAY OF" in tracked caps. But `dblAfter` is not a weekend
     rule at all: `splitDay` gives a Saturday or a public holiday its own rate
     for the WHOLE day and never reaches the ladder, so the only day this
     number ever applies to is an ordinary weekday — the same day the setting
     two sections above it is about. One question, asked in two places, one of
     them the wrong place. */
  const overtimeControls = (
    <>
      <div className="ms-rung">
        <span className="ms-rungl">Time and a half after</span>
        {stepper("otAfter")}
        {unitPills("ctr")}
      </div>
      <div className="ms-rung">
        <span className="ms-rungl">Then double time after</span>
        {stepper("dblAfter")}
        <p className="ms-p">
          Both count an ordinary weekday. A Saturday, Sunday or public holiday takes its own rate
          for the whole day and never reaches this ladder.
        </p>
      </div>
    </>
  );

  const ruleRows = (
    <>
      {RULE_DEFS.map(([k, name, hint]) => {
        const rl = draft.rules[k];
        return (
          <div className={`prule${rl.on ? " on" : ""}`} key={k}>
            <button className="rl-head" onClick={() => patchRule(k, { on: !rl.on })}>
              <span className="rl-nm">
                {name}
                {hint ? <em>{hint}</em> : null}
              </span>
              <span className="rl-sum">{rl.on ? ruleSummary(rl) : "Standard rates"}</span>
              <span className={`wz-sw${rl.on ? " on" : ""}`}>
                <i></i>
              </span>
            </button>
            {rl.on && (
              <div className="rl-ctl">
                <div className="wz-pills xs">
                  {([[1.5, "1.5×"], [2, "2×"]] as const).map(([rate, label]) => (
                    <button
                      key={rate}
                      className={`wz-pill${rl.rate === rate ? " on" : ""}`}
                      onClick={() => patchRule(k, { rate, up: rate === 2 ? null : rl.up || 2 })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* Only the 1.5× branch has a follow-up question. The 2×
                    branch used to render "all day" in the CONTROL row, in the
                    same style as the "then 2× after" label beside a stepper —
                    so it read as a field that had been disabled, when it is
                    just the absence of a second rung. The row's own summary
                    already says "2× all day". */}
                {rl.rate === 1.5 && (
                  <>
                    <span className="rl-then">then 2× after</span>
                    <span className="rl-step">
                      <button aria-label="Less" onClick={() => patchRule(k, { up: Math.max(0.5, (rl.up || 2) - 0.5) })}>−</button>
                      <b>{fmtHval(rl.up ?? 2)}</b>
                      <button aria-label="More" onClick={() => patchRule(k, { up: Math.min(8, (rl.up || 2) + 0.5) })}>+</button>
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );

  /* Breaks. Menu-only, deliberately: the first-run wizard is seven steps and
     an eighth would push a decision most workspaces don't have to make into
     everyone's setup. The default (0 minutes, paid) is "no break configured",
     which is what the wizard would have chosen anyway. */
  /* HOW LONG FIRST, THEN WHETHER IT'S PAID. The order was the other way
     around, so a workspace with no break configured was asked whether a break
     of zero minutes was paid or unpaid — above a stepper reading "No standard
     break", under a note explaining what happens "when unpaid". Three controls
     describing something that doesn't exist. The second question only means
     anything once the first has an answer. */
  const breakControls = (
    <>
      <div className="wz-step">
        <button
          className="wz-sbtn"
          aria-label="Shorter break"
          onClick={() => patch({ breakMinutes: Math.max(0, draft.breakMinutes - 15) })}
        >
          −
        </button>
        <span className="wz-val">
          {draft.breakMinutes === 0 ? "No standard break" : draft.breakMinutes + " min"}
        </span>
        <button
          className="wz-sbtn"
          aria-label="Longer break"
          onClick={() => patch({ breakMinutes: Math.min(120, draft.breakMinutes + 15) })}
        >
          +
        </button>
      </div>
      {draft.breakMinutes > 0 ? (
        <>
          <div className="wz-pills sm" style={{ marginTop: 10 }}>
            {([[true, "Paid"], [false, "Unpaid"]] as const).map(([paid, label]) => (
              <button
                key={label}
                className={`wz-pill${draft.breakPaid === paid ? " on" : ""}`}
                onClick={() => patch({ breakPaid: paid })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="ms-p">
            {draft.breakPaid
              ? "A paid break is on the clock — nothing comes off the day, and there is nothing for anyone to adjust."
              : "Comes off worked hours. Staff can adjust a day’s break when logging it."}
          </p>
        </>
      ) : (
        <p className="ms-p">
          Nothing comes off anyone&rsquo;s day. Set a length above if your workspace has a standard
          break.
        </p>
      )}
    </>
  );

  /* Normal hours. This is the setting the whole timesheet leans on: every
     Mon–Fri is presumed worked at these times once the day is over, so a
     workspace that sets them once has staff who never enter an ordinary day
     again. Scrolled, not typed — the same wheel the timesheet uses, because
     the one thing that must not happen is an unreadable default seeding every
     person's every week. A staff member whose own day differs overrides it
     from their own timesheet; this is the fallback, not a ceiling. */
  const normalHoursControls = (
    <>
      <div className="wz-wheels">
        <TimeWheel
          label="Normal start"
          value={draft.defaultStart}
          onChange={(defaultStart) => patch({ defaultStart })}
        />
        <TimeWheel
          label="Normal finish"
          value={draft.defaultEnd}
          onChange={(defaultEnd) => patch({ defaultEnd })}
        />
      </div>
      <div className="wz-dow" role="group" aria-label="Normal working days">
        {/* TWO LETTERS, not one. "M T W T F S S" has two Ts and two Ss, so
            which one you are pressing is a matter of counting across from the
            left — on the control that decides which days get filled in for
            every person in the workspace. */}
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((l, i) => (
          <button
            key={i}
            className={`wz-dowb${draft.workDays.includes(i) ? " on" : ""}`}
            aria-label={DAYS[i]}
            aria-pressed={draft.workDays.includes(i)}
            onClick={() =>
              patch({
                workDays: draft.workDays.includes(i)
                  ? draft.workDays.filter((d) => d !== i)
                  : [...draft.workDays, i].sort(),
              })
            }
          >
            {l}
          </button>
        ))}
      </div>
      <p className="ms-p">
        These days are filled in with these hours automatically. Anyone whose week is different —
        a part-timer, an early start — can set their own from their timesheet. Casuals are never
        filled in: every day of theirs is entered by hand.
      </p>
    </>
  );

  /* WHAT THE LOCK ACTUALLY DOES, said out loud. It was a bare toggle, and it
     is the most consequential switch in this modal: with it on, a submitted
     timesheet cannot be touched by the person who submitted it, and the only
     way back is a manager sending it back. Somebody turning it on deserves to
     know they are the recovery path. */
  const lockControls = (
    <>
      <Toggle
        on={draft.lock}
        label="Lock timesheets once submitted"
        onFlip={() => patch({ lock: !draft.lock })}
      />
      <p className="ms-p" style={{ margin: "10px 0 0" }}>
        {draft.lock
          ? "Once someone submits, only sending their sheet back reopens it — so a correction has to come through you."
          : "Staff can keep correcting a submitted sheet until the period closes. You'll see the changes when you review it."}
      </p>
    </>
  );

  const submitPicker = (
    <div className="wz-subgrid">
      <div>
        <div className="wz-sl">Day</div>
        <div className="wz-scroll">
          {DAYS.map((w) => (
            <div key={w} className={`wz-si${draft.submitDay === w ? " on" : ""}`} onClick={() => patch({ submitDay: w })}>
              {w}
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="wz-sl">Time</div>
        <div className="wz-scroll">
          {TIMES.map((t) => (
            <div key={t} className={`wz-si${draft.submitTime === t ? " on" : ""}`} onClick={() => patch({ submitTime: t })}>
              {t}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const steps: { t: string; s: string; body: React.ReactNode }[] = [
    {
      t: "Pay cycle",
      s: "How often payroll runs.",
      body: (
        <div className="wz-cards">
          {([
            ["Weekly", "Pays every week", "Most common"],
            ["Fortnightly", "Pays every two weeks", ""],
            ["Monthly", "Pays once a month", ""],
          ] as const).map(([c, blurb, tag]) => (
            <button key={c} className={`wz-card${draft.cycle === c ? " on" : ""}`} onClick={() => patch({ cycle: c })}>
              <b>{c}</b>
              <em>{blurb}</em>
              {tag ? <span className="wz-tag">{tag}</span> : null}
            </button>
          ))}
          {anchorField()}
        </div>
      ),
    },
    {
      t: "Week starts on",
      s: "Pick any day — your roster and pay week begin here.",
      body: (
        <div className="wz-pills">
          {DAYS.map((w) => (
            <button key={w} className={`wz-pill${draft.weekStart === w ? " on" : ""}`} onClick={() => patch({ weekStart: w })}>
              {w}
            </button>
          ))}
        </div>
      ),
    },
    {
      t: "Standard working day",
      s: "Default 8 hours — adjust if yours differs. Days matching this show green; longer counts toward overtime, shorter shows as an under day.",
      body: stepper("standard"),
    },
    {
      t: "Overtime",
      s: "The two rungs of an ordinary weekday: time and a half past the first, double time past the second.",
      body: overtimeControls,
    },
    {
      t: "Weekend & holiday rates",
      s: "Set when higher rates kick in for each day type — e.g. Saturdays pay 1.5× for the first two hours, then double time.",
      body: ruleRows,
    },
    {
      t: "Auto-submit",
      s: "Open timesheets submit themselves at this moment each cycle. Scroll to pick.",
      body: (
        <>
          {submitPicker}
          {lockControls}
        </>
      ),
    },
    {
      t: "Review",
      s: "Everything in one place — save when it looks right.",
      body: (
        <>
          {([
            ["Pay cycle", draft.cycle, 0],
            ["Week starts on", draft.weekStart, 1],
            ["Standard day", fmtHval(draft.standard), 2],
            [
              "Overtime",
              "1.5× after " +
                fmtHval(draft.otAfter) +
                " / " +
                (draft.otUnit === "week" ? "week" : "day") +
                " · 2× after " +
                fmtHval(draft.dblAfter),
              3,
            ],
            [
              "Higher rates",
              RULE_DEFS.filter(([k]) => draft.rules[k].on)
                .map(
                  ([k]) =>
                    (k === "sat" ? "Sat" : k === "sun" ? "Sun" : k === "ph" ? "Pub hol" : "Nights") +
                    " " +
                    (draft.rules[k].rate === 2 ? "2×" : "1.5×→2×")
                )
                .join(" · "),
              4,
            ],
            ["Auto-submit", draft.submitDay + " " + draft.submitTime + (draft.lock ? " · locks" : ""), 5],
          ] as [string, string, number][]).map(([label, val, target]) => (
            <div className="wz-rev" key={label}>
              <span>{label}</span>
              <b>{val}</b>
              <button className="wz-edit" onClick={() => setStep(target)}>
                Edit
              </button>
            </div>
          ))}
        </>
      ),
    },
  ];

  const menuSection = (label: string, body: React.ReactNode) => (
    <div className="ms">
      <div className="ms-l">{label}</div>
      {body}
    </div>
  );

  /* A section you have to ask for. Public holidays and Xero payroll are both
     full tools in their own right — a year of dated rows, a payroll roster —
     and both used to render open, above every pay setting, so opening the gear
     to change a break landed you in a calendar. They are also the two sections
     that COST something to show (each fetches when it mounts), so keeping them
     shut keeps them free. Mounted only while open, which is what makes the
     lazy fetch inside each one meaningful. */
  const disclosure = (
    key: "holidays" | "xero",
    label: string,
    hint: string,
    body: React.ReactNode,
  ) => {
    const on = openSection === key;
    return (
      <div className={`ms ms-fold${on ? " on" : ""}`} key={key}>
        <button
          className="ms-foldh"
          aria-expanded={on}
          onClick={() => setOpenSection(on ? null : key)}
        >
          <span className="ms-foldl">
            {label}
            <em>{hint}</em>
          </span>
          <Icon name="chevR" size={15} />
        </button>
        {on && <div className="ms-foldb">{body}</div>}
      </div>
    );
  };

  const cur = steps[step];

  /* Portalled to <body>: the shell keeps will-change on .page.in, which would
     otherwise anchor this position:fixed overlay to the page instead of the
     viewport. display:contents wrappers keep the .fg .tpr style scope without
     re-applying the shell's own layout. */
  return createPortal(
    <div className="fg" style={{ display: "contents" }}>
      <div className="tpr" style={{ display: "contents" }}>
        {renderModal()}
      </div>
    </div>,
    document.body
  );

  function renderModal() {
    return (
    <div className="tset open">
      <div className="tset-bd" onClick={onClose}></div>
      <div className="tset-panel wz" ref={panelRef}>
        {mode === "wizard" ? (
          <>
            <div className="wz-head">
              <div>
                <div className="wz-k">Setup · step {step + 1} of {steps.length}</div>
                <h3>{cur.t}</h3>
                <p>{cur.s}</p>
              </div>
              <button className="tset-x" aria-label="Close" onClick={onClose}>
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className="wz-dots">
              {steps.map((_, i) => (
                <button
                  key={i}
                  className={`wz-dot${i === step ? " on" : i < step ? " done" : ""}`}
                  aria-label={`Step ${i + 1}`}
                  onClick={() => setStep(i)}
                ></button>
              ))}
            </div>
            <div className="wz-body">{cur.body}</div>
            <div className="wz-foot">
              {step > 0 && (
                <button className="bbtn" onClick={() => setStep(step - 1)}>
                  Back
                </button>
              )}
              <span className="spx"></span>
              {step < steps.length - 1 ? (
                <button className="bbtn teal" onClick={() => setStep(step + 1)}>
                  Next
                </button>
              ) : (
                <button className="bbtn teal" onClick={() => onSave(draft)}>
                  <Icon name="check" size={16} sw={2.6} />
                  Save settings
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="wz-head">
              <div>
                <div className="wz-k">Time &amp; Pay</div>
                <h3>Pay settings</h3>
                <p>How this workspace calculates time &amp; pay.</p>
              </div>
              <button className="tset-x" aria-label="Close" onClick={onClose}>
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className="wz-body wz-menu">
              {/* Pay settings FIRST. This modal is named "Pay settings" and is
                  reached by a gear on a timesheet screen; a workspace changing
                  its break policy should land on the controls, not scroll a
                  year of public holidays to reach them. The two big tools go
                  below, folded — see `disclosure`. */}
              {canPay && (
                <>
              {menuSection(
                "Pay cycle",
                <>
                  <div className="wz-pills sm">
                    {(["Weekly", "Fortnightly", "Monthly"] as const).map((c) => (
                      <button key={c} className={`wz-pill${draft.cycle === c ? " on" : ""}`} onClick={() => patch({ cycle: c })}>
                        {c}
                      </button>
                    ))}
                  </div>
                  {anchorField()}
                </>
              )}
              {menuSection(
                "Week starts on",
                <div className="wz-pills sm">
                  {DAYS.map((w) => (
                    <button key={w} className={`wz-pill${draft.weekStart === w ? " on" : ""}`} onClick={() => patch({ weekStart: w })}>
                      {w}
                    </button>
                  ))}
                </div>
              )}
              {menuSection("Standard working day", stepper("standard"))}
              {menuSection("Normal hours & days", normalHoursControls)}
              {menuSection("Breaks", breakControls)}
              {menuSection("Overtime", overtimeControls)}
              {menuSection("Weekend & holiday rates", ruleRows)}
              {menuSection(
                "Medical certificates",
                /* A PROMPT, NOT A GATE — see `certificateExpected`. Off is the
                   default and what every existing workspace keeps: nobody
                   wakes up to a new warning on a form they were already using.

                   The number counts WORKING days, the same count the request
                   form already prints under its calendar ("2 working days"),
                   so the setting and the warning are talking about one number
                   rather than two that happen to be close. */
                <>
                  <Toggle
                    on={draft.certAfterDays != null}
                    label="Ask for a certificate on longer personal leave"
                    onFlip={() => patch({ certAfterDays: draft.certAfterDays == null ? 2 : null })}
                  />
                  {draft.certAfterDays != null && (
                    <>
                      <div className="ms-rung" style={{ marginTop: 12 }}>
                        <span className="ms-rungl">From this many working days</span>
                        <div className="wz-step">
                          <button
                            className="wz-sbtn"
                            aria-label="Fewer days"
                            onClick={() =>
                              patch({ certAfterDays: Math.max(1, (draft.certAfterDays ?? 2) - 1) })
                            }
                          >
                            −
                          </button>
                          <span className="wz-val">
                            {draft.certAfterDays === 1
                              ? "Every day"
                              : `${draft.certAfterDays} days`}
                          </span>
                          <button
                            className="wz-sbtn"
                            aria-label="More days"
                            onClick={() =>
                              patch({ certAfterDays: Math.min(14, (draft.certAfterDays ?? 2) + 1) })
                            }
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <p className="ms-p">
                        Personal leave this long asks for a certificate on the request, and tells
                        the approver whether one arrived. It never blocks the booking — somebody
                        ringing in sick rarely has the document yet.
                      </p>
                    </>
                  )}
                  {draft.certAfterDays == null && (
                    <p className="ms-p" style={{ marginTop: 12 }}>
                      Nobody is asked for one, and the approver&rsquo;s screen says nothing about
                      certificates.
                    </p>
                  )}
                </>,
              )}
              {menuSection("Superannuation guarantee", superStepper())}
              {menuSection(
                "Salaried overtime",
                /* Recorded either way — this only decides whether it pays.
                   Absorbed = "reasonable additional hours" inside the salary. */
                <div className="wz-pills sm">
                  <button
                    className={`wz-pill${(draft.salariedOtPaid ?? true) ? " on" : ""}`}
                    onClick={() => patch({ salariedOtPaid: true })}
                  >
                    Pays at the rules
                  </button>
                  <button
                    className={`wz-pill${(draft.salariedOtPaid ?? true) ? "" : " on"}`}
                    onClick={() => patch({ salariedOtPaid: false })}
                  >
                    Absorbed in salary
                  </button>
                </div>
              )}
              {menuSection(
                "Auto-submit",
                <>
                  {submitPicker}
                  {lockControls}
                </>
              )}
              {/* THE EXPORT DOES NOT EXIST YET, and the button no longer
                  pretends otherwise.

                  The review that reached this section came to move it OUT of
                  the gear — an export is an action about the period you are
                  looking at, and nobody hunts for one behind a control labelled
                  "Pay settings". Reading the handler is what changed the
                  answer: `fakeExport` set a spinner for 1.8 seconds and
                  produced nothing. There is no PDF anywhere in the codebase.

                  So a person pressed "Export 29 Jun – 5 Jul (PDF)", watched
                  "Generating…", and got no file — which reads as a failed
                  download or a blocked popup, not as a feature that was never
                  built. Making that MORE discoverable would have been the
                  worse change. It says what it is until there is something to
                  press, and `exportDetail` stays a live preference so the
                  choice survives to whenever that is. */}
              {menuSection(
                "Pay run export",
                <>
                  <p className="ms-p">
                    One PDF per pay period — a line per person with hours by rate (1× · 1.5× · 2×), sick, leave and
                    approval status, plus the rate rules used. Hand it to your bookkeeper or keep it for records.
                  </p>
                  <Toggle
                    on={draft.exportDetail}
                    label="Include daily breakdown per person"
                    onFlip={() => patch({ exportDetail: !draft.exportDetail })}
                  />
                  <p className="ms-p ms-soon" style={{ margin: "12px 0 0" }}>
                    <Icon name="clock" size={14} />
                    Not built yet — there&rsquo;s nothing to download from here so far. Your choice above is
                    saved and will apply to the first export.
                  </p>
                </>
              )}
                </>
              )}

              {/* The two tools, folded and last. Neither is a preference —
                  both apply immediately, so neither joins the settings DRAFT:
                  a public holiday and a payroll link are facts about the
                  world, not choices you might Cancel out of. */}
              {holidaySection
                ? disclosure(
                    "holidays",
                    "Public holidays",
                    "Fills in for your state — add a one-off, or remove a day you work",
                    holidaySection,
                  )
                : null}
              {canPay && xeroSection
                ? disclosure(
                    "xero",
                    "Xero payroll",
                    "Match your people to their payroll records",
                    xeroSection,
                  )
                : null}
            </div>
            <div className="wz-foot menu">
              {canPay && (
                <button
                  className="wz-rerun"
                  onClick={() => {
                    setMode("wizard");
                    setStep(0);
                  }}
                >
                  <Icon name="sync" size={14} />
                  Step through setup
                </button>
              )}
              <span className="spx"></span>
              {canPay ? (
                <>
                  <button className="bbtn" onClick={onClose}>
                    Cancel
                  </button>
                  <button className="bbtn teal" onClick={() => onSave(draft)}>
                    <Icon name="check" size={16} sw={2.6} />
                    Save
                  </button>
                </>
              ) : (
                // holiday edits apply immediately (server actions), so
                // there's no draft to save — just a way out
                <button className="bbtn" onClick={onClose}>
                  Close
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
    );
  }
}
