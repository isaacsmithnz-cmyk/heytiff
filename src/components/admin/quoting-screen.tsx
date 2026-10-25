"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { Chooser, type ChooserOption } from "@/components/parts/chooser";
import { TextInput } from "@/components/parts/field";
import { Tick } from "@/components/parts/tick";
import { useToast } from "@/components/parts/toast";
import { Group, SectionTitle, Setting, Wrong } from "@/components/settings/parts";
import { saveQuoteSettings } from "@/app/actions/quote-settings";
import { profitSharePct } from "@/lib/quotes/components";
import {
  ALLOWANCES,
  ALLOWANCE_KEYS,
  MAX_ALLOWANCE_CENTS,
  MAX_CHARGE_OUT_CENTS,
  MAX_CONTINGENCY_HOURS,
  MAX_CONTINGENCY_PCT,
  MAX_DAY_HOURS,
  MAX_MARKUP_PCT,
  MAX_PROFIT_TARGET_PCT,
  MAX_STARTERS,
  MAX_STARTER_NAME,
  MAX_TASK_HOURS,
  STARTER_WHEN,
  STARTER_WHENS,
  TASK_KEYS,
  TASKS,
  USUAL_LAYOUT_WORDS,
  type AllowanceKey,
  type QuoteSettings,
  type StarterTask,
  type StarterWhen,
  type TaskKey,
} from "@/lib/quotes/settings";
import { orgDayOf, type CalcDay } from "@/lib/quotes/org-day";
import { hourCostOf } from "@/lib/quotes/profit";
import { withCleanup } from "@/lib/ui/with-cleanup";
import "@/components/settings/quoting.css";

/* SETTINGS › QUOTING (v2, 25 October 2026; the mock's Quoting board). What
   a quote is priced by, as the business's own figures: the rate and the
   markup, the allowances a kit carries at cost, the hours it checks a
   quote's labour against, what every job starts with, and the two answers
   about what a quote shows. What prices each part (the preferred items, the
   ranges that come in sizes, the kits) is the Price book's now.

   THE RATE AND THE DAY: the charge-out rate and the working day, set here
   so a business can quote before it has finished its Rate Calculator
   (Isaac, 2026-10-04). Left blank, each is the Rate Calculator's: the field
   shows its figure in grey, and the line under the rates says where it
   came from. A day on site is the one times the other, never a figure of
   ours (org-day.ts).

   THE PROFIT TARGET: the share of a price the business means to keep. A
   quote under it says so; nothing changes a price (Isaac, 2026-10-07). An
   hour's cost is the rate less the target unless typed (profit.ts).

   THE MARKUP says its profit share under its name, because 20% markup is
   16.7% of the sell price and the two get confused otherwise.

   Typed figures are a group with its own save; a choice saves the moment
   it's picked (rule 32). Either says so in a toast with Undo (rule 51),
   and what went wrong under its own group (rule 42). */

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const $ = (cents: number) => money.format(cents / 100);

/** A setting as its field shows it: blank when the business hasn't set one. */
const field = (n: number | null) => (n == null ? "" : String(n));
const numOrNone = (s: string) => (s.trim() === "" ? null : Number(s));
const bare = (s: string) => s.replace(/[$,\s]/g, "");
/** dollars as typed to cents, blank as not set */
const centsOrNone = (s: string) => (s.trim() === "" ? null : Math.round(Number(bare(s)) * 100));
const dollarsField = (cents: number | null) => (cents == null ? "" : String(cents / 100));
/** a figure in a field's grey, where the field is blank: "140.00" */
const placeDollars = (cents: number) => (cents / 100).toFixed(2);
/** blank, or a number from lo to hi */
const inRange = (s: string, lo: number, hi: number) => s.trim() === "" || (Number.isFinite(Number(s)) && Number(s) >= lo && Number(s) <= hi);

type Save = (group: string, next: QuoteSettings, said: string) => Promise<boolean>;

