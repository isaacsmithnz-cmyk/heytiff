"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import { ScreenBand, ScreenPanel } from "@/components/shell/screen-band";
import { saveAnalyticsSettings } from "@/app/actions/analytics-settings";
import { LAPSE_AFTER_DAYS, QUOTE_LIKELY_FROM_CENTS, TENDER_AFTER_DAYS } from "@/lib/analytics/job-analytics";
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
import "./analytics-settings.css";

/* ANALYTICS — how the business's jobs are counted (Isaac, 2026-10-07:
   "Settings options maybe?"). Four groups, each saved on its own:

   COUNTING QUOTES: the days after which an unanswered Quote is lost, and
   the price from which a work order with no quote sent is asked about.
   Blank is the default, and the field says what that is.

   SERVICEM8 CLOSING QUOTES: the age it closes an unanswered Quote at, as
   found in the jobs, a number of days, or never. A quote closed at it is
   said apart from one a person marked Unsuccessful.

   CATEGORIES: what each ServiceM8 category's jobs are. A category never set
   shows its role read from the name, and says so.

   BOOKINGS, NOT CUSTOMERS: clients whose cards are bookings (the live
   account's TAFE NSW). Until the list is saved, the ones found are left
   out; once saved, exactly the ticked ones are. Work quoted, invoiced or
   paid for one of them always counts. */

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

const field = (n: number | null) => (n == null ? "" : String(n));
const whole = (s: string) => (s.trim() === "" ? null : Number(s));
const dollars = (cents: number | null) => (cents == null ? "" : String(cents / 100));
const cents = (s: string) => (s.trim() === "" ? null : Math.round(Number(s.replace(/[$,\s]/g, "")) * 100));
const inRange = (n: number | null, lo: number, hi: number) => n === null || (Number.isInteger(n) && n >= lo && n <= hi);

