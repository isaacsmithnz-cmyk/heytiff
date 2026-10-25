"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/parts/button";
import { Chooser, type ChooserOption } from "@/components/parts/chooser";
import { Field, TextInput } from "@/components/parts/field";
import { Empty } from "@/components/parts/states";
import { Switch } from "@/components/parts/tick";
import { useToast } from "@/components/parts/toast";
import type { SaveResult } from "@/components/profile/types";
import { saveAnalyticsSettings, type SaveSettings } from "@/app/actions/analytics-settings";
import { LAPSE_AFTER_DAYS, money, QUOTE_LIKELY_FROM_CENTS, TENDER_AFTER_DAYS } from "@/lib/analytics/job-analytics";
import {
  CATEGORY_ROLES,
  guessRole,
  MAX_AUTO_CLOSE_DAYS,
  MAX_LAPSE_DAYS,
  MAX_QUOTE_FROM_CENTS,
  MIN_LAPSE_DAYS,
  type AnalyticsSettings,
  type CategoryRole,
} from "@/lib/analytics/settings";
import type { PreValidation } from "@/lib/staff/pre-validate";
import { withCleanup } from "@/lib/ui/with-cleanup";
import { EditGroup, Facts, Group, SectionTitle, Setting, Wrong } from "./parts";
import "./reports.css";

/* SETTINGS › REPORTS (v2, 25 October 2026; it was Admin, Analytics). How
   the business's jobs are counted (Isaac, 2026-10-07: "Settings options
   maybe?"; lib/analytics/settings.ts), as a section of the one Settings
   page, in four groups under thin lines:

   COUNTING QUOTES: three typed figures, one Edit. Blank is the default, so
   the read face says what is counted by, set or not.

   WHEN SERVICEM8 CLOSES A QUOTE: picked, and saved on the pick: as found in
   the jobs, after a number of days, or never.

   CATEGORIES: what each ServiceM8 category's jobs are, each picked on its
   own row. A pick keeps every category's role as it reads now, the ones
   read from their names included, as the old Save did.

   BOOKINGS, NOT CUSTOMERS: a switch per client whose cards book someone's
   time (the live account's TAFE NSW). Until the list is saved the ones found
   are left out; once saved, exactly the ones switched on.

   Every pick says so in a toast with Undo (rule 51). Money is the grant,
   as the Reports page's own: every setting moves a figure of job money. */

export type CategoryView = { uuid: string; name: string; jobs: number };
export type ClientView = { id: string; name: string; cards: number | null };

const ROLE_WORDS: Record<CategoryRole, string> = {
  install: "Installs, can be quotes",
  service: "Service calls",
  maintenance: "Maintenance",
  warranty: "Warranty",
  other: "Other work",
  not_job: "Not jobs",
};
const ROLE_OPTIONS: ChooserOption[] = CATEGORY_ROLES.map((r) => ({ value: r, label: ROLE_WORDS[r] }));

const NO_TABLE = "These can’t be kept until the database is updated for them.";
const OFFLINE = "Couldn’t save that. Check your connection and try again.";

const field = (n: number | null) => (n == null ? "" : String(n));
const whole = (s: string) => (s.trim() === "" ? null : Number(s));
const dollars = (cents: number | null) => (cents == null ? "" : String(cents / 100));
const cents = (s: string) => (s.trim() === "" ? null : Math.round(Number(s.replace(/[$,\s]/g, "")) * 100));
const inRange = (n: number | null, lo: number, hi: number) => n === null || (Number.isInteger(n) && n >= lo && n <= hi);
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-AU")} ${n === 1 ? one : many}`;

const asResult = (res: SaveSettings): SaveResult => (res.ok ? { ok: true } : { ok: false, error: res.reason });

/* One row, many writers: each group sends the whole row (the action keeps
   it whole), so each writes its part over what is saved NOW, read from a
   ref rather than a render's closure. An Undo puts back only its own part. */
