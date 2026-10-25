"use client";

import "./pay.css";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/parts/button";
import { Chooser, type ChooserOption } from "@/components/parts/chooser";
import { Field, TextInput } from "@/components/parts/field";
import { StateWord } from "@/components/parts/state";
import { Tray, type TrayOption } from "@/components/parts/tabs";
import { Switch, Tick } from "@/components/parts/tick";
import { TimeField } from "@/components/parts/time-field";
import { useToast } from "@/components/parts/toast";
import { DateField } from "@/components/ui/date-field";
import { HolidaySection } from "@/components/timepay/holiday-section";
import { XeroPayroll, type XeroPayrollProps } from "@/components/timepay/xero-payroll";
import { fmtHval, type Settings } from "@/components/timepay/logic";
import type { SaveResult } from "@/components/profile/types";
import type { PreValidation } from "@/lib/staff/pre-validate";
import type { HolidayManagerData } from "@/lib/timepay/leave-page";
import { fmtAuWeekdayDate } from "@/lib/au-dates";
import { EditGroup, Facts, Group, SectionTitle, Setting, Wrong, useSelfSave } from "./parts";
import * as R from "./pay-rules";

/* SETTINGS › PAY AND HOLIDAYS (v2, 25 October 2026, Isaac: "Build Settings as
   the mock shows: the six sections"). What was Time & Pay's settings gear, a
   modal with a seven-step first run and then a flat menu, as groups on one
   page: how the pay cycle runs, the ordinary day, overtime, the days with
   their own rate, super, then the timesheet and leave rules, the public
   holidays and, with Xero connected, payroll matching.

   THE GATES ARE THE GEAR'S. Every pay rule needs `financials`; an admin
   without it gets the holidays and nothing that changes how pay is worked
   out, and payroll matching rides with the pay rules.

   ONE ROW, SAVED WHOLE. The rules are `pay_settings`, written by
   savePaySettings exactly as the modal wrote them: each group lays its patch
   over the settings as last saved and sends the lot. A typed figure goes
   through its group's Edit and Save changes, so a half-typed rule never
   applies; the three rules you only pick (the lock, the certificate, the
   export's breakdown) save themselves with a toast and Undo.

   THE FIRST RUN. The modal walked a new workspace through seven steps before
   anything was its own, though the defaults already applied. Here every rule
   is on the page at once, so the walk is the page: until a rule is saved the
   title says the rules aren't confirmed, and its one button saves them as
   they stand. */

type SavePay = (settings: Settings) => Promise<SaveResult>;

export type PayScreenProps = {
  /** present only with `financials` */
  pay: { settings: Settings; configured: boolean; onSave: SavePay } | null;
  /** present only for an admin; `initial` is the calendar as the page read it */
  holidays: { initial: HolidayManagerData | null } | null;
  /** present only with `financials` and a live Xero grant */
  xero: XeroPayrollProps | null;
};

export function PayScreen({ pay, holidays, xero }: PayScreenProps) {
  return (
    <>
      {pay ? <PayRules {...pay} /> : <SectionTitle>Pay and holidays</SectionTitle>}
      {holidays && (
        <Group heading="Public holidays" anchor="holidays">
          <HolidaySection initial={holidays.initial} />
        </Group>
      )}
      {xero && (
        <Group heading="Xero payroll" anchor="xero-payroll">
          {/* payroll matching keeps its own dress, scoped under Time & Pay's
              root as it was inside the modal, until its own board is drawn */}
          <div className="tpr">
            <XeroPayroll {...xero} />
          </div>
        </Group>
      )}
    </>
  );
}

/* ---- saving ---- */

type Write = (patch: Partial<Settings>) => Promise<SaveResult>;

/* The settings as last saved: the page's, until a save lands, then that save.
   A ref, so an Undo pressed after another rule has saved lays its one field
   over the newer settings rather than the ones its toast was raised on. */
