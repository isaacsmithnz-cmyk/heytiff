"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/shell/icon";
import {
  DEFAULT_SETTINGS,
  type DayEntry,
  type Derived,
  type Settings,
  type StaffStatus,
  type StaffWeek,
  type WeekCtx,
  dayClass,
  derive,
  fmt,
  initials,
  nameHue,
  submitNote,
} from "./logic";
import { TimePaySettings } from "./settings";
import type { DemoPayPeriod } from "@/mock/demo";

/* Time & Pay — admin weekly payroll review, ported from the design handoff.
   Sections sort staff by what needs action (Need review → Ready to approve →
   Approved); approvals/send-backs and pay settings persist in localStorage
   until a backend exists (matching the prototype's ht_tp_* keys). */

type TimePayAction = "approved" | "sent";
type Row = { s: StaffWeek; d: Derived; status: StaffStatus };

const LS_ACT = "ht_tp_actions";
const LS_SET = "ht_tp_set";

function Avatar({ name }: { name: string }) {
  const h = nameHue(name);
  return (
    <span
      className="av"
      style={{ background: `linear-gradient(135deg,hsl(${h} 68% 52%),hsl(${(h + 38) % 360} 64% 44%))` }}
    >
      {initials(name)}
    </span>
  );
}

function Tile({ d, i, settings, ctx }: { d: DayEntry; i: number; settings: Settings; ctx: WeekCtx }) {
  const w = ctx.week[i];
  const cls = dayClass(d, i, settings, ctx);
  const hh =
    cls === "empty" ? "—"
    : cls === "miss" ? "Missing"
    : cls === "leave" ? "Leave"
    : cls === "sick" ? "Sick"
    : cls === "ph" ? "Pub hol"
    : fmt((d as { h: number }).h) + "h";
  return (
    <div className={`tile ${cls}${i === ctx.today ? " today" : ""}`}>
      <span className="wd">{w[0]}</span>
      <span className="dn">{w[1]}</span>
      <span className="hh">{hh}</span>
    </div>
  );
}

