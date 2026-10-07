"use client";

import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { fmtAuDayMonth } from "@/lib/au-dates";
import { money, pct, type Bar, type PriceRow, type Week } from "@/lib/analytics/job-analytics";

/* The page's marks, drawn the one way (analytics.css says how they look).
   Every figure a mark stands for is also written beside it, so nothing is
   read off a bar alone: three of the chart colours are under 3:1 on white,
   and a label is what lets them be. */

/** A kind of job's colour, the same in every chart (tokens.css, in order). */
export const KIND_COLOUR: Record<string, string> = {
  split: "var(--chart-1)",
  multi: "var(--chart-2)",
  ducted: "var(--chart-3)",
  vrf: "var(--chart-4)",
  service: "var(--chart-5)",
  maintenance: "var(--chart-6)",
  ventilation: "var(--chart-7)",
  unknown: "var(--q)",
};

/** Ordered groups step through one blue, the first the lightest. */
export const STEP_COLOUR = ["var(--chart-seq-1)", "var(--chart-seq-2)", "var(--chart-seq-3)", "var(--chart-seq-4)"];

/** A list of rates: the label, a bar the length of the rate, "50% of 312". */
export function RateBars({ title, bars, colourOf }: { title: string; bars: Bar[]; colourOf?: (key: string, i: number) => string }) {
  return (
    <div>
      <h3>{title}</h3>
      {bars.length === 0 ? (
        <p className="an-say">Nothing decided yet.</p>
      ) : (
        <div className="an-bars">
          {bars.map((b, i) => (
            <div className="an-bar" key={b.key}>
              <span>{b.label}</span>
              <span className="an-track" aria-hidden="true">
                <span style={{ width: `${((b.rate ?? 0) * 100).toFixed(1)}%`, background: colourOf?.(b.key, i) }} />
              </span>
              <span className="an-num">
                <b>{pct(b.rate)}</b> <span>of {b.decided}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Wins by days to a yes, the column past 180 days set apart. */
export function DaysToYes({ bins }: { bins: { label: string; count: number; late: boolean }[] }) {
  const top = Math.max(1, ...bins.map((b) => b.count));
  return (
    <div>
      <div className="an-cols7 an-colplot">
        {bins.map((b) => (
          <div className={b.late ? "an-col late" : "an-col"} key={b.label}>
            <b>{b.count}</b>
            <span aria-hidden="true" style={{ height: `${Math.round((b.count / top) * 120)}px` }} />
          </div>
        ))}
      </div>
      <div className="an-cols7 an-axis">
        {bins.map((b) => (
          <span key={b.label}>{b.label}</span>
        ))}
      </div>
    </div>
  );
}

/** Won prices by kind of job: the middle, the average, the middle half, and
    the spread on its own scale, cheapest 5% to dearest 5%. */
export function PriceTable({ rows }: { rows: PriceRow[] }) {
  return (
    <div className="an-table">
      <table>
        <thead>
          <tr>
            <th>Job type</th>
            <th className="r">Won</th>
            <th className="r">Median</th>
            <th className="r">Average</th>
            <th>Middle half</th>
            <th>Spread</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const width = r.p95 - r.p5;
            const at = (v: number) => (width > 0 ? `${(((v - r.p5) / width) * 100).toFixed(1)}%` : "50%");
            return (
              <tr key={r.key}>
                <td className="k">{r.label}</td>
                <td className="r q">{r.jobs}</td>
                <td className="r m">{money(r.median)}</td>
                <td className="r">{money(r.average)}</td>
                <td>
                  {money(r.p25)} to {money(r.p75)}
                </td>
                <td>
                  <div className="an-spread">
                    <span>{money(r.p5)}</span>
                    <span className="an-strip" aria-hidden="true">
                      <span className="an-whisk" />
                      <span
                        className="an-mid"
                        style={{
                          left: at(r.p25),
                          width: width > 0 ? `${(((r.p75 - r.p25) / width) * 100).toFixed(1)}%` : "0",
                          background: KIND_COLOUR[r.key],
                        }}
                      />
                      <span className="an-med" style={{ left: at(r.median) }} />
                    </span>
                    <span>{money(r.p95)}</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* en-AU's short months as the app writes them (au-dates): three letters,
   but June, July and Sept in full. Fixed, so the server and the browser
   draw the same axis. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];

/** A clean top for the axis: 10, 20, 40, 60, 80, 100… */
function axisTop(max: number): number {
  if (max <= 10) return 10;
  const step = max <= 40 ? 10 : max <= 100 ? 20 : 50;
  return Math.ceil(max / step) * step;
}

/** Enquiries week by week, against the same weeks a year earlier. The
    pointer or the arrow keys pick a week; the busiest is read first. */
export function EnquiriesChart({ weeks }: { weeks: Week[] }) {
  const n = weeks.length;
  const busiest = weeks.reduce((best, w, i) => (w.now > weeks[best]!.now ? i : best), 0);
  const [picked, setPicked] = useState<number | null>(null);
  const at = picked ?? busiest;
  const top = axisTop(Math.max(1, ...weeks.map((w) => Math.max(w.now, w.before))));
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * 1000 : 500);
  const y = (v: number) => 200 - (v / top) * 200;
  const path = (key: "now" | "before") => weeks.map((w, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(w[key]).toFixed(1)}`).join(" ");
  const left = (i: number) => `${(x(i) / 10).toFixed(2)}%`;

  const months: { label: string; left: string }[] = [];
  weeks.forEach((w, i) => {
    const m = Number(w.start.slice(5, 7));
    // a month that starts in the last few weeks would hang off the edge
    if ((i === 0 || m !== Number(weeks[i - 1]!.start.slice(5, 7))) && (n < 8 || i < n - 2)) months.push({ label: MONTHS[m - 1]!, left: left(i) });
  });

  const pick = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    setPicked(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - box.left) / box.width) * (n - 1)))));
  };
  const step = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setPicked(Math.max(0, Math.min(n - 1, at + (e.key === "ArrowRight" ? 1 : -1))));
  };
  const w = weeks[at]!;

  return (
    <>
      <p className="an-read" aria-live="polite">
        Week of {fmtAuDayMonth(w.start)}: {w.now} {w.now === 1 ? "enquiry" : "enquiries"}, {w.before} the year before
      </p>
      <div className="an-line">
        <div className="an-ticks" aria-hidden="true">
          <span style={{ top: 0 }}>{top}</span>
          <span style={{ top: 100 }}>{top / 2}</span>
          <span style={{ top: 200 }}>0</span>
        </div>
        <div
          className="an-plot"
          tabIndex={0}
          role="group"
          aria-label="Enquiries week by week. Left and right pick a week."
          onMouseMove={pick}
          onMouseLeave={() => setPicked(null)}
          onKeyDown={step}
        >
          <span className="an-grid" style={{ top: 0 }} aria-hidden="true" />
          <span className="an-grid" style={{ top: 100 }} aria-hidden="true" />
          <span className="an-grid base" style={{ top: 199 }} aria-hidden="true" />
          <span className="an-cross" style={{ left: left(at) }} aria-hidden="true" />
          <svg viewBox="0 0 1000 200" preserveAspectRatio="none" width="100%" height="200" aria-hidden="true">
            <path d={path("before")} fill="none" stroke="var(--chart-2)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <path d={path("now")} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <span className="an-dot before" style={{ left: left(at), top: y(w.before) }} aria-hidden="true" />
          <span className="an-dot" style={{ left: left(at), top: y(w.now) }} aria-hidden="true" />
        </div>
        <span />
        <div className="an-months" aria-hidden="true">
          {months.map((m) => (
            <span key={`${m.label}${m.left}`} style={{ left: m.left }}>
              {m.label}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