function usePayWrite(settings: Settings, onSave: SavePay): Write {
  const latest = useRef(settings);
  useEffect(() => {
    latest.current = settings;
  }, [settings]);
  return async (patch) => {
    const next = { ...latest.current, ...patch };
    const res = await onSave(next);
    if (res.ok) latest.current = next;
    return res;
  };
}

const FAILED: SaveResult = { ok: false, error: "Couldn't save that. Check your connection and try again." };

/** A group's check, before anything leaves the browser. */
const checkWith =
  (parse: (f: R.Fields) => R.Parsed) =>
  (fields: R.Fields): PreValidation | null => {
    const p = parse(fields);
    return p.ok ? null : { error: p.error, fields: p.fields };
  };

/** A group's save: its fields as a patch over the saved settings. */
const saveWith =
  (write: Write, parse: (f: R.Fields) => R.Parsed) =>
  async (fields: R.Fields): Promise<SaveResult> => {
    const p = parse(fields);
    return p.ok ? write(p.patch) : { ok: false, error: p.error, fields: p.fields };
  };

function PayRules({ settings, configured, onSave }: { settings: Settings; configured: boolean; onSave: SavePay }) {
  const write = usePayWrite(settings, onSave);
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setError(null);
    setConfirming(true);
    const res = await write({}).catch(() => FAILED);
    setConfirming(false);
    if (res.ok) toast({ text: "Pay rules confirmed" });
    else setError(res.error);
  };

  return (
    <>
      <SectionTitle
        tools={
          configured ? undefined : (
            <span className="st2-pay-confirm">
              <StateWord tone="look">Not confirmed</StateWord>
              <Button kind="main" disabled={confirming} onClick={() => void confirm()}>
                {confirming ? "Confirming the pay rules" : "Confirm pay rules"}
              </Button>
            </span>
          )
        }
      >
        Pay and holidays
      </SectionTitle>
      {error && <Wrong>{error}</Wrong>}
      <CycleGroup settings={settings} write={write} />
      <HoursGroup settings={settings} write={write} />
      <OvertimeGroup settings={settings} write={write} />
      <RatesGroup settings={settings} write={write} />
      <SuperGroup settings={settings} write={write} />
      <TimesheetsGroup settings={settings} write={write} />
    </>
  );
}

type GroupProps = { settings: Settings; write: Write };

/* ---- the pay cycle ---- */

const CYCLE_OPTIONS: readonly TrayOption<(typeof R.CYCLES)[number]>[] = R.CYCLES.map((c) => ({ value: c, label: c }));
const DAY_OPTIONS: ChooserOption[] = R.DAY_KEYS.map((d) => ({ value: d, label: R.dayName(d) }));
const MONTH_DAYS: ChooserOption[] = Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `The ${R.ordinal(i + 1)}` }));

/* How often pay runs, where its period begins, and the moment each period's
   open timesheets submit themselves. A fortnight has no natural start, so
   the business names one; a month can run from any day up to the 28th. */
