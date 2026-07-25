"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { type RateRule, type Settings, fmtHval, ruleSummary } from "./logic";
import type { PayPeriod } from "./timepay";

/* Pay-settings modal: a 7-step wizard on first run, then a flat menu with the
   same controls plus the pay-run PDF export. Edits happen on a draft; nothing
   applies until Save. */

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
  period,
  canPay,
  holidaySection,
  onClose,
  onSave,
}: {
  settings: Settings;
  firstRun: boolean;
  period: PayPeriod;
  /** `financials` — gates every pay control, the wizard and Save */
  canPay: boolean;
  /** admin+ public-holiday manager, or null when the viewer isn't one */
  holidaySection?: React.ReactNode;
  onClose: () => void;
  onSave: (s: Settings) => void;
}) {
  const [draft, setDraft] = useState<Settings>(() => JSON.parse(JSON.stringify(settings)));
  // an admin without `financials` only ever sees the menu (holidays live there)
  const [mode, setMode] = useState<"wizard" | "menu">(firstRun && canPay ? "wizard" : "menu");
  const [step, setStep] = useState(0);
  const [exporting, setExporting] = useState(false);
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

  /* Where the chosen cycle actually begins. A fortnight has no natural start,
     so the owner names one; a month can run from any day. Shown inline with
     the cycle choice, since it's meaningless for a weekly cycle. */
  const anchorField = () => {
    if (draft.cycle === "Fortnightly")
      return (
        <label className="wz-anchor">
          <span>First fortnight starts</span>
          <input
            type="date"
            className="fl-i"
            value={draft.fortnightAnchor ?? ""}
            onChange={(e) => patch({ fortnightAnchor: e.target.value || null })}
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
                {rl.rate === 1.5 ? (
                  <>
                    <span className="rl-then">then 2× after</span>
                    <span className="rl-step">
                      <button aria-label="Less" onClick={() => patchRule(k, { up: Math.max(0.5, (rl.up || 2) - 0.5) })}>−</button>
                      <b>{fmtHval(rl.up ?? 2)}</b>
                      <button aria-label="More" onClick={() => patchRule(k, { up: Math.min(8, (rl.up || 2) + 0.5) })}>+</button>
                    </span>
                  </>
                ) : (
                  <span className="rl-then">all day</span>
                )}
              </div>
            )}
          </div>
        );
      })}
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

  const fakeExport = () => {
    if (exporting) return;
    setExporting(true);
    setTimeout(() => setExporting(false), 1800);
  };

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
      s: "Hours beyond this earn time and a half.",
      body: (
        <>
          {stepper("otAfter")}
          {unitPills("ctr")}
        </>
      ),
    },
    {
      t: "Weekend & holiday rates",
      s: "Set when higher rates kick in for each day type — e.g. Saturdays pay 1.5× for the first two hours, then double time.",
      body: (
        <>
          {ruleRows}
          <div className="wz-or">and on any day — 2× after a long day of</div>
          {stepper("dblAfter")}
        </>
      ),
    },
    {
      t: "Auto-submit",
      s: "Open timesheets submit themselves at this moment each cycle. Scroll to pick.",
      body: (
        <>
          {submitPicker}
          <Toggle on={draft.lock} label="Lock timesheets once submitted" onFlip={() => patch({ lock: !draft.lock })} />
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
            ["Overtime", "After " + fmtHval(draft.otAfter) + " / " + (draft.otUnit === "week" ? "week" : "day"), 3],
            [
              "Higher rates",
              RULE_DEFS.filter(([k]) => draft.rules[k].on)
                .map(
                  ([k]) =>
                    (k === "sat" ? "Sat" : k === "sun" ? "Sun" : k === "ph" ? "Pub hol" : "Nights") +
                    " " +
                    (draft.rules[k].rate === 2 ? "2×" : "1.5×→2×")
                )
                .join(" · ") +
                " · " +
                fmtHval(draft.dblAfter) +
                "+ 2×",
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
              {holidaySection ? menuSection("Public holidays", holidaySection) : null}
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
              {menuSection(
                "Overtime after",
                <>
                  {stepper("otAfter")}
                  <div style={{ marginTop: 10 }}>{unitPills()}</div>
                </>
              )}
              {menuSection(
                "Weekend & holiday rates",
                <>
                  {ruleRows}
                  <div className="wz-or">and on any day — 2× after a long day of</div>
                  {stepper("dblAfter")}
                </>
              )}
              {menuSection(
                "Auto-submit",
                <>
                  {submitPicker}
                  <Toggle on={draft.lock} label="Lock timesheets once submitted" onFlip={() => patch({ lock: !draft.lock })} />
                </>
              )}
              {menuSection(
                "Export pay run",
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
                  <button
                    className={`bbtn ink${exporting ? " busy" : ""}`}
                    style={{ width: "100%", justifyContent: "center", height: 52 }}
                    onClick={fakeExport}
                  >
                    {exporting ? (
                      <>
                        <span className="sp" style={{ display: "inline-flex" }}>
                          <Icon name="activity" size={16} />
                        </span>
                        Generating…
                      </>
                    ) : (
                      <>
                        <Icon name="download" size={16} />
                        Export {period.range} {period.year} (PDF)
                      </>
                    )}
                  </button>
                </>
              )}
                </>
              )}
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
                  Re-run setup
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