export function QuotingScreen({
  initial,
  calc,
}: {
  initial: QuoteSettings;
  /** what the business's Rate Calculator says, when it has one */
  calc: CalcDay | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [wrong, setWrong] = useState<{ group: string; text: string } | null>(null);

  /* every save writes the whole of the settings, so each group's save is
     the saved settings with its own part changed; Undo writes back what was
     there before */
  const write = (group: string, next: QuoteSettings) => {
    setPending(group);
    setWrong(null);
    return withCleanup(async () => {
      try {
        const res = await saveQuoteSettings(next);
        if (!res.ok) {
          setWrong({ group, text: res.reason });
          return false;
        }
        setSaved(res.settings);
        router.refresh();
        return true;
      } catch {
        setWrong({ group, text: "Couldn't save that. Check your connection and try again." });
        return false;
      }
    }, () => setPending(null));
  };

  const save: Save = async (group, next, said) => {
    const was = saved;
    const ok = await write(group, next);
    if (ok) toast({ text: said, undo: () => void write(group, was) });
    return ok;
  };

  const errorAt = (group: string) => (wrong?.group === group ? wrong.text : null);
  const busy = pending !== null;

  return (
    <>
      <SectionTitle>Quoting</SectionTitle>
      <RatesGroup
        key={JSON.stringify([saved.chargeOutCents, saved.dayHours, saved.unitMarkupPct, saved.materialMarkupPct, saved.contingencyPct, saved.contingencyHours, saved.profitTargetPct, saved.labourCostCents])}
        saved={saved}
        calc={calc}
        busy={busy}
        saving={pending === "rates"}
        error={errorAt("rates")}
        onSave={save}
      />
      <AllowancesGroup key={JSON.stringify(saved.allowances)} saved={saved} busy={busy} saving={pending === "allowances"} error={errorAt("allowances")} onSave={save} />
      <TaskHoursGroup key={JSON.stringify(saved.taskHours)} saved={saved} busy={busy} saving={pending === "tasks"} error={errorAt("tasks")} onSave={save} />
      <StartersGroup key={JSON.stringify(saved.starterTasks)} saved={saved} busy={busy} saving={pending === "starters"} error={errorAt("starters")} onSave={save} />
      <LayoutGroup saved={saved} busy={busy} error={errorAt("layout")} onSave={save} />
      <CustomerGroup saved={saved} busy={busy} error={errorAt("customer")} onSave={save} />
    </>
  );
}

/** A figure typed beside its unit, its name on the left (the mock's row). */
function Amount({
  id,
  name,
  line,
  unit,
  value,
  onChange,
  placeholder = "Not set",
  invalid,
  disabled,
  tail,
}: {
  id: string;
  name: string;
  /** a fact about the figure, under its name */
  line?: ReactNode;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  /** what sits beside the figure; a group with one keeps its seat in every
      row, so null holds the seat empty and leaving it out has none */
  tail?: ReactNode;
}) {
  return (
    <div className="st2-set">
      <div className="st2-setw">
        <label className="st2-sett" htmlFor={id}>
          {name}
        </label>
        {line != null && <span className="st2-sets">{line}</span>}
      </div>
      <span className="st2-q-amt">
        <TextInput id={id} inputMode="decimal" value={value} placeholder={placeholder} invalid={invalid} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        <span className="st2-q-unit">{unit}</span>
      </span>
      {tail !== undefined && <span className="st2-q-tail">{tail}</span>}
    </div>
  );
}

/** The markup's profit share, said under its name once there's a figure. */
const shareLine = (typed: string) => {
  const n = Number(typed);
  return typed.trim() !== "" && Number.isFinite(n) && n >= 0 ? `${profitSharePct(n)}% of the price is profit` : undefined;
};

type GroupProps = { saved: QuoteSettings; busy: boolean; saving: boolean; error: string | null; onSave: Save };

/* RATE AND MARKUP: the mock's group, with the two figures it didn't draw
   that a quote also uses (the duct contingency's hours, and what an hour
   costs when it isn't the rate less the target). Save rates is the
   section's one main button. */
function RatesGroup({ saved, calc, busy, saving, error, onSave }: GroupProps & { calc: CalcDay | null }) {
  const [rate, setRate] = useState(dollarsField(saved.chargeOutCents));
  const [hours, setHours] = useState(field(saved.dayHours));
  const [unit, setUnit] = useState(field(saved.unitMarkupPct));
  const [material, setMaterial] = useState(field(saved.materialMarkupPct));
  const [contPct, setContPct] = useState(field(saved.contingencyPct));
  const [contHours, setContHours] = useState(field(saved.contingencyHours));
  const [target, setTarget] = useState(field(saved.profitTargetPct));
  const [hourCost, setHourCost] = useState(dollarsField(saved.labourCostCents));

  const typed = {
    unitMarkupPct: numOrNone(unit),
    materialMarkupPct: numOrNone(material),
    chargeOutCents: centsOrNone(rate),
    dayHours: numOrNone(hours),
    contingencyPct: numOrNone(contPct),
    contingencyHours: numOrNone(contHours),
    profitTargetPct: numOrNone(target),
    labourCostCents: centsOrNone(hourCost),
  };
  const changed = (Object.keys(typed) as (keyof typeof typed)[]).some((k) => typed[k] !== saved[k]);

  /* each figure's bounds, and what to say when one is past them */
  const checks: { key: string; ok: boolean; why: string }[] = [
    { key: "rate", ok: inRange(bare(rate), 0.01, MAX_CHARGE_OUT_CENTS / 100), why: `A charge-out rate is more than $0 and at most ${$(MAX_CHARGE_OUT_CENTS)} an hour.` },
    { key: "hours", ok: inRange(hours, 1, MAX_DAY_HOURS), why: `A working day is 1 to ${MAX_DAY_HOURS} hours.` },
    { key: "unit", ok: inRange(unit, 0, MAX_MARKUP_PCT), why: `A markup is 0 to ${MAX_MARKUP_PCT}%.` },
    { key: "material", ok: inRange(material, 0, MAX_MARKUP_PCT), why: `A markup is 0 to ${MAX_MARKUP_PCT}%.` },
    { key: "contPct", ok: inRange(contPct, 0, MAX_CONTINGENCY_PCT), why: `A duct contingency is 0 to ${MAX_CONTINGENCY_PCT}% of the ductwork.` },
    { key: "contHours", ok: inRange(contHours, 0, MAX_CONTINGENCY_HOURS), why: `Contingency hours are 0 to ${MAX_CONTINGENCY_HOURS}.` },
    { key: "target", ok: inRange(target, 0, MAX_PROFIT_TARGET_PCT), why: `A profit target is 0 to ${MAX_PROFIT_TARGET_PCT}% of the price.` },
    { key: "hourCost", ok: inRange(bare(hourCost), 0.01, MAX_CHARGE_OUT_CENTS / 100), why: `A labour cost is more than $0 and at most ${$(MAX_CHARGE_OUT_CENTS)} an hour.` },
  ];
  const bad = (key: string) => checks.find((c) => c.key === key)?.ok === false;
  const valid = checks.every((c) => c.ok);
  const firstWrong = checks.find((c) => !c.ok)?.why ?? null;

  /* what a quote will use, as typed: this page's figure, else the Rate Calculator's */
  const shown = valid ? typed : saved;
  const day = orgDayOf(shown, calc);
  const fromCalc = orgDayOf({ chargeOutCents: null, dayHours: null }, calc);
  const hourCostCents = day.rate ? hourCostOf(day.rate.perHourCents, shown.profitTargetPct, shown.labourCostCents) : shown.labourCostCents;
  /* the labour cost a blank field stands for: the rate less the target */
  const rateLessTarget = day.rate ? hourCostOf(day.rate.perHourCents, shown.profitTargetPct, null) : null;

  /* the facts the figures make, the mock's line: where a blank figure came
     from, then what an hour costs and what a day on site is */
  const borrowed = [
    day.rate && day.rate.from !== "quoting" ? `${$(day.rate.perHourCents)} an hour${day.rate.from === "recommended" ? ", its recommendation" : ""}` : null,
    day.hours && day.hours.from !== "quoting" ? `${day.hours.hours} hours a day` : null,
  ].filter(Boolean);
  const facts = [
    borrowed.length ? `From your Rate Calculator: ${borrowed.join(" and ")}.` : null,
    hourCostCents != null ? `An hour costs you ${$(hourCostCents)}.` : null,
    day.dayCents != null ? `A day on site is ${$(day.dayCents)} a person.` : "A day on site needs a charge-out rate and a working day.",
  ]
    .filter(Boolean)
    .join(" ");

  const off = busy;
  return (
    <Group heading="Rate and markup">
      <Amount
        id="q-rate"
        name="Charge-out rate"
        unit="dollars an hour"
        value={rate}
        onChange={setRate}
        placeholder={fromCalc.rate ? placeDollars(fromCalc.rate.perHourCents) : "Not set"}
        invalid={bad("rate")}
        disabled={off}
        tail={
          <Button kind="second" size={36} href="/dashboard/admin/rate-calculator">
            Work out the rate
          </Button>
        }
      />
      <Amount
        id="q-day"
        name="Working day"
        unit="hours"
        value={hours}
        onChange={setHours}
        placeholder={fromCalc.hours ? String(fromCalc.hours.hours) : "Not set"}
        invalid={bad("hours")}
        disabled={off}
        tail={null}
      />
      <Amount id="q-units" name="Units" line={shareLine(unit)} unit="% markup" value={unit} onChange={setUnit} invalid={bad("unit")} disabled={off} tail={null} />
      <Amount id="q-mats" name="Materials" line={shareLine(material)} unit="% markup" value={material} onChange={setMaterial} invalid={bad("material")} disabled={off} tail={null} />
      <Amount id="q-duct" name="Duct contingency" unit="% of ductwork" value={contPct} onChange={setContPct} invalid={bad("contPct")} disabled={off} tail={null} />
      <Amount id="q-ducth" name="Contingency hours" unit="hours" value={contHours} onChange={setContHours} invalid={bad("contHours")} disabled={off} tail={null} />
      <Amount id="q-target" name="Profit target" unit="% of the price" value={target} onChange={setTarget} invalid={bad("target")} disabled={off} tail={null} />
      <Amount
        id="q-cost"
        name="Labour cost"
        unit="dollars an hour"
        value={hourCost}
        onChange={setHourCost}
        placeholder={rateLessTarget != null ? placeDollars(rateLessTarget) : "Not set"}
        invalid={bad("hourCost")}
        disabled={off}
        tail={null}
      />
      <p className="st2-q-fact">{facts}</p>
      {(firstWrong || error) && <Wrong>{firstWrong ?? error}</Wrong>}
      <div className="st2-q-foot">
        <Button kind="main" size={36} disabled={off || !changed || !valid} onClick={() => void onSave("rates", { ...saved, ...typed }, "Rates saved")}>
          {saving ? "Saving the rates" : "Save rates"}
        </Button>
      </div>
    </Group>
  );
}

/* WHAT A KIT CARRIES THAT ISN'T ONE ITEM, the business's own figure for
   each, at cost: its materials markup goes on top. Blank, a quote's kit
   lists the line and asks for it here (Isaac, 2026-10-04). */
function AllowancesGroup({ saved, busy, saving, error, onSave }: GroupProps) {
  const [typed, setTyped] = useState<Record<AllowanceKey, string>>(
    () => Object.fromEntries(ALLOWANCE_KEYS.map((k) => [k, dollarsField(saved.allowances[k])])) as Record<AllowanceKey, string>
  );
  const next = Object.fromEntries(ALLOWANCE_KEYS.map((k) => [k, centsOrNone(typed[k])])) as QuoteSettings["allowances"];
  const changed = ALLOWANCE_KEYS.some((k) => next[k] !== saved.allowances[k]);
  const okOf = (k: AllowanceKey) => inRange(bare(typed[k]), 0, MAX_ALLOWANCE_CENTS / 100);
  const valid = ALLOWANCE_KEYS.every(okOf);
  return (
    <Group heading="Allowances, at cost">
      {ALLOWANCE_KEYS.map((k) => (
        <Amount
          key={k}
          id={`q-allow-${k}`}
          name={ALLOWANCES[k].label}
          unit={`dollars ${ALLOWANCES[k].per}`}
          value={typed[k]}
          onChange={(v) => setTyped((cur) => ({ ...cur, [k]: v }))}
          invalid={!okOf(k)}
          disabled={busy}
        />
      ))}
      {!valid ? <Wrong>{`An allowance is $0 to ${$(MAX_ALLOWANCE_CENTS)}.`}</Wrong> : error && <Wrong>{error}</Wrong>}
      <div className="st2-q-foot">
        <Button kind="second" size={36} disabled={busy || !changed || !valid} onClick={() => void onSave("allowances", { ...saved, allowances: next }, "Allowances saved")}>
          {saving ? "Saving the allowances" : "Save allowances"}
        </Button>
      </div>
    </Group>
  );
}

/** THE BUSINESS'S OWN TASK HOURS (slice 8.1): a check beside each quote's
    labour, never a price. Empty until it sets them. */
function TaskHoursGroup({ saved, busy, saving, error, onSave }: GroupProps) {
  const [typed, setTyped] = useState<Record<TaskKey, string>>(() => Object.fromEntries(TASK_KEYS.map((k) => [k, field(saved.taskHours[k])])) as Record<TaskKey, string>);
  const next = Object.fromEntries(TASK_KEYS.map((k) => [k, numOrNone(typed[k])])) as QuoteSettings["taskHours"];
  const changed = TASK_KEYS.some((k) => next[k] !== saved.taskHours[k]);
  const okOf = (k: TaskKey) => inRange(typed[k], 0.01, MAX_TASK_HOURS);
  const valid = TASK_KEYS.every(okOf);
  return (
    <Group heading="Task hours">
      {TASK_KEYS.map((k) => (
        <Amount
          key={k}
          id={`q-task-${k}`}
          name={TASKS[k].label}
          unit={`hours ${TASKS[k].per}`}
          value={typed[k]}
          onChange={(v) => setTyped((cur) => ({ ...cur, [k]: v }))}
          invalid={!okOf(k)}
          disabled={busy}
        />
      ))}
      {!valid ? <Wrong>{`A task is more than 0 and at most ${MAX_TASK_HOURS} hours.`}</Wrong> : error && <Wrong>{error}</Wrong>}
      <div className="st2-q-foot">
        <Button kind="second" size={36} disabled={busy || !changed || !valid} onClick={() => void onSave("tasks", { ...saved, taskHours: next }, "Task hours saved")}>
          {saving ? "Saving the task hours" : "Save task hours"}
        </Button>
      </div>
    </Group>
  );
}

const WHEN_OPTIONS: ChooserOption[] = STARTER_WHENS.map((w) => ({ value: w, label: STARTER_WHEN[w] }));

/** WHAT EVERY JOB STARTS WITH (Isaac, 2026-10-10: "the tasks can be
    auto-populated for basic things, so protection, check site for damages
    that we could be blamed for"): the business's own list, on each new
    job's visits around the quote's tasks. A list of records, so its Add is
    on the group's head; the list is saved together. */
function StartersGroup({ saved, busy, saving, error, onSave }: GroupProps) {
  const [rows, setRows] = useState<StarterTask[]>(saved.starterTasks);
  const next = rows.map((r) => ({ ...r, name: r.name.replace(/\s+/g, " ").trim() })).filter((r) => r.name);
  const changed = JSON.stringify(next) !== JSON.stringify(saved.starterTasks);
  const set = (i: number, patch: Partial<StarterTask>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const nameOf = (r: StarterTask, i: number) => r.name || `starter task ${i + 1}`;
  return (
    <Group
      heading="Every job starts with"
      tools={
        <Button kind="second" size={32} disabled={busy || rows.length >= MAX_STARTERS} onClick={() => setRows((cur) => [...cur, { name: "", when: "every", photos: false }])}>
          Add a task
        </Button>
      }
    >
      <ul className="st2-q-tasks" aria-label="Every job starts with">
        {rows.map((r, i) => (
          <li key={i} className="st2-q-task">
            <TextInput value={r.name} maxLength={MAX_STARTER_NAME} disabled={busy} aria-label={`Starter task ${i + 1}`} placeholder="What's done" onChange={(e) => set(i, { name: e.target.value })} />
            <Chooser
              aria-label={`When ${nameOf(r, i)} is done`}
              options={WHEN_OPTIONS}
              value={r.when}
              disabled={busy}
              onChange={(v) => set(i, { when: v as StarterWhen })}
            />
            <Tick label="Done with photos" checked={r.photos} disabled={busy} onChange={(on) => set(i, { photos: on })} />
            <Button kind="quiet" size={32} aria-label={`Take ${nameOf(r, i)} off`} disabled={busy} onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      {error && <Wrong>{error}</Wrong>}
      <div className="st2-q-foot">
        <Button kind="second" size={36} disabled={busy || !changed} onClick={() => void onSave("starters", { ...saved, starterTasks: next }, "Starter tasks saved")}>
          {saving ? "Saving the starter tasks" : "Save starter tasks"}
        </Button>
      </div>
    </Group>
  );
}

const LAYOUT_OPTIONS: ChooserOption[] = [
  { value: "ask", label: "Ask on each job" },
  ...(["trunks", "plenum"] as const).map((k) => ({ value: k, label: USUAL_LAYOUT_WORDS[k] })),
];

/* HOW THE BUSINESS USUALLY RUNS DUCTWORK, for a brief that doesn't say.
   Saves on pick. */
function LayoutGroup({ saved, busy, error, onSave }: Omit<GroupProps, "saving">) {
  return (
    <Group heading="Ductwork, when the brief doesn't say">
      <Setting name="Usual layout">
        <Chooser
          className="st2-q-wide"
          aria-label="Usual layout"
          options={LAYOUT_OPTIONS}
          value={saved.usualLayout ?? "ask"}
          disabled={busy}
          onChange={(v) =>
            void onSave(
              "layout",
              { ...saved, usualLayout: v === "trunks" || v === "plenum" ? v : null },
              v === "trunks" ? "Usual layout set to trunks" : v === "plenum" ? "Usual layout set to a plenum" : "Ductwork asked on each job"
            )
          }
        />
      </Setting>
      {error && <Wrong>{error}</Wrong>}
    </Group>
  );
}

/* WHAT THE CUSTOMER SEES. Whether a quote shows its line items unless it
   says otherwise (Isaac, 2026-10-05: "show line items to customer or leave
   it off by default so that they just see the total price"), and who may
   ask Tiff for a rough price on site (Isaac, 2026-10-21: "staff members
   could potentially give a customer a price if they are asking for
   something while on site"). Each saves on pick. */
function CustomerGroup({ saved, busy, error, onSave }: Omit<GroupProps, "saving">) {
  return (
    <Group heading="What the customer sees">
      <Setting name="On a quote">
        <Chooser
          className="st2-q-wide"
          aria-label="On a quote, unless it says otherwise"
          options={[
            { value: "total", label: "Each option's total" },
            { value: "lines", label: "Each option's line items and its total" },
          ]}
          value={saved.showLines ? "lines" : "total"}
          disabled={busy}
          onChange={(v) => void onSave("customer", { ...saved, showLines: v === "lines" }, v === "lines" ? "Quotes show their line items" : "Quotes show each option's total")}
        />
      </Setting>
      <Setting name="A rough price from Tiff, on site">
        <Chooser
          className="st2-q-wide"
          aria-label="A rough price from Tiff, on site"
          options={[
            { value: "prices", label: "Only for people who see prices" },
            { value: "anyone", label: "For anyone on a job, as a rounded price" },
          ]}
          value={saved.staffRoughPrice ? "anyone" : "prices"}
          disabled={busy}
          onChange={(v) =>
            void onSave("customer", { ...saved, staffRoughPrice: v === "anyone" }, v === "anyone" ? "Anyone on a job can ask for a rough price" : "Rough prices only for people who see prices")
          }
        />
      </Setting>
      {error && <Wrong>{error}</Wrong>}
    </Group>
  );
}
