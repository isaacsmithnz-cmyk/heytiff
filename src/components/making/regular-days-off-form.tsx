"use client";

import { useContext, useEffect, useState } from "react";
import { Dialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Field, TextInput } from "@/components/parts/field";
import { Tray } from "@/components/parts/tabs";
import { Tick } from "@/components/parts/tick";
import { TimeField } from "@/components/parts/time-field";
import { DateField } from "@/components/ui/date-field";
import { WindowsContext } from "@/components/records/records-context";
import { deleteRegularDayOff, listRegularDaysOff, saveRegularDayOff, type RuleInput } from "@/app/actions/regular-days-off";
import { REASONS, WEEKDAY_NAMES, invalidRule, ruleWords, type RegularDayOff } from "@/lib/team/regular-days-off";

/* REGULAR DAYS OFF (v2, 18 October): a person's TAFE, RDOs and uni, as
   rules. A dialog over the page (rule 51) listing theirs, each with Change
   and Remove, and Add a day off. Saving keeps you where you were, with a
   toast; adding has Undo (it comes off again). */

const OTHER = "Other";

/** "7:05 AM" ↔ "07:05" */
function toHHMM(t: string | null): string | null {
  const m = t ? /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t.trim()) : null;
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}
function fromHHMM(t: string | null): string | null {
  if (!t) return null;
  const h = Number(t.slice(0, 2));
  return `${h % 12 === 0 ? 12 : h % 12}:${t.slice(3, 5)} ${h < 12 ? "AM" : "PM"}`;
}

type Draft = {
  id?: string;
  reason: string;
  other: string;
  weekdays: number[];
  everyWeeks: 1 | 2;
  fromDate: string | null;
  toDate: string | null;
  partDay: boolean;
  partFrom: string | null;
  partTo: string | null;
};

const blank = (today: string): Draft => ({
  reason: "TAFE",
  other: "",
  weekdays: [],
  everyWeeks: 1,
  fromDate: today,
  toDate: null,
  partDay: false,
  partFrom: null,
  partTo: null,
});

function draftOf(r: RegularDayOff): Draft {
  const known = (REASONS as readonly string[]).includes(r.reason);
  return {
    id: r.id,
    reason: known ? r.reason : OTHER,
    other: known ? "" : r.reason,
    weekdays: r.weekdays,
    everyWeeks: r.everyWeeks,
    fromDate: r.fromDate,
    toDate: r.toDate,
    partDay: !!r.partFrom,
    partFrom: fromHHMM(r.partFrom),
    partTo: fromHHMM(r.partTo),
  };
}

function ruleOfDraft(d: Draft): RuleInput {
  return {
    reason: d.reason === OTHER ? d.other.trim() : d.reason,
    weekdays: d.weekdays,
    everyWeeks: d.everyWeeks,
    fromDate: d.fromDate ?? "",
    toDate: d.toDate,
    partFrom: d.partDay ? toHHMM(d.partFrom) : null,
    partTo: d.partDay ? toHHMM(d.partTo) : null,
    skipDates: [],
  };
}