function MiniTile({ d, i, settings, ctx }: { d: DayEntry; i: number; settings: Settings; ctx: WeekCtx }) {
  const cls = dayClass(d, i, settings, ctx);
  const label =
    cls === "empty" ? "No entry"
    : cls === "miss" ? "Missing entry"
    : cls === "leave" ? "Leave"
    : cls === "sick" ? "Sick"
    : cls === "ph" ? "Public holiday"
    : fmt((d as { h: number }).h) +
      "h" +
      (cls === "std" ? " · standard" : cls === "over" ? " · overtime" : " · under standard");
  return (
    <span
      className={`mt ${cls}${i === ctx.today ? " today" : ""}`}
      title={`${ctx.week[i][0]} ${ctx.week[i][1]} — ${label}`}
    ></span>
  );
}

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
  return (
    <div className="detail">
      <div className="drows">
        {s.days.map((day, i) => {
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
          if (day.t !== "work") {
            const lab = day.t === "leave" ? "Annual leave" : day.t === "sick" ? "Sick leave" : "Public holiday";
            return (
              <div className="drow" key={i}>
                <span className="wd">{w[0]}</span>
                <span className="dt">{w[1]} {w[2]}</span>
                <span className="sh">{lab}</span>
                <span></span>
                <span className="hh">{fmt(day.h)}h</span>
              </div>
            );
          }
          return (
            <div className="drow" key={i}>
              <span className="wd">{w[0]}</span>
              <span className="dt">{w[1]} {w[2]}</span>
              <span className="sh">{day.in} – {day.out}</span>
              <span></span>
              <span className="hh">{fmt(day.h)}h</span>
            </div>
          );
        })}
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
  onAction,
}: {
  row: Row;
  settings: Settings;
  ctx: WeekCtx;
  onAction: (name: string, a: TimePayAction) => void;
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
          <div className="rl">{s.role}</div>
        </div>
        <div className="sp"></div>
        <div className="cacts">
          {sent ? (
            <span className="apprtag sent">
              <Icon name="send" size={13} />
              Sent back · awaiting reply
            </span>
          ) : (
            <>
              <button className="capprove" onClick={() => onAction(s.name, "approved")}>
                <Icon name="check" size={15} sw={2.6} />
                Approve
              </button>
              <button className="cedit">
                <Icon name="edit" size={14} />
                Edit
              </button>
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
            onClick={() => {
              setSending(false);
              onAction(s.name, "sent");
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
            <span className="l">Total worked</span>
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
          <button className="cs-expand" onClick={() => setOpen(!open)}>
            View daily breakdown <Icon name="chevD" size={15} />
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
}: {
  row: Row;
  settings: Settings;
  ctx: WeekCtx;
  onApprove: (name: string) => void;
}) {
  const { s, d } = row;
  const done = row.status === "approved";
  return (
    <div className={`crow${done ? " done" : ""}`}>
      <Avatar name={s.name} />
      <div className="who">
        <div className="nm">{s.name}</div>
        <div className="rl">{s.role}</div>
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
      ) : (
        <>
          <button className="capprove" onClick={() => onApprove(s.name)}>
            <Icon name="check" size={14} sw={2.6} />
            Approve
          </button>
          <button className="cedit crowedit">
            <Icon name="edit" size={13} />
            Edit
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
  periods,
}: {
  staff: StaffWeek[];
  week: WeekCtx["week"];
  today: number;
  periods: DemoPayPeriod[];
}) {
  const ctx: WeekCtx = useMemo(() => ({ week, today }), [week, today]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [setupDone, setSetupDone] = useState(false);
  const [actions, setActions] = useState<Record<string, TimePayAction>>({});
  const [hydrated, setHydrated] = useState(false);
  const [pIdx, setPIdx] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  /* localStorage stands in for the backend; read after mount to keep SSR stable */
  useEffect(() => {
    try {
      const sv = localStorage.getItem(LS_SET);
      if (sv) {
        const saved = JSON.parse(sv);
        if (saved.settings) setSettings({ ...DEFAULT_SETTINGS, ...saved.settings });
        setSetupDone(!!saved.done);
      }
      setActions(JSON.parse(localStorage.getItem(LS_ACT) || "{}"));
    } catch {
      /* corrupted or unavailable storage — start from defaults */
    }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LS_ACT, JSON.stringify(actions));
    } catch {}
  }, [actions, hydrated]);

  const saveSettings = (next: Settings) => {
    setSettings(next);
    setSetupDone(true);
    try {
      localStorage.setItem(LS_SET, JSON.stringify({ settings: next, done: true }));
    } catch {}
  };

  const rows: Row[] = useMemo(
    () =>
      staff.map((s) => {
        const d = derive(s, settings, ctx);
        return { s, d, status: actions[s.name] ?? d.status };
      }),
    [staff, settings, ctx, actions]
  );

  const review = rows.filter((r) => r.status === "review" || r.status === "sent");
  const ready = rows.filter((r) => r.status === "ready");
  const approved = rows.filter((r) => r.status === "approved");
  const otTot = rows.reduce((a, r) => a + r.d.ot + r.d.ot2, 0);

  const period = periods[pIdx];
  const note = period.live ? submitNote(settings) : period.note;
  const setAction = (name: string, a: TimePayAction) => setActions((p) => ({ ...p, [name]: a }));

  return (
    <div className="page in">
      <div className="wrap">
        <div className={`stg tpr${period.live ? "" : " locked"}`}>
          <div className="rhead">
            <div>
              <h1>Time &amp; Pay</h1>
              <div className="wknav">
                <button
                  className="arw"
                  aria-label="Previous period"
                  disabled={pIdx >= periods.length - 1}
                  onClick={() => setPIdx((i) => Math.min(periods.length - 1, i + 1))}
                >
                  <Icon name="chevL" size={17} />
                </button>
                <span className="range">
                  {period.range} <em>{period.year}</em>
                </span>
                <button
                  className="arw"
                  aria-label="Next period"
                  disabled={pIdx <= 0}
                  onClick={() => setPIdx((i) => Math.max(0, i - 1))}
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
            </div>
            <div className="racts">
              <button className="bbtn sq" aria-label="Pay settings" onClick={() => setSettingsOpen(true)}>
                <Icon name="settings" size={17} />
              </button>
            </div>
          </div>

          <div className="stats">
            <div className="stat review">
              <span className="si"><Icon name="alert" size={18} /></span>
              <div className="stk">
                <div className="sv">{review.length}</div>
                <div className="sl">Need review</div>
                <div className="ss">Action required</div>
              </div>
            </div>
            <div className="stat normal">
              <span className="si"><Icon name="check" size={18} /></span>
              <div className="stk">
                <div className="sv">{ready.length + approved.length}</div>
                <div className="sl">Normal</div>
                <div className="ss">No action needed</div>
              </div>
            </div>
            <div className="stat ot">
              <span className="si"><Icon name="clock" size={18} /></span>
              <div className="stk">
                <div className="sv">{fmt(otTot)}h</div>
                <div className="sl">Overtime</div>
                <div className="ss">This week</div>
              </div>
            </div>
            <div className="stat exp">
              <span className="si"><Icon name="receipt" size={18} /></span>
              <div className="stk">
                <div className="sv">$0</div>
                <div className="sl">Expenses</div>
                <div className="ss">To review</div>
              </div>
            </div>
          </div>

          <div className="legend">
            <span className="llbl">Day colour</span>
            {([
              ["std", "Standard"],
              ["over", "Overtime"],
              ["under", "Under day"],
              ["leave", "Leave"],
              ["sick", "Sick"],
              ["ph", "Public hol"],
              ["empty", "No entry"],
            ] as const).map(([k, label]) => (
              <span className="lg" key={k}>
                <i className={`sw ${k}`}></i>
                {label}
              </span>
            ))}
          </div>

          {review.length > 0 && (
            <div className="sectwrap">
              <div className="sect attn">
                <span className="st">Need review</span>
                <span className="ct">{review.length}</span>
                <span className="ln"></span>
              </div>
              {review.map((r) => (
                <ReviewCard key={r.s.name} row={r} settings={settings} ctx={ctx} onAction={setAction} />
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
                  onClick={() =>
                    setActions((p) => {
                      const next = { ...p };
                      for (const r of ready) next[r.s.name] = "approved";
                      return next;
                    })
                  }
                >
                  <Icon name="check" size={15} sw={2.6} />
                  Approve all
                </button>
              </div>
              {ready.map((r) => (
                <CompactRow key={r.s.name} row={r} settings={settings} ctx={ctx} onApprove={(n) => setAction(n, "approved")} />
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
                <CompactRow key={r.s.name} row={r} settings={settings} ctx={ctx} onApprove={(n) => setAction(n, "approved")} />
              ))}
            </div>
          )}

          {settingsOpen && (
            <TimePaySettings
              settings={settings}
              firstRun={!setupDone}
              period={period}
              onClose={() => setSettingsOpen(false)}
              onSave={(next) => {
                saveSettings(next);
                setSettingsOpen(false);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