export function AnalyticsSettingsScreen({
  initial,
  ready,
  categories,
  clients,
  closeAge,
}: {
  initial: AnalyticsSettings;
  /** false while the table isn't there yet: choices can't be kept */
  ready: boolean;
  categories: CategoryView[];
  /** found in the jobs, and any the business listed */
  clients: ClientView[];
  /** the age ServiceM8 closes quotes at, as found in the jobs */
  closeAge: { days: number; count: number } | null;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const [lapse, setLapse] = useState(field(initial.lapseAfterDays));
  const [tender, setTender] = useState(field(initial.tenderAfterDays));
  const [quoteFrom, setQuoteFrom] = useState(dollars(initial.quoteFromCents));
  const [closeMode, setCloseMode] = useState<"found" | "days" | "never">(
    initial.autoCloseDays === null ? "found" : initial.autoCloseDays === 0 ? "never" : "days",
  );
  const [closeDays, setCloseDays] = useState(initial.autoCloseDays ? String(initial.autoCloseDays) : "");
  const [roles, setRoles] = useState<Record<string, CategoryRole>>(() =>
    Object.fromEntries(categories.map((c) => [c.uuid, initial.categoryRoles[c.uuid] ?? guessRole(c.name)])),
  );
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(initial.notCustomers ?? clients.filter((c) => c.cards !== null).map((c) => c.id)),
  );

  const save = async (next: AnalyticsSettings, done: string) => {
    setBusy(true);
    setNote(null);
    const res = await saveAnalyticsSettings(next);
    setBusy(false);
    if (!res.ok) {
      setNote({ tone: "bad", text: res.reason });
      return;
    }
    setSaved(res.settings);
    setNote({ tone: "ok", text: done });
    router.refresh();
  };

  const typedLapse = whole(lapse);
  const typedTender = whole(tender);
  const typedFrom = cents(quoteFrom);
  const countingValid =
    inRange(typedLapse, MIN_LAPSE_DAYS, MAX_LAPSE_DAYS) && inRange(typedTender, MIN_LAPSE_DAYS, MAX_LAPSE_DAYS) && inRange(typedFrom, 0, MAX_QUOTE_FROM_CENTS);
  const countingChanged =
    typedLapse !== saved.lapseAfterDays || typedTender !== saved.tenderAfterDays || typedFrom !== saved.quoteFromCents;

  const typedClose = closeMode === "found" ? null : closeMode === "never" ? 0 : whole(closeDays);
  const closeValid = closeMode !== "days" || (typedClose !== null && inRange(typedClose, 1, MAX_AUTO_CLOSE_DAYS));
  const closeChanged = typedClose !== saved.autoCloseDays;

  const rolesChanged = categories.some((c) => roles[c.uuid] !== (saved.categoryRoles[c.uuid] ?? guessRole(c.name)));
  const rolesUnsaved = categories.some((c) => !saved.categoryRoles[c.uuid]);

  const listed = [...ticked].sort();
  const clientsChanged = saved.notCustomers === null || listed.join() !== [...saved.notCustomers].sort().join();

  return (
    <div className="page in full">
      <div className="wrap">
        <div className="stg">
          <ScreenBand
            crumb={
              <Link href="/dashboard/admin" className="int-back">
                <Icon name="chevL" size={15} />
                Admin
              </Link>
            }
            title="Analytics"
          />
          <ScreenPanel>
            {note && <div className={`int-note ${note.tone}`}>{note.text}</div>}
            {!ready && <div className="int-note bad">These can&rsquo;t be kept until the database is updated for them.</div>}

            <section className="qs-group">
              <h2 className="qs-h">Counting quotes</h2>
              <div className="qs-fields">
                <label className="qs-field">
                  <span>A quote is lost with no answer after</span>
                  <span className="qs-in">
                    <input
                      className="wb2-fi"
                      inputMode="numeric"
                      value={lapse}
                      placeholder={String(LAPSE_AFTER_DAYS)}
                      disabled={busy}
                      onChange={(e) => setLapse(e.target.value)}
                      aria-label="Days with no answer before a quote counts as lost"
                    />
                    <em>days</em>
                  </span>
                  <em className="qs-share">{`Blank is ${LAPSE_AFTER_DAYS}. ${MIN_LAPSE_DAYS} to ${MAX_LAPSE_DAYS}.`}</em>
                </label>
                <label className="qs-field">
                  <span>A quote kept open as a tender, after</span>
                  <span className="qs-in">
                    <input
                      className="wb2-fi"
                      inputMode="numeric"
                      value={tender}
                      placeholder={String(TENDER_AFTER_DAYS)}
                      disabled={busy}
                      onChange={(e) => setTender(e.target.value)}
                      aria-label="Days with no answer before a quote kept open as a tender counts as lost"
                    />
                    <em>days</em>
                  </span>
                  <em className="qs-share">{`Blank is ${TENDER_AFTER_DAYS}. Keep one open from Analytics, Quotes.`}</em>
                </label>
                <label className="qs-field">
                  <span>Ask if a work order is a quote from</span>
                  <span className="qs-in">
                    <em>$</em>
                    <input
                      className="wb2-fi"
                      inputMode="decimal"
                      value={quoteFrom}
                      placeholder={String(QUOTE_LIKELY_FROM_CENTS / 100)}
                      disabled={busy}
                      onChange={(e) => setQuoteFrom(e.target.value)}
                      aria-label="Dollars ex GST from which a work order with no quote sent is asked about"
                    />
                    <em>ex GST</em>
                  </span>
                  <em className="qs-share">{`Blank is $${(QUOTE_LIKELY_FROM_CENTS / 100).toLocaleString("en-AU")}.`}</em>
                </label>
              </div>
              <div className="wb2-jqacts">
                <button
                  type="button"
                  className="pbtn primary"
                  disabled={busy || !ready || !countingChanged || !countingValid}
                  onClick={() => void save({ ...saved, lapseAfterDays: typedLapse, tenderAfterDays: typedTender, quoteFromCents: typedFrom }, "Saved")}
                >
                  Save
                </button>
              </div>
            </section>

            <section className="qs-group">
              <h2 className="qs-h">When ServiceM8 closes a quote</h2>
              <p className="qs-sub">
                ServiceM8 can make an unanswered Quote Unsuccessful by itself. Those are lost with no answer, and are counted apart from the
                ones a person marked.
              </p>
              <div className="qs-fields">
                <label className="qs-field">
                  <span>ServiceM8 closes them</span>
                  <select
                    className="wb2-sel"
                    value={closeMode}
                    disabled={busy}
                    onChange={(e) => setCloseMode(e.target.value as typeof closeMode)}
                    aria-label="ServiceM8 closes them"
                  >
                    <option value="found">
                      {closeAge ? `As found in your jobs: at ${closeAge.days} days` : "As found in your jobs: no age stands out"}
                    </option>
                    <option value="days">After a number of days</option>
                    <option value="never">Never</option>
                  </select>
                  {closeMode === "found" && closeAge && (
                    <em className="qs-share">{`${closeAge.count.toLocaleString("en-AU")} Unsuccessful quotes were closed ${closeAge.days} days to the hour after they became one.`}</em>
                  )}
                </label>
                {closeMode === "days" && (
                  <label className="qs-field">
                    <span>After</span>
                    <span className="qs-in">
                      <input
                        className="wb2-fi"
                        inputMode="numeric"
                        value={closeDays}
                        disabled={busy}
                        onChange={(e) => setCloseDays(e.target.value)}
                        aria-label="Days after which ServiceM8 closes an unanswered quote"
                      />
                      <em>days</em>
                    </span>
                  </label>
                )}
              </div>
              <div className="wb2-jqacts">
                <button
                  type="button"
                  className="pbtn primary"
                  disabled={busy || !ready || !closeChanged || !closeValid}
                  onClick={() => void save({ ...saved, autoCloseDays: typedClose }, "Saved")}
                >
                  Save
                </button>
              </div>
            </section>

            <section className="qs-group">
              <h2 className="qs-h">Categories</h2>
              <p className="qs-sub">
                What each ServiceM8 category&rsquo;s jobs are. Installs can be quotes, warranty isn&rsquo;t a new enquiry, and Not jobs are left
                out of everything.
                {rolesUnsaved && " Until they're saved, each is read from its name."}
              </p>
              {categories.length === 0 ? (
                <p className="qs-sub">No categories in ServiceM8&rsquo;s copy yet.</p>
              ) : (
                <ul className="as-list" aria-label="Categories">
                  {categories.map((c) => (
                    <li key={c.uuid}>
                      <span className="qs-item">
                        <b>{c.name}</b>
                        <em>{c.jobs === 1 ? "1 job in two years" : `${c.jobs.toLocaleString("en-AU")} jobs in two years`}</em>
                      </span>
                      <select
                        className="wb2-sel"
                        value={roles[c.uuid]}
                        disabled={busy}
                        onChange={(e) => setRoles((r) => ({ ...r, [c.uuid]: e.target.value as CategoryRole }))}
                        aria-label={`What ${c.name} jobs are`}
                      >
                        {CATEGORY_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_WORDS[r]}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              )}
              <div className="wb2-jqacts">
                <button
                  type="button"
                  className="pbtn primary"
                  disabled={busy || !ready || categories.length === 0 || !(rolesChanged || rolesUnsaved)}
                  onClick={() => void save({ ...saved, categoryRoles: { ...saved.categoryRoles, ...roles } }, "Categories saved")}
                >
                  Save
                </button>
              </div>
            </section>

            <section className="qs-group">
              <h2 className="qs-h">Bookings, not customers</h2>
              <p className="qs-sub">
                Clients whose job cards book someone&rsquo;s time rather than work, like a day at TAFE. Their cards are left out of every figure;
                anything quoted, invoiced or paid for them still counts.
                {saved.notCustomers === null && " Until this list is saved, the ones found in your jobs are left out."}
              </p>
              {clients.length === 0 ? (
                <p className="qs-sub">None found in your jobs.</p>
              ) : (
                <ul className="as-list" aria-label="Bookings, not customers">
                  {clients.map((c) => (
                    <li key={c.id}>
                      <label className="as-check">
                        <input
                          type="checkbox"
                          checked={ticked.has(c.id)}
                          disabled={busy}
                          onChange={() =>
                            setTicked((t) => {
                              const next = new Set(t);
                              if (next.has(c.id)) next.delete(c.id);
                              else next.add(c.id);
                              return next;
                            })
                          }
                        />
                        <span className="qs-item">
                          <b>{c.name}</b>
                          <em>
                            {c.cards === null
                              ? "Listed by you"
                              : `${c.cards.toLocaleString("en-AU")} cards in two years, none quoted, invoiced or paid`}
                          </em>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <div className="wb2-jqacts">
                <button
                  type="button"
                  className="pbtn primary"
                  disabled={busy || !ready || !clientsChanged}
                  onClick={() => void save({ ...saved, notCustomers: listed }, "Saved")}
                >
                  Save
                </button>
              </div>
            </section>
          </ScreenPanel>
        </div>
      </div>
    </div>
  );
}