export function RegularDaysOffForm({
  staffProfileId,
  name,
  today,
  onClose,
}: {
  staffProfileId: string;
  name: string;
  /** the business's today, 'YYYY-MM-DD': a new rule starts on it */
  today: string;
  onClose: () => void;
}) {
  const host = useContext(WindowsContext);
  const [rules, setRules] = useState<RegularDayOff[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void listRegularDaysOff(staffProfileId).then((r) => {
      if (!alive) return;
      if (r.ok) setRules(r.rules);
      else setReadError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [staffProfileId]);

  const set = (patch: Partial<Draft>) => {
    setError(null);
    setDraft((d) => (d ? { ...d, ...patch } : d));
  };

  async function save() {
    if (!draft || saving) return;
    const rule = ruleOfDraft(draft);
    const bad = invalidRule(rule);
    if (bad) {
      setError(bad);
      return;
    }
    setSaving(true);
    const r = await saveRegularDayOff({ staffProfileId, id: draft.id, rule });
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const added = !draft.id;
    setRules((cur) => [...(cur ?? []).filter((x) => x.id !== r.rule.id), r.rule]);
    setDraft(null);
    host?.toast(
      added ? `${r.rule.reason} added for ${name}` : `${r.rule.reason} changed`,
      added
        ? async () => {
            const back = await deleteRegularDayOff({ staffProfileId, id: r.rule.id });
            if (back.ok) setRules((cur) => (cur ?? []).filter((x) => x.id !== r.rule.id));
          }
        : undefined,
    );
  }

  async function remove(rule: RegularDayOff) {
    const r = await deleteRegularDayOff({ staffProfileId, id: rule.id });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setRules((cur) => (cur ?? []).filter((x) => x.id !== rule.id));
    host?.toast(`${rule.reason} taken off`);
  }

  const toggleDay = (d: number, on: boolean) =>
    draft && set({ weekdays: on ? [...new Set([...draft.weekdays, d])].sort((a, b) => a - b) : draft.weekdays.filter((x) => x !== d) });

  return (
    <Dialog
      heading={`Regular days off, ${name}`}
      width={560}
      onClose={onClose}
      foot={
        draft ? (
          <>
            <Button kind="second" onClick={() => setDraft(null)}>
              Back
            </Button>
            <Button kind="main" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving" : draft.id ? "Save" : "Add day off"}
            </Button>
          </>
        ) : (
          <>
            <Button kind="second" onClick={onClose}>
              Done
            </Button>
            <Button kind="main" icon="plus" onClick={() => setDraft(blank(today))} disabled={!rules}>
              Add a day off
            </Button>
          </>
        )
      }
    >
      {draft ? (
        <form
          className="mk-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="What it is" error={error}>
            <Tray
              ariaLabel="What it is"
              options={[...REASONS, OTHER].map((r) => ({ value: r, label: r }))}
              value={draft.reason}
              onChange={(v) => set({ reason: v })}
            />
          </Field>
          {draft.reason === OTHER ? (
            <Field label="Called">
              <TextInput value={draft.other} maxLength={40} onChange={(e) => set({ other: e.target.value })} placeholder="Uni, school pick-up" />
            </Field>
          ) : null}
          <Field label="On">
            <div className="mk-rdo-days">
              {WEEKDAY_NAMES.slice(0, 5).map((w, i) => (
                <Tick key={w} label={w} checked={draft.weekdays.includes(i + 1)} onChange={(on) => toggleDay(i + 1, on)} />
              ))}
            </div>
          </Field>
          <Field label="How often">
            <Tray
              ariaLabel="How often"
              options={[
                { value: "1", label: "Every week" },
                { value: "2", label: "Every second week" },
              ]}
              value={String(draft.everyWeeks)}
              onChange={(v) => set({ everyWeeks: v === "2" ? 2 : 1 })}
            />
          </Field>
          <Field label="All day">
            <Tray
              ariaLabel="All day"
              options={[
                { value: "all", label: "All day" },
                { value: "part", label: "Part of it" },
              ]}
              value={draft.partDay ? "part" : "all"}
              onChange={(v) => set({ partDay: v === "part", partFrom: draft.partFrom ?? "12:00 PM", partTo: draft.partTo ?? "3:30 PM" })}
            />
          </Field>
          {draft.partDay ? (
            <div className="mk-pair">
              <Field label="From">
                <TimeField value={draft.partFrom} onChange={(v) => set({ partFrom: v })} step={15} />
              </Field>
              <Field label="To">
                <TimeField value={draft.partTo} onChange={(v) => set({ partTo: v })} step={15} />
              </Field>
            </div>
          ) : null}
          <div className="mk-pair">
            <Field label="Starts">
              <DateField value={draft.fromDate} onChange={(d) => set({ fromDate: d })} today={today} />
            </Field>
            <Field label="Ends">
              <DateField value={draft.toDate} onChange={(d) => set({ toDate: d })} clearable placeholder="No end" today={today} />
            </Field>
          </div>
        </form>
      ) : readError ? (
        <p className="mk-rdo-line">{readError}</p>
      ) : !rules ? (
        <p className="mk-rdo-line">Reading {name}&apos;s days off</p>
      ) : rules.length === 0 ? (
        <p className="mk-rdo-line">{name} has no regular days off.</p>
      ) : (
        <ul className="mk-rdo-list">
          {error ? <li className="mk-rdo-wrong">{error}</li> : null}
          {rules.map((r) => (
            <li key={r.id} className="mk-rdo-row">
              <span className="mk-rdo-text">
                <b>{r.reason}</b>
                <span>
                  {ruleWords(r)}
                  {r.toDate ? `, till ${r.toDate.slice(8, 10)}/${r.toDate.slice(5, 7)}` : ""}
                </span>
              </span>
              <Button kind="quiet" size={32} onClick={() => setDraft(draftOf(r))}>
                Change
              </Button>
              <Button kind="quiet" size={32} onClick={() => void remove(r)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