function CycleGroup({ settings: s, write }: GroupProps) {
  const anchorId = useId();
  const parse = R.parseCycle;
  return (
    <EditGroup
      heading="Pay cycle"
      values={R.cycleValues(s)}
      validate={checkWith(parse)}
      onSave={saveWith(write, parse)}
      read={
        <Facts
          rows={[
            { label: "Pay cycle", value: s.cycle },
            ...(s.cycle === "Fortnightly" ? [{ label: "First fortnight starts", value: fmtAuWeekdayDate(s.fortnightAnchor) }] : []),
            ...(s.cycle === "Monthly" ? [{ label: "Pay month starts on", value: `The ${R.ordinal(s.monthStartDay)}` }] : []),
            { label: "Week starts on", value: R.dayName(s.weekStart) },
            { label: "Auto-submit", value: `${R.dayName(s.submitDay)} at ${s.submitTime}` },
          ]}
        />
      }
      edit={({ draft, set }) => (
        <>
          <div className="st2-fields">
            <Field label="Pay cycle">
              <Tray ariaLabel="Pay cycle" options={CYCLE_OPTIONS} value={draft.cycle as (typeof R.CYCLES)[number]} onChange={(v) => set("cycle", v)} />
            </Field>
            {draft.cycle === "Fortnightly" && (
              <Field label="First fortnight starts" id={anchorId}>
                <DateField
                  id={anchorId}
                  className="st2-pay-date"
                  clearable
                  value={draft.fortnightAnchor || null}
                  onChange={(iso) => set("fortnightAnchor", iso ?? "")}
                />
              </Field>
            )}
            {draft.cycle === "Monthly" && (
              <Field label="Pay month starts on">
                <Chooser options={MONTH_DAYS} value={draft.monthStartDay} onChange={(v) => set("monthStartDay", v)} />
              </Field>
            )}
          </div>
          <div className="st2-fields st2-fields--three">
            <Field label="Week starts on">
              <Chooser options={DAY_OPTIONS} value={draft.weekStart} onChange={(v) => set("weekStart", v)} />
            </Field>
            <Field label="Auto-submit day">
              <Chooser options={DAY_OPTIONS} value={draft.submitDay} onChange={(v) => set("submitDay", v)} />
            </Field>
            <Field label="Auto-submit time">
              <TimeField value={draft.submitTime} onChange={(v) => set("submitTime", v)} />
            </Field>
          </div>
        </>
      )}
    />
  );
}

/* ---- the ordinary day ---- */

const PAID: readonly TrayOption<"Yes" | "No">[] = [
  { value: "Yes", label: "Paid" },
  { value: "No", label: "Unpaid" },
];

/* The day the whole timesheet leans on: every working day is presumed worked
   at these hours once it's over, so a business that sets them once has staff
   who never enter an ordinary day again. Someone whose day differs sets their
   own from their timesheet; casuals are never presumed. The standard day is
   the length a day is measured against; the break, how long it is first,
   then whether it's paid, since the second question means nothing until the
   first has an answer. */
function HoursGroup({ settings: s, write }: GroupProps) {
  const parse = R.parseHours;
  return (
    <EditGroup
      heading="Ordinary hours"
      values={R.hoursValues(s)}
      validate={checkWith(parse)}
      onSave={saveWith(write, parse)}
      read={
        <Facts
          rows={[
            { label: "Standard day", value: fmtHval(s.standard) },
            { label: "Normal hours", value: `${s.defaultStart} to ${s.defaultEnd}` },
            { label: "Working days", value: R.daysWord(s.workDays) },
            { label: "Break", value: R.breakWord(s) },
          ]}
        />
      }
      edit={({ draft, set, invalid }) => {
        const days = R.daysOf(draft.workDays);
        const flip = (i: number, on: boolean) =>
          set("workDays", (on ? [...days, i] : days.filter((d) => d !== i)).sort((a, b) => a - b).join(","));
        return (
          <>
            <div className="st2-fields st2-fields--three">
              <Field label="Standard day, in hours" error={invalid("standard") ? R.between(R.LIMITS.standard, "hours") : null}>
                <TextInput name="standard" inputMode="decimal" value={draft.standard} onChange={(e) => set("standard", e.target.value)} />
              </Field>
              <Field label="Normal start">
                <TimeField value={draft.defaultStart} onChange={(v) => set("defaultStart", v)} />
              </Field>
              <Field label="Normal finish">
                <TimeField value={draft.defaultEnd} onChange={(v) => set("defaultEnd", v)} />
              </Field>
            </div>
            <fieldset className="st2-pay-days">
              <legend className="pt-field-label">Working days</legend>
              <div className="st2-pay-ticks">
                {R.DAY_NAMES.map((day, i) => (
                  <Tick key={day} label={day} checked={days.includes(i)} onChange={(on) => flip(i, on)} />
                ))}
              </div>
            </fieldset>
            <div className="st2-fields">
              <Field label="Break, in minutes" error={invalid("breakMinutes") ? R.between(R.LIMITS.breakMinutes, "minutes") : null}>
                <TextInput name="breakMinutes" inputMode="numeric" value={draft.breakMinutes} onChange={(e) => set("breakMinutes", e.target.value)} />
              </Field>
              {Number(draft.breakMinutes) > 0 && (
                <Field label="The break is">
                  <Tray ariaLabel="The break is" options={PAID} value={draft.breakPaid as "Yes" | "No"} onChange={(v) => set("breakPaid", v)} />
                </Field>
              )}
            </div>
          </>
        );
      }}
    />
  );
}