function useReportSettings(initial: AnalyticsSettings, ready: boolean) {
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const latest = useRef(initial);
  const [error, setError] = useState<{ group: string; text: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const send = async (next: AnalyticsSettings): Promise<SaveSettings> => {
    if (!ready) return { ok: false, reason: NO_TABLE };
    const res = await saveAnalyticsSettings(next);
    if (res.ok) {
      latest.current = res.settings;
      setSaved(res.settings);
    }
    return res;
  };

  const write = async <K extends keyof AnalyticsSettings>(group: string, key: K, value: AnalyticsSettings[K], said: string) => {
    const was = latest.current[key];
    setError(null);
    setPending(group);
    await withCleanup(async () => {
      try {
        const res = await send({ ...latest.current, [key]: value });
        if (!res.ok) {
          setError({ group, text: res.reason });
          return;
        }
        toast({ text: said, undo: () => void send({ ...latest.current, [key]: was }) });
      } catch {
        setError({ group, text: OFFLINE });
      }
    }, () => setPending(null));
  };

  return {
    saved,
    /** what's saved now, for a save made from a typed group */
    now: () => latest.current,
    send,
    write,
    /** what went wrong, for this group only */
    wrong: (group: string) => (error?.group === group ? error.text : null),
    busy: (group: string) => !ready || pending === group,
  };
}

type Settings = ReturnType<typeof useReportSettings>;

export function ReportsSection({
  initial,
  ready,
  connected,
  categories,
  clients,
  closeAge,
}: {
  initial: AnalyticsSettings;
  /** false while the table isn't there yet: choices can't be kept */
  ready: boolean;
  /** ServiceM8 is connected: there are jobs to read categories and clients from */
  connected: boolean;
  categories: CategoryView[];
  /** found in the jobs, and any the business listed */
  clients: ClientView[];
  /** the age ServiceM8 closes quotes at, as found in the jobs */
  closeAge: { days: number; count: number } | null;
}) {
  const s = useReportSettings(initial, ready);
  return (
    <>
      <SectionTitle
        tools={
          <Link href="/dashboard/analytics" className="st2-link">
            View Reports
          </Link>
        }
      >
        Reports
      </SectionTitle>
      {!ready && <Wrong>{NO_TABLE}</Wrong>}
      <CountingGroup s={s} />
      <ClosingGroup s={s} closeAge={closeAge} />
      <CategoriesGroup s={s} categories={categories} connected={connected} />
      <BookingsGroup s={s} clients={clients} />
    </>
  );
}

/* ── counting quotes: typed, one Edit ── */

const countingValues = (v: AnalyticsSettings): Record<string, string> => ({
  lapse: field(v.lapseAfterDays),
  tender: field(v.tenderAfterDays),
  from: dollars(v.quoteFromCents),
});

const DAYS_WRONG = `${MIN_LAPSE_DAYS} to ${MAX_LAPSE_DAYS} days, or blank`;
const FROM_WRONG = `$0 to $${(MAX_QUOTE_FROM_CENTS / 100).toLocaleString("en-AU")}, or blank`;

/** The same ranges the action keeps, answered on the field before it's sent. */
function checkCounting(f: Record<string, string>): PreValidation | null {
  const bad = [
    ...(inRange(whole(f.lapse ?? ""), MIN_LAPSE_DAYS, MAX_LAPSE_DAYS) ? [] : ["lapse"]),
    ...(inRange(whole(f.tender ?? ""), MIN_LAPSE_DAYS, MAX_LAPSE_DAYS) ? [] : ["tender"]),
    ...(inRange(cents(f.from ?? ""), 0, MAX_QUOTE_FROM_CENTS) ? [] : ["from"]),
  ];
  return bad.length ? { error: bad.length === 1 ? "That figure is out of range." : "Those figures are out of range.", fields: bad } : null;
}

function CountingGroup({ s }: { s: Settings }) {
  const v = s.saved;
  return (
    <EditGroup
      heading="Counting quotes"
      values={countingValues(v)}
      validate={checkCounting}
      onSave={async (f) =>
        asResult(await s.send({ ...s.now(), lapseAfterDays: whole(f.lapse), tenderAfterDays: whole(f.tender), quoteFromCents: cents(f.from) }))
      }
      read={
        <Facts
          rows={[
            { label: "Quote lost after", value: plural(v.lapseAfterDays ?? LAPSE_AFTER_DAYS, "day", "days") },
            { label: "Tender lost after", value: plural(v.tenderAfterDays ?? TENDER_AFTER_DAYS, "day", "days") },
            { label: "Ask about work orders from", value: `${money(v.quoteFromCents ?? QUOTE_LIKELY_FROM_CENTS)} ex GST` },
          ]}
        />
      }
      edit={({ draft, set, invalid }) => (
        <div className="st2-fields st2-fields--three">
          <Field label="Quote lost after, in days" error={invalid("lapse") ? DAYS_WRONG : null}>
            <TextInput
              name="lapse"
              inputMode="numeric"
              placeholder={String(LAPSE_AFTER_DAYS)}
              value={draft.lapse}
              onChange={(e) => set("lapse", e.target.value)}
            />
          </Field>
          <Field label="Tender lost after, in days" error={invalid("tender") ? DAYS_WRONG : null}>
            <TextInput
              name="tender"
              inputMode="numeric"
              placeholder={String(TENDER_AFTER_DAYS)}
              value={draft.tender}
              onChange={(e) => set("tender", e.target.value)}
            />
          </Field>
          <Field label="Ask about work orders from, ex GST" error={invalid("from") ? FROM_WRONG : null}>
            <TextInput
              name="from"
              inputMode="decimal"
              placeholder={money(QUOTE_LIKELY_FROM_CENTS)}
              value={draft.from}
              onChange={(e) => set("from", e.target.value)}
            />
          </Field>
        </div>
      )}
    />
  );
}

/* ── when ServiceM8 closes a quote: picked ── */

const CLOSE_DAYS = [14, 21, 30, 45, 60, 90, 120, 180, 365].filter((d) => d <= MAX_AUTO_CLOSE_DAYS);

function ClosingGroup({ s, closeAge }: { s: Settings; closeAge: { days: number; count: number } | null }) {
  const saved = s.saved.autoCloseDays;
  const value = saved === null ? "found" : saved === 0 ? "never" : String(saved);
  /* a number saved before this list existed stays in it */
  const days = saved && !CLOSE_DAYS.includes(saved) ? [...CLOSE_DAYS, saved].sort((a, b) => a - b) : CLOSE_DAYS;
  const options: ChooserOption[] = [
    { value: "found", label: closeAge ? `As found in your jobs: at ${closeAge.days} days` : "As found in your jobs: no age stands out" },
    ...days.map((d) => ({ value: String(d), label: `After ${d} days` })),
    { value: "never", label: "Never" },
  ];
  const said = (v: string) =>
    v === "found" ? "Closing age read from your jobs" : v === "never" ? "ServiceM8 never closes quotes" : `ServiceM8 closes quotes after ${v} days`;
  return (
    <Group heading="When ServiceM8 closes a quote">
      <Setting
        name="ServiceM8 closes them"
        line={
          value === "found" && closeAge
            ? `${plural(closeAge.count, "Unsuccessful quote was", "Unsuccessful quotes were")} closed ${closeAge.days} days to the hour after ${closeAge.count === 1 ? "it" : "they"} became one.`
            : undefined
        }
      >
        <Chooser
          className="st2-rs-choose"
          aria-label="ServiceM8 closes them"
          options={options}
          value={value}
          disabled={s.busy("closing")}
          onChange={(v) => void s.write("closing", "autoCloseDays", v === "found" ? null : v === "never" ? 0 : Number(v), said(v))}
        />
      </Setting>
      {s.wrong("closing") && <Wrong>{s.wrong("closing")}</Wrong>}
    </Group>
  );
}

/* ── categories: a role picked per row ── */

function CategoriesGroup({ s, categories, connected }: { s: Settings; categories: CategoryView[]; connected: boolean }) {
  const roles = s.saved.categoryRoles;
  const roleOf = (c: CategoryView) => roles[c.uuid] ?? guessRole(c.name);
  const pick = (c: CategoryView, role: CategoryRole) => {
    /* every category as it reads now, so a pick keeps the ones read from their names */
    const next = { ...roles, ...Object.fromEntries(categories.map((x) => [x.uuid, roleOf(x)])), [c.uuid]: role };
    void s.write("categories", "categoryRoles", next, `${c.name} saved as ${ROLE_WORDS[role].toLowerCase()}`);
  };
  return (
    <Group heading="Categories">
      {categories.length === 0 ? (
        <Empty
          what="No categories in ServiceM8’s copy yet"
          action={
            connected ? null : (
              <Button kind="second" size={32} href="/dashboard/admin/integrations/servicem8">
                Connect ServiceM8
              </Button>
            )
          }
        />
      ) : (
        categories.map((c) => (
          <Setting
            key={c.uuid}
            name={c.name}
            line={`${plural(c.jobs, "job", "jobs")} in two years${roles[c.uuid] ? "" : ", read from its name"}`}
          >
            <Chooser
              className="st2-rs-choose"
              aria-label={`What ${c.name} jobs are`}
              options={ROLE_OPTIONS}
              value={roleOf(c)}
              disabled={s.busy("categories")}
              onChange={(v) => pick(c, v as CategoryRole)}
            />
          </Setting>
        ))
      )}
      {s.wrong("categories") && <Wrong>{s.wrong("categories")}</Wrong>}
    </Group>
  );
}

/* ── bookings, not customers: a switch per client ── */

function BookingsGroup({ s, clients }: { s: Settings; clients: ClientView[] }) {
  const listed = s.saved.notCustomers;
  /* never saved: the ones found in the jobs are left out */
  const base = listed ?? clients.filter((c) => c.cards !== null).map((c) => c.id);
  const toggle = (c: ClientView, on: boolean) => {
    const next = on ? [...base.filter((id) => id !== c.id), c.id] : base.filter((id) => id !== c.id);
    void s.write("bookings", "notCustomers", next, on ? `${c.name} left out of the figures` : `${c.name} counted again`);
  };
  return (
    <Group heading="Bookings, not customers">
      {clients.length === 0 ? (
        <Empty what="No bookings found in your jobs" action={null} />
      ) : (
        clients.map((c) => (
          <Setting
            key={c.id}
            name={c.name}
            line={c.cards === null ? "Listed by you" : `${plural(c.cards, "card", "cards")} in two years, none quoted, invoiced or paid`}
          >
            <Switch
              label={<span className="sr-only">{`Leave ${c.name} out of the figures`}</span>}
              checked={base.includes(c.id)}
              disabled={s.busy("bookings")}
              onChange={(on) => toggle(c, on)}
            />
          </Setting>
        ))
      )}
      {s.wrong("bookings") && <Wrong>{s.wrong("bookings")}</Wrong>}
    </Group>
  );
}
