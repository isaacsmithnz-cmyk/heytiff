"use client";

import { useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/shell/icon";
import {
  type Derived,
  type Settings,
  type StaffStatus,
  type StaffWeek,
  type WeekCtx,
  cycleNoun,
  derive,
  fmt,
  submitNote,
  weekGroups,
} from "./logic";
import { Avatar, DayLegend, MiniTile, Tile } from "./tiles";
import { TimePaySettings } from "./settings";
import { HolidaySection } from "./holiday-section";
import { useRouter } from "next/navigation";
import {
  approveWeek,
  savePaySettings,
  sendBackWeek,
  type TimepayResult,
} from "@/app/actions/timepay";
import type { SheetState } from "@/lib/timepay/query";
import { TimepayNav } from "./timepay-nav";
import { XeroPayroll } from "./xero-payroll";
import Link from "next/link";

/** Whole dollars — a stat tile is a glance, and cents on it are noise. */
const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;

/** One entry in the period switcher. `start` is the ISO Monday it begins. */
export type PayPeriod = { start: string; range: string; year: string; live: boolean; note: string };

/* Time & Pay — admin weekly payroll review, ported from the design handoff.
   Sections sort staff by what needs action (Need review → Ready to approve →
   Approved); approvals/send-backs and pay settings persist in localStorage
   until a backend exists (matching the prototype's ht_tp_* keys). */

type Row = { s: StaffWeek; d: Derived; status: StaffStatus; ctx: WeekCtx };

/** DB status -> the four states this screen renders. A submitted sheet still
    shows as review/ready on its merits; only a decision overrides that. */
function rowStatus(sheet: SheetState | undefined, derived: StaffStatus): StaffStatus {
  if (sheet?.status === "approved") return "approved";
  if (sheet?.status === "sent_back") return "sent";
  return derived;
}

/* ht_tp_actions / ht_tp_set are gone: approvals live in `timesheets` and pay
   settings in `pay_settings`, both org-scoped and both written by server
   actions that re-check the capability. */

function PayBar({ t }: { t: Derived }) {
  const any = t.normal || t.ot || t.ot2;
  return (
    <div className="paybar">
      {any ? (
        <>
          {t.normal ? <span className="pseg std" style={{ flex: t.normal }}></span> : null}
          {t.ot ? <span className="pseg ot15" style={{ flex: t.ot }}></span> : null}
          {t.ot2 ? <span className="pseg ot2" style={{ flex: t.ot2 }}></span> : null}
        </>
      ) : (
        <span className="pseg empty" style={{ flex: 1 }}></span>
      )}
    </div>
  );
}

function Bucket({ cls, label, rate, h }: { cls: string; label: string; rate: string; h: number }) {
  return (
    <div className={`bkt${h ? "" : " zero"}`}>
      <span className="bl">{label}</span>
      <span className={`rchip ${cls}`}>{rate}</span>
      <span className="bv">
        {fmt(h || 0)}
        <em>h</em>
      </span>
    </div>
  );
}

/* expanded per-day breakdown + category totals band */
function PerDay({ s, d, ctx }: { s: StaffWeek; d: Derived; ctx: WeekCtx }) {
  const cell = (cls: string, rate: string, label: string, h: number, always?: boolean) =>
    h || always ? (
      <div className={`tcell${h ? "" : " zero"}`} key={label}>
        <span className={`rchip ${cls}`}>{rate}</span>
        <div className="tk">
          <div className="tl">{label}</div>
          <div className="tv">{fmt(h || 0)}h</div>
        </div>
      </div>
    ) : null;
  const groups = weekGroups(s.days);
  const multiWeek = groups.length > 1; // a fortnight/month gets week dividers
  const dayRow = (day: (typeof s.days)[number], i: number) => {
    const w = ctx.week[i];
    if (day.t === "empty")
      return (
        <div className="drow none" key={i}>
          <span className="wd">{w[0]}</span>
          <span className="dt">{w[1]} {w[2]}</span>
          <span className="sh">No entry</span>
          <span></span>
          <span className="hh">—</span>
        </div>
      );
    /* A day marked "not worked" is the one entry with no hours to state — it
       is a person saying they weren't there, and it reaches this screen
       precisely so the approver sees it rather than reading a blank. */
    const label =
      day.t === "work"
        ? `${day.in} – ${day.out}`
        : day.t === "leave"
          ? "Annual leave"
          : day.t === "sick"
            ? "Sick leave"
            : day.t === "off"
              ? "Not worked"
              : "Public holiday";
    return (
      <div className={`drow${day.t === "off" ? " off" : ""}`} key={i}>
        <span className="wd">{w[0]}</span>
        <span className="dt">{w[1]} {w[2]}</span>
        <span className="sh">{label}</span>
        <span></span>
        <span className="hh">{day.t === "off" ? "—" : `${fmt(day.h)}h`}</span>
      </div>
    );
  };
  return (
    <div className="detail">
      <div className="drows">
        {groups.map((g) => (
          <div className="dweek" key={g.start}>
            {multiWeek && (
              <div className="dwh">
                <span>{g.label}</span>
                <em>{fmt(g.workedHours)}h</em>
              </div>
            )}
            {g.days.map(({ entry, index }) => dayRow(entry, index))}
          </div>
        ))}
      </div>
      <div className="totals">
        <div className="tcell w">
          <div className="tk">
            <div className="tl">Weighted hours</div>
            <div className="tv">{fmt(d.weighted)}h</div>
          </div>
        </div>
        {cell("std", "1×", "Regular", d.normal, true)}
        {cell("ot15", "1.5×", "Time and a half", d.ot, true)}
        {cell("ot2", "2×", "Double time", d.ot2, true)}
        {cell("sk", "paid", "Sick", d.sick)}
        {cell("lv", "paid", "Leave", d.leave)}
      </div>
    </div>
  );
}

function ReviewCard({
  row,
  settings,
  ctx,
  onApprove,
  onSendBack,
  canApprove,
}: {
  row: Row;
  settings: Settings;
  ctx: WeekCtx;
  onApprove: (staffId: string) => void;
  onSendBack: (staffId: string, question: string) => void;
  /** `approvals` — without it this is a read-only view of the week */
  canApprove: boolean;
}) {
  const { s, d } = row;
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [question, setQuestion] = useState("");
  const sent = row.status === "sent";

  return (
    <div className={`card flag${open ? " open" : ""}${sending ? " sending" : ""}`}>
      <div className="chead">
        <Avatar name={s.name} />
        <div className="who">
          <div className="nm">{s.name}</div>
          <div className="rl">{s.role}{s.payBasis === "salary" ? " · Salaried" : ""}</div>
        </div>
        <div className="sp"></div>
        <div className="cacts">
          {sent ? (
            <span className="apprtag sent">
              <Icon name="send" size={13} />
              Sent back · awaiting reply
            </span>
          ) : !canApprove ? null : (
            <>
              <button className="capprove" onClick={() => onApprove(s.id)}>
                <Icon name="check" size={15} sw={2.6} />
                Approve
              </button>
              {/* no Edit button: an approver questions a week with Send back —
                  editing someone else's hours is not an action that exists */}
              <button className="cedit sendback" onClick={() => setSending(true)}>
                <Icon name="send" size={14} />
                Send back
              </button>
            </>
          )}
        </div>
      </div>
      <div className="qform">
        <div className="ql">
          <Icon name="send" size={14} />
          Send back to {s.name.split(" ")[0]} — ask them to explain
        </div>
        <div className="qrow">
          <input
            placeholder="e.g. Confirm the overtime on Tue — what ran late?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button
            className="qsend"
            disabled={!question.trim()}
            onClick={() => {
              setSending(false);
              onSendBack(s.id, question);
              setQuestion("");
            }}
          >
            <Icon name="send" size={13} />
            Send
          </button>
          <button className="qcancel" onClick={() => setSending(false)}>
            Cancel
          </button>
        </div>
      </div>
      <div className="cbody">
        <div className="cleft">
          {d.bullets.length > 0 && (
            <div className={`obar${d.missing ? " bad" : ""}`}>
              <span className="oi">
                <Icon name="clock" size={15} />
              </span>
              <div className="ot">
                <b>{d.issueTitle}</b>
                <ul className="obul">
                  {d.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <div className="tiles">
            {s.days.map((day, i) => (
              <Tile key={i} d={day} i={i} settings={settings} ctx={ctx} />
            ))}
          </div>
        </div>
        <div className="cside">
          <div className="cs-head">
            {/* "Actual worked", the same words My timesheet uses for the same
                number — it read "Total worked" here and "Actual worked" there,
                which is two names for one figure across a screen and the
                screen it is reviewing. "Actual" is the one that carries the
                distinction: this is hours on the clock, not the weighted total
                in the breakdown below. */}
            <span className="l">Actual worked</span>
            <span className="tot">
              {fmt(d.worked)}
              <em>h</em>
            </span>
          </div>
          <PayBar t={d} />
          <div className="cs-buckets">
            <Bucket cls="std" label="Regular hours" rate="1×" h={d.normal} />
            <Bucket cls="ot15" label="Time and a half" rate="1.5×" h={d.ot} />
            <Bucket cls="ot2" label="Double time" rate="2×" h={d.ot2} />
            {d.sick ? <Bucket cls="sk" label="Sick" rate="paid" h={d.sick} /> : null}
            {d.leave ? <Bucket cls="lv" label="Leave" rate="paid" h={d.leave} /> : null}
          </div>
          <button className="cs-expand" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide daily breakdown" : "View daily breakdown"}
            <Icon name={open ? "chevU" : "chevD"} size={15} />
          </button>
        </div>
      </div>
      {open && <PerDay s={s} d={d} ctx={ctx} />}
    </div>
  );
}

function CompactRow({
  row,
  settings,
  ctx,
  onApprove,
  canApprove,
}: {
  row: Row;
  settings: Settings;
  ctx: WeekCtx;
  onApprove: (staffId: string) => void;
  canApprove: boolean;
}) {
  const { s, d } = row;
  const done = row.status === "approved";
  return (
    <div className={`crow${done ? " done" : ""}`}>
      <Avatar name={s.name} />
      <div className="who">
        <div className="nm">{s.name}</div>
        <div className="rl">{s.role}{s.payBasis === "salary" ? " · Salaried" : ""}</div>
      </div>
      <div className="mini">
        {s.days.map((day, i) => (
          <MiniTile key={i} d={day} i={i} settings={settings} ctx={ctx} />
        ))}
      </div>
      <div className="rt">
        <b>{fmt(d.worked)}</b>
        <em> h</em>
      </div>
      {done ? (
        <span className="apprtag">
          <Icon name="check" size={14} sw={2.6} />
          Approved
        </span>
      ) : !canApprove ? null : (
        <>
          <button className="capprove" onClick={() => onApprove(s.id)}>
            <Icon name="check" size={14} sw={2.6} />
            Approve
          </button>
        </>
      )}
    </div>
  );
}

export function TimePay({
  staff,
  week,
  today,
  through,
  periods,
  periodIndex,
  settings,
  configured,
  sheets,
  canApprove,
  financials,
  canHolidays,
  xeroConnected,
  wageDrift = null,
  expenses = { owed: 0, pending: 0 },
}: {
  staff: StaffWeek[];
  week: WeekCtx["week"];
  /** last index whose day is OVER — nobody is chased for a day still running */
  through: number;
  today: number;
  periods: PayPeriod[];
  periodIndex: number;
  settings: Settings;
  configured: boolean;
  /** timesheet row per staff id, for the period being viewed */
  sheets: Record<string, SheetState>;
  canApprove: boolean;
  financials: boolean;
  /** admin+ — unlocks the holidays row in the gear. A boolean, not the
      calendar: the section fetches its own rows when the row is opened. */
  canHolidays: boolean;
  /** Whether this workspace has a live Xero grant. A boolean only: the
      connection's details are owner business, and this screen just needs to
      know whether the matching section has anything to show. */
  xeroConnected?: boolean;
  /** One line when the weekly sweep found wages disagreeing with Xero, else
      null. A COUNT-derived sentence — the rates themselves stay behind the
      gated Check pay rates read in the settings gear. */
  wageDrift?: string | null;
  /** What's outstanding on expense claims. Resolved server-side and only when
      the viewer holds `financials` — the tile that shows it is money. */
  expenses?: { owed: number; pending: number };
}) {
  const router = useRouter();
  const ctx: WeekCtx = useMemo(() => ({ week, today, through }), [week, today, through]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const run = (action: () => Promise<TimepayResult>) => {
    setError(null);
    start(async () => {
      const res = await action();
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };

  const goPeriod = (i: number) => {
    const target = periods[i];
    if (target) router.push(`/dashboard/timepay?period=${target.start}`);
  };

  const rows: Row[] = useMemo(
    () =>
      staff.map((s) => {
        /* Each person is derived — and their tiles coloured — through their
           OWN roster, OWN holiday calendar and OWN outstanding paperwork. The
           loader resolves all three per person; this row is where they have to
           be handed back to `derive`.

           `holidays` USED TO BE DROPPED HERE, and it was a money bug. The
           loader had already resolved `holidayDays` for every person, and this
           line rebuilt the context without it — so `splitDay` never saw the
           `publicHoliday` flag and a worked public holiday was priced at
           ordinary rates on the approver's screen while the person's own
           screen priced it at 2×. Measured on the default settings: an 8-hour
           holiday on a $50 rate came to $800 on My timesheet and $400 here,
           and the "worked the public holiday" bullet — the line whose whole
           job is to make sure that day reaches a human — never fired. */
        const rowCtx: WeekCtx = {
          ...ctx,
          workDays: s.workDays ?? ctx.workDays,
          holidays: s.holidayDays,
          certMissing: s.certMissing,
        };
        const d = derive(s, settings, rowCtx);
        return { s, d, status: rowStatus(sheets[s.id], d.status), ctx: rowCtx };
      }),
    [staff, settings, ctx, sheets]
  );

  /* WHOSE MOVE IT IS, and the sections say so. A sent-back sheet used to sit
     inside "Need review" and count towards its "Action required" — but the
     question has already been asked and the answer is the staff member's to
     give. An approver counting their own queue was reading a number that
     included the cards they had already dealt with. */
  const review = rows.filter((r) => r.status === "review");
  const sentBack = rows.filter((r) => r.status === "sent");
  const ready = rows.filter((r) => r.status === "ready");
  const approved = rows.filter((r) => r.status === "approved");
  const otTot = rows.reduce((a, r) => a + r.d.ot + r.d.ot2, 0);

  const period = periods[periodIndex];
  const note = period.live ? submitNote(settings) : period.note;
  const approve = (staffId: string) => run(() => approveWeek(staffId, period.start));
  const sendBack = (staffId: string, q: string) => run(() => sendBackWeek(staffId, period.start, q));

  return (
    <div className="page in">
      <div className="wrap">
        {/* `wb2` for the board's tokens — the card's line colours are declared
            there, and a `.wb2-card` outside that root draws no border at all. */}
        <div className={`stg tpr wb2${period.live ? "" : " locked"}`}>
          <div className="rhead">
            <div>
              <h1>Time &amp; Pay</h1>
            </div>
            <div className="racts">
              {(financials || canHolidays) && (
                <button className="bbtn sq" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
                  <Icon name="settings" size={17} />
                </button>
              )}
            </div>
          </div>

          {/* WHICH SCREEN, then WHICH WEEK. The tabs used to sit under the whole
              header, which put the week — a control that only means anything on
              this tab — above the thing that chooses the tab. Now the tabs sit
              on the card that holds the screen, and the week is the first thing
              inside it: you pick the view, then the period within it. */}
          <TimepayNav active="sheets" />

          <div className="wb2-card tp-card">
            <div className="wknav">
                <button
                  className="arw"
                  aria-label="Previous period"
                  disabled={periodIndex >= periods.length - 1 || pending}
                  onClick={() => goPeriod(periodIndex + 1)}
                >
                  <Icon name="chevL" size={17} />
                </button>
                <span className="range">
                  {period.range} <em>{period.year}</em>
                </span>
                <button
                  className="arw"
                  aria-label="Next period"
                  disabled={periodIndex <= 0 || pending}
                  onClick={() => goPeriod(periodIndex - 1)}
                >
                  <Icon name="chevR" size={17} />
                </button>
                {period.live ? (
                  <span className="pstatus live">
                    <span className="d"></span>LIVE
                  </span>
                ) : (
                  <span className="pstatus hist">Historical</span>
                )}
              </div>
            <div className="autosub">{note}</div>
            {error && <div className="tp-err">{error}</div>}

          <div className="stats">
            <div className="stat review">
              <span className="si"><Icon name="alert" size={18} /></span>
              <div className="stk">
                <div className="sv">{review.length}</div>
                <div className="sl">Need review</div>
                <div className="ss">Action required</div>
              </div>
            </div>
            {/* APPROVED IS NOT THE SAME AS FINISHED WITH. This tile counted
                `ready + approved` under "Normal · No action needed", so the
                people still waiting on one tap from this very screen were
                filed as needing nothing — while the section below them said
                "Ready to approve" and offered an Approve all button. It counts
                what is actually done, and names what isn't underneath. */}
            <div className="stat normal">
              <span className="si"><Icon name="check" size={18} /></span>
              <div className="stk">
                <div className="sv">{approved.length}</div>
                <div className="sl">Approved</div>
                <div className="ss">
                  {ready.length > 0 ? `${ready.length} ready to approve` : "Nothing waiting"}
                </div>
              </div>
            </div>
            <div className="stat ot">
              <span className="si"><Icon name="clock" size={18} /></span>
              <div className="stk">
                <div className="sv">{fmt(otTot)}h</div>
                <div className="sl">Overtime</div>
                {/* the period's own noun — a monthly workspace was told its
                    month's overtime was "This week" */}
                <div className="ss">This {cycleNoun(settings.cycle)}</div>
              </div>
            </div>
            {/* Money, so it rides with `financials` like every other dollar
                on this screen — an hours-only view shows no figure at all,
                not a $0 placeholder.

                REAL NOW, and it means one precise thing: what the business
                still owes its people. Pending plus approved-but-unpaid;
                already-reimbursed and declined claims are not owed. The
                sub-line counts only what nobody has decided yet, because that
                is the part that needs a person. */}
            {financials && (
              <Link href="/dashboard/timepay/expenses" className="stat exp">
                <span className="si"><Icon name="receipt" size={18} /></span>
                <div className="stk">
                  <div className="sv">{money0(expenses.owed)}</div>
                  <div className="sl">Expenses</div>
                  <div className="ss">
                    {expenses.pending > 0 ? `${expenses.pending} to review` : "Nothing to review"}
                  </div>
                </div>
              </Link>
            )}
          </div>

          <DayLegend />

          {review.length > 0 && (
            <div className="sectwrap">
              <div className="sect attn">
                <span className="st">Need review</span>
                <span className="ct">{review.length}</span>
                <span className="ln"></span>
              </div>
              {review.map((r) => (
                <ReviewCard key={r.s.id} row={r} settings={settings} ctx={r.ctx} onApprove={approve} onSendBack={sendBack} canApprove={canApprove} />
              ))}
            </div>
          )}
          {sentBack.length > 0 && (
            <div className="sectwrap">
              <div className="sect">
                <span className="st">Waiting on them</span>
                <span className="ct">{sentBack.length}</span>
                <span className="ln"></span>
              </div>
              {sentBack.map((r) => (
                <ReviewCard key={r.s.id} row={r} settings={settings} ctx={r.ctx} onApprove={approve} onSendBack={sendBack} canApprove={canApprove} />
              ))}
            </div>
          )}
          {ready.length > 0 && (
            <div className="sectwrap">
              <div className="sect">
                <span className="st">Ready to approve</span>
                <span className="ct">{ready.length}</span>
                <span className="ln"></span>
                <button
                  className="allbtn"
                  disabled={pending || !canApprove}
                  hidden={!canApprove}
                  onClick={() =>
                    // sequential on purpose: each one is a separate decision
                    // with its own server-side guard, not a bulk update
                    run(async () => {
                      for (const r of ready) {
                        const res = await approveWeek(r.s.id, period.start);
                        if (!res.ok) return res;
                      }
                      return { ok: true };
                    })
                  }
                >
                  <Icon name="check" size={15} sw={2.6} />
                  Approve all
                </button>
              </div>
              {ready.map((r) => (
                <CompactRow key={r.s.id} row={r} settings={settings} ctx={r.ctx} onApprove={approve} canApprove={canApprove} />
              ))}
            </div>
          )}
          {approved.length > 0 && (
            <div className="sectwrap">
              <div className="sect">
                <span className="st">Approved</span>
                <span className="ct">{approved.length}</span>
                <span className="ln"></span>
              </div>
              {approved.map((r) => (
                <CompactRow key={r.s.id} row={r} settings={settings} ctx={r.ctx} onApprove={approve} canApprove={canApprove} />
              ))}
            </div>
          )}

          {/* Advisory, not an error: Xero changed and nobody has looked yet.
              The fix is two taps away in the gear, so the line points there
              rather than trying to be actionable itself. */}
            {wageDrift && (
              <div className="tp-drift">
                <Icon name="info" size={15} />
                <span>{wageDrift} Open settings → Xero payroll to compare.</span>
              </div>
            )}
          </div>

          {settingsOpen && (
            <TimePaySettings
              settings={settings}
              firstRun={!configured}
              canPay={financials}
              holidaySection={canHolidays ? <HolidaySection /> : null}
              xeroSection={
                xeroConnected ? (
                  /* The actions are imported lazily, inside the section, so
                     the Auth0 + Supabase runtime behind them never enters this
                     screen's bundle — the same reason the rate calculator
                     dynamic-imports its own save action. */
                  <XeroPayroll
                    load={async () => (await import("@/app/actions/xero-links")).getLinkingData()}
                    onLink={async (id, remote, how) =>
                      (await import("@/app/actions/xero-links")).linkEmployee(id, remote, how)
                    }
                    onUnlink={async (id) =>
                      (await import("@/app/actions/xero-links")).unlinkEmployee(id)
                    }
                    onAdoptEmployment={async (id, value) =>
                      (await import("@/app/actions/xero-links")).adoptEmploymentType(id, value)
                    }
                    onAdoptBasis={async (id, value) =>
                      (await import("@/app/actions/xero-links")).adoptPayBasis(id, value)
                    }
                    onCheckPay={async () =>
                      (await import("@/app/actions/xero-links")).checkPayRates()
                    }
                    onAdoptWage={async (id) =>
                      (await import("@/app/actions/xero-links")).adoptWage(id)
                    }
                  />
                ) : null
              }
              onClose={() => setSettingsOpen(false)}
              onSave={(next) => {
                run(() => savePaySettings(next));
                setSettingsOpen(false);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