/* ---- overtime ---- */

const OVER: readonly TrayOption<"day" | "week">[] = [
  { value: "day", label: "A day" },
  { value: "week", label: "A week" },
];
const SALARIED: readonly TrayOption<"Yes" | "No">[] = [
  { value: "Yes", label: "Pays at the rules" },
  { value: "No", label: "Absorbed in salary" },
];

/* THE WHOLE LADDER, IN ONE PLACE: both rungs count an ordinary weekday. A
   Saturday, Sunday or public holiday takes its own rate for the whole day and
   never reaches this ladder, so its rules are the next group's. A salaried
   person's overtime is recorded either way; this decides whether it pays. */
function OvertimeGroup({ settings: s, write }: GroupProps) {
  const parse = R.parseOvertime;
  return (
    <EditGroup
      heading="Overtime"
      values={R.overtimeValues(s)}
      validate={checkWith(parse)}
      onSave={saveWith(write, parse)}
      read={
        <Facts
          rows={[
            { label: "Time and a half", value: R.overtimeWord(s) },
            { label: "Double time", value: R.doubleWord(s) },
            { label: "Salaried overtime", value: R.salariedWord(s) },
          ]}
        />
      }
      edit={({ draft, set, setMany, invalid }) => (
        <>
          <div className="st2-fields">
            <Field label="Time and a half after, in hours" error={invalid("otAfter") ? R.between(R.otLimits(draft.otUnit), "hours") : null}>
              <TextInput name="otAfter" inputMode="decimal" value={draft.otAfter} onChange={(e) => set("otAfter", e.target.value)} />
            </Field>
            <Field label="Counted over">
              {/* a week's threshold and a day's are different numbers, so a
                  change of unit starts from that unit's usual one */}
              <Tray
                ariaLabel="Counted over"
                options={OVER}
                value={draft.otUnit as "day" | "week"}
                onChange={(u) => setMany({ otUnit: u, otAfter: u === "week" ? "38" : "8" })}
              />
            </Field>
          </div>
          <div className="st2-fields">
            <Field label="Double time after, in hours" error={invalid("dblAfter") ? R.between(R.LIMITS.dblAfter, "hours") : null}>
              <TextInput name="dblAfter" inputMode="decimal" value={draft.dblAfter} onChange={(e) => set("dblAfter", e.target.value)} />
            </Field>
            <Field label="Salaried overtime">
              <Tray ariaLabel="Salaried overtime" options={SALARIED} value={draft.salariedOtPaid as "Yes" | "No"} onChange={(v) => set("salariedOtPaid", v)} />
            </Field>
          </div>
        </>
      )}
    />
  );
}

/* ---- the days with their own rate ---- */

/* Each day is one of three: standard rates, time and a half for its first
   hours then double, or double all day. Only time and a half has a second
   question, how many hours before it doubles. */
function RatesGroup({ settings: s, write }: GroupProps) {
  const parse = (f: R.Fields) => R.parseRates(f, s);
  return (
    <EditGroup
      heading="Weekend and holiday rates"
      values={R.ratesValues(s)}
      validate={checkWith(parse)}
      onSave={saveWith(write, parse)}
      read={<Facts rows={R.RULES.map(({ key, name }) => ({ label: name, value: R.ruleWord(s.rules[key]) }))} />}
      edit={({ draft, set, invalid }) => (
        <>
          {R.RULES.map(({ key, name }) => (
            <div className="st2-fields" key={key}>
              <Field label={name}>
                <Tray ariaLabel={name} options={R.RULE_CHOICES} value={draft[key] as R.RuleChoice} onChange={(v) => set(key, v)} />
              </Field>
              {draft[key] === "1.5" && (
                <Field label="2× after, in hours" error={invalid(`${key}Up`) ? R.between(R.LIMITS.up, "hours") : null}>
                  <TextInput
                    name={`${key}Up`}
                    aria-label={`${name}, 2× after, in hours`}
                    inputMode="decimal"
                    value={draft[`${key}Up`]}
                    onChange={(e) => set(`${key}Up`, e.target.value)}
                  />
                </Field>
              )}
            </div>
          ))}
        </>
      )}
    />
  );
}

/* ---- super ---- */

/* The business's super guarantee. Set HERE and only here: My Pay shows it to
   every staff member and the Rate Calculator prices from it. Blank is the
   statutory figure, which both fall back to themselves. */
function SuperGroup({ settings: s, write }: GroupProps) {
  const parse = R.parseSuper;
  return (
    <EditGroup
      heading="Super"
      values={R.superValues(s)}
      validate={checkWith(parse)}
      onSave={saveWith(write, parse)}
      read={<Facts rows={[{ label: "Super guarantee", value: R.superWord(s) }]} />}
      edit={({ draft, set, invalid }) => (
        <div className="st2-fields">
          <Field label="Super guarantee, %" error={invalid("superPct") ? R.between(R.LIMITS.superPct, "per cent") : null}>
            <TextInput
              name="superPct"
              inputMode="decimal"
              placeholder={`${R.SUPER_DEFAULT}, the default`}
              value={draft.superPct}
              onChange={(e) => set("superPct", e.target.value)}
            />
          </Field>
        </div>
      )}
    />
  );
}

/* ---- the rules you only pick ---- */

const CERT_OPTIONS: ChooserOption[] = [
  { value: "0", label: R.certWord(null) },
  ...R.CERT_DAYS.map((d) => ({ value: String(d), label: R.certWord(d) })),
];

/* Each saves the moment it's picked.

   The lock: with it on, a submitted timesheet can't be touched by the person
   who sent it, and only sending it back reopens it. The certificate is a
   prompt, never a gate: personal leave this long asks for one on the request
   and tells the approver whether it came, counted in working days, the count
   the request form prints. The pay-run export isn't built, so its breakdown
   is a preference kept for the first one, and the row says so. */
function TimesheetsGroup({ settings: s, write }: GroupProps) {
  const { write: pick, error, pending } = useSelfSave((fields) => write(R.selfPatch(fields)));
  const yes = (on: boolean) => (on ? "Yes" : "No");
  const cert = s.certAfterDays == null ? "0" : String(s.certAfterDays);
  return (
    <Group heading="Timesheets and leave">
      <Setting name="Lock a timesheet once it's submitted">
        <Switch
          label={<span className="sr-only">Lock a timesheet once it&apos;s submitted</span>}
          checked={s.lock}
          disabled={pending === "lock"}
          onChange={(on) => void pick("lock", yes(on), yes(s.lock), on ? "Timesheets lock once submitted" : "Submitted timesheets stay open")}
        />
      </Setting>
      <Setting name="Medical certificate for personal leave">
        <Chooser
          className="st2-choose"
          aria-label="Medical certificate for personal leave"
          options={CERT_OPTIONS}
          value={cert}
          disabled={pending === "certAfterDays"}
          onChange={(v) => {
            const days = Number(v);
            void pick("certAfterDays", v, cert, days > 0 ? `Certificate asked ${R.certWord(days).replace(/^From/, "from")}` : "Certificate never asked for");
          }}
        />
      </Setting>
      <Setting name="Daily breakdown in the pay-run export" line={<StateWord tone="info">Export not built yet</StateWord>}>
        <Switch
          label={<span className="sr-only">Daily breakdown in the pay-run export</span>}
          checked={s.exportDetail}
          disabled={pending === "exportDetail"}
          onChange={(on) => void pick("exportDetail", yes(on), yes(s.exportDetail), on ? "Daily breakdown on" : "Daily breakdown off")}
        />
      </Setting>
      {error && <Wrong>{error}</Wrong>}
    </Group>
  );
}
