"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { daysUntil, fmtAuDayMonth, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { PROJECT_STAGES } from "@/lib/workboard/stages";
import { READINESS_KEYS, type ReadinessKey } from "@/lib/workboard/visit-schedule";
import {
  maintenanceVitals,
  projectFlag,
  projectVitals,
  radarLoad,
  stageFunnel,
  staleDays,
  weekBuckets,
  type LoadBucket,
  type Vital,
} from "@/lib/workboard/vitals";
import type { RadarItem } from "@/lib/workboard/maintenance-query";
import type { ProjectStripItem } from "@/lib/workboard/projects-query";
import type { WorkboardData } from "@/lib/workboard/page-data";

/* The Workboard — a command centre, not a menu.

   THE BRIEF, IN ONE LINE: someone running a crew opens this at 6am and needs
   three answers before their first coffee — what's on fire, what's about to
   be, and how heavy is the run ahead. Everything on this screen serves one of
   those; anything that served none of them was cut.

   The shape is deliberately IDENTICAL on both sides of the switcher — vitals,
   then a load view, then the list — so flipping between Maintenance and
   Projects feels like turning a card over rather than navigating somewhere
   new. The two differ only where the data honestly differs: maintenance has
   dates, so its load view is eight weeks of calendar; projects have no due
   date in the schema, so theirs is the stage funnel. Inventing dates for the
   projects rail would have made the two match and made one of them a lie.

   Every threshold behind a colour lives in vitals.ts, never here.

   Desktop-first, big-screen ready: DISPLAY MODE fullscreens the board element
   itself, flips it dark via the :fullscreen styles in shell.css, and refreshes
   every minute while it's up. No new route, no token — the person at the TV
   signed in like anyone else, and closing fullscreen is Esc.

   Standalone-first: with no ServiceM8 connection the board says exactly that
   and keeps working — the SM8-derived strips are absent, not broken. */

const REFRESH_MS = 60_000;

const TABS = [
  { key: "maintenance", label: "Maintenance" },
  { key: "projects", label: "Projects" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/** The vitals double as the filter — a number you can't act on is decoration. */
type Filter = "urgent" | "attention" | "all";

/** "7:30am" from a naive 'YYYY-MM-DD HH:MM:SS' mirror string — string maths,
    no Date(), because the value is already the account's wall clock. */
function timeLabel(naive: string): string {
  const hhmm = naive.slice(11, 16);
  const h = parseInt(hhmm.slice(0, 2), 10);
  if (Number.isNaN(h)) return "";
  const mins = hhmm.slice(3, 5);
  const ampm = h < 12 ? "am" : "pm";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${mins}${ampm}`;
}

function agoLabel(iso: string | null): string {
  if (!iso) return "not yet";
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (Number.isNaN(mins) || mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return "over a day ago";
}

/* ═════════════ the vitals row ═════════════ */

function Vitals({
  tiles,
  filter,
  onFilter,
}: {
  tiles: readonly Vital[];
  filter: Filter;
  onFilter: (f: Filter) => void;
}) {
  return (
    <div className="wb-vitals">
      {tiles.map((t) => (
        <button
          key={t.key}
          type="button"
          className={
            `wb-vital ${t.tone}` +
            (filter === t.key ? " on" : "") +
            (t.tone === "urgent" ? " wb-pulse" : "")
          }
          aria-pressed={filter === t.key}
          onClick={() => onFilter(t.key as Filter)}
        >
          <b>{t.count}</b>
          <span>{t.label}</span>
          <em>{t.caption}</em>
        </button>
      ))}
    </div>
  );
}

/* ═════════════ the load rail ═════════════

   One component, two axes. Maintenance stacks visits into calendar weeks;
   projects stack into pipeline stages. Both answer "where does it pile up",
   which is why they share a shape — and the stack is capped so one monstrous
   column can't stretch the rail and flatten every other week into nothing. */

const STACK_CAP = 5;

type RailColumn = { key: string; label: string; sub?: string; tone?: string; dots: string[] };

function LoadRail({ columns, empty }: { columns: RailColumn[]; empty: string }) {
  if (columns.every((c) => c.dots.length === 0)) return <p className="int-hint">{empty}</p>;
  return (
    <div className="wb-rail">
      {columns.map((c) => (
        <div className={"wb-railcol" + (c.tone ? ` ${c.tone}` : "")} key={c.key}>
          <div className="wb-railstack">
            {c.dots.slice(0, STACK_CAP).map((state, i) => (
              <span className={`wb-raildot ${state}`} key={i} />
            ))}
            {c.dots.length > STACK_CAP && (
              <span className="wb-railmore">+{c.dots.length - STACK_CAP}</span>
            )}
          </div>
          <b>{c.dots.length || ""}</b>
          <em>{c.label}</em>
          {c.sub && <i>{c.sub}</i>}
        </div>
      ))}
    </div>
  );
}

function weeksToColumns(buckets: LoadBucket[]): RailColumn[] {
  return buckets.map((b) => ({
    key: b.key,
    // Named weeks keep their names; the rest are dated by their Monday.
    label: b.label || `w/c ${fmtAuDayMonth(b.key)}`,
    tone: b.key === "overdue" ? "over" : undefined,
    dots: b.items.map((i) => i.state),
  }));
}

/* ═════════════ maintenance ═════════════ */

const READINESS_LABEL: Record<ReadinessKey, string> = {
  access_confirmed: "Access",
  time_confirmed: "Time",
  parts_ready: "Parts",
  customer_notified: "Customer told",
};

/** Four pips — one per check, in a fixed order so the third pip always means
    parts. Naming what's missing is the difference between "3/4 ready" (a
    fact) and "parts not ready" (a job for this afternoon). */
function ReadyPips({ item }: { item: RadarItem }) {
  const missing = READINESS_KEYS.filter((k) => !item.readiness[k]).map((k) => READINESS_LABEL[k]);
  return (
    <span
      className="wb-pips"
      title={missing.length === 0 ? "Ready to go" : `Still to do: ${missing.join(" · ")}`}
    >
      {READINESS_KEYS.map((k) => (
        <i key={k} className={item.readiness[k] ? "on" : ""} aria-hidden="true" />
      ))}
      <span className="wb-pipnote">
        {missing.length === 0 ? "Ready" : missing.join(" · ")}
      </span>
    </span>
  );
}

const BUCKETS: [RadarItem["bucket"], string][] = [
  ["overdue", "Overdue"],
  ["due_soon", "Due soon"],
  ["upcoming", "Coming up"],
];

function RadarGroups({
  radar,
  today,
  demo,
}: {
  radar: RadarItem[];
  today: string;
  demo: boolean;
}) {
  return (
    <>
      {BUCKETS.map(([bucket, title]) => {
        const items = radar.filter((r) => r.bucket === bucket);
        if (items.length === 0) return null;
        return (
          <div className="wb-day" key={bucket}>
            <div className="wb-dayhead">
              {title} <i>{items.length}</i>
            </div>
            {items.map((r) => {
              const cls = "wb-row" + (bucket === "overdue" ? " wb-pulse" : "");
              // An overdue row's date is the least useful thing about it. HOW
              // LATE is the number that gets it dealt with, so that's the chip.
              const late = -daysUntil(r.dueDate, today);
              const inner = (
                <>
                  <span
                    className={"wb-chip" + (bucket === "overdue" ? " bad" : bucket === "due_soon" ? " warn" : " on")}
                    title={fmtAuWeekdayDayMonth(r.dueDate)}
                  >
                    {bucket === "overdue"
                      ? `${late} ${late === 1 ? "day" : "days"} over`
                      : r.dueDate === today
                        ? "Today"
                        : fmtAuWeekdayDayMonth(r.dueDate)}
                  </span>
                  <span className="wb-who">
                    <b>{r.label}</b>
                    <em> · {r.clientName}</em>
                    {r.siteLabel && <em> · {r.siteLabel}</em>}
                  </span>
                  {r.jobNumber && <span className="wb-chip">#{r.jobNumber}</span>}
                  <ReadyPips item={r} />
                  {demo && <span className="wb-chip ghost">Demo</span>}
                </>
              );
              // A demo row has no agreement to open, so it isn't a link. The
              // fixture must never hand anyone a 404.
              return demo ? (
                <div className={cls} key={r.visitId}>
                  {inner}
                </div>
              ) : (
                <Link
                  href={`/dashboard/workboard/maintenance/${r.agreementId}`}
                  className={cls}
                  key={r.visitId}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  {inner}
                </Link>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

/* ═════════════ projects ═════════════ */

function ProjectCard({
  project,
  today,
  demo,
}: {
  project: ProjectStripItem;
  today: string;
  demo: boolean;
}) {
  const flag = projectFlag(project, today);
  const stageIndex = PROJECT_STAGES.indexOf(project.stage as (typeof PROJECT_STAGES)[number]);
  const quiet = staleDays(project, today);

  const inner = (
    <>
      <div className="wb-projhead">
        <b>{project.name}</b>
        {demo && <span className="wb-chip ghost">Demo</span>}
      </div>
      <em className="wb-projsub">
        {[project.clientName, project.siteLabel].filter(Boolean).join(" · ") || "—"}
      </em>

      {/* the pipeline, compressed: where this one sits, at a glance */}
      <div className="wb-stagerail" title={`Stage ${Math.max(stageIndex + 1, 1)} of ${PROJECT_STAGES.length} — ${project.stage}`}>
        {PROJECT_STAGES.map((s, i) => (
          <span
            key={s}
            className={"wb-sdot" + (i < stageIndex ? " past" : i === stageIndex ? " now" : "")}
          />
        ))}
      </div>

      <div className="wb-projmeta">
        <span className="wb-chip on">{project.stage}</span>
        {flag.reason && (
          <span className={"wb-chip " + (flag.tone === "urgent" ? "bad" : "warn")}>
            {flag.reason}
          </span>
        )}
      </div>

      <div className="wb-bar">
        <span style={{ width: `${project.percent}%` }} />
      </div>
      <em className="wb-projsub">
        {project.done}/{project.total} ticked
        {quiet > 0 && ` · last moved ${quiet} ${quiet === 1 ? "day" : "days"} ago`}
      </em>
    </>
  );

  const cls = "card2 wb-proj" + (flag.tone ? ` ${flag.tone}` : "");
  return demo ? (
    <div className={cls}>{inner}</div>
  ) : (
    <Link href={`/dashboard/workboard/projects/${project.id}`} className={cls}>
      {inner}
    </Link>
  );
}

/* ═════════════ the board ═════════════ */

export function OverviewScreen({ data }: { data: WorkboardData }) {
  const router = useRouter();
  const boardRef = useRef<HTMLDivElement>(null);
  const [display, setDisplay] = useState(false);
  const [tab, setTab] = useState<TabKey>("maintenance");
  const [filter, setFilter] = useState<Filter>("all");

  // Fullscreen state follows the browser, not our button — Esc must work.
  useEffect(() => {
    const onChange = () => setDisplay(document.fullscreenElement === boardRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // A wall screen left alone must not drift stale.
  useEffect(() => {
    if (!display) return;
    const t = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [display, router]);

  const toDisplay = () => {
    boardRef.current?.requestFullscreen?.().catch(() => {});
  };

  const showTab = (next: TabKey) => {
    setTab(next);
    // A filter is a question about ONE side of the board; carrying it across
    // would silently hide rows on a screen the person just arrived at.
    setFilter("all");
  };

  const connected = data.connection === "connected";
  const demo = data.demo;

  const mv = useMemo(() => maintenanceVitals(data.radar, data.today), [data.radar, data.today]);
  const pv = useMemo(() => projectVitals(data.projects, data.today), [data.projects, data.today]);
  const weeks = useMemo(
    () => weeksToColumns(weekBuckets(radarLoad(data.radar), data.today)),
    [data.radar, data.today]
  );
  const funnel = useMemo(
    () =>
      stageFunnel(data.projects, PROJECT_STAGES, data.today).map((c) => ({
        key: c.stage,
        label: c.stage,
        tone: c.tone === "calm" ? undefined : c.tone,
        dots: c.items.map((p) => {
          const t = projectFlag(p, data.today).tone;
          return t === "urgent" ? "overdue" : t === "attention" ? "attention" : "ready";
        }),
      })),
    [data.projects, data.today]
  );

  const vitals = tab === "maintenance" ? mv : pv;
  const shownRadar = filter === "urgent" ? mv.urgent : filter === "attention" ? mv.attention : mv.all;
  const shownProjects =
    filter === "urgent" ? pv.urgent : filter === "attention" ? pv.attention : pv.all;
  const emptyForFilter =
    filter === "urgent"
      ? "Nothing urgent — that's the good outcome."
      : "Nothing needs chasing right now.";

  /* Group the bookings by day once — the run sheet reads as a day plan. */
  const byDay = new Map<string, typeof data.upcoming>();
  for (const b of data.upcoming) {
    const day = b.start.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(b);
    byDay.set(day, list);
  }

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="v2head" style={{ marginBottom: 14 }}>
            <div>
              <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
                Workboard
              </h1>
              <p className="int-lede" style={{ margin: "6px 0 0" }}>
                What&apos;s late, what&apos;s coming, and how heavy the run ahead is.
              </p>
            </div>
            <div className="wb-headtools">
              {/* data-active drives the sliding thumb, the studio idiom */}
              <nav className="wb-seg" aria-label="Board" data-active={TABS.findIndex((t) => t.key === tab)}>
                <span className="wb-seg-thumb" aria-hidden="true" />
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={"wb-segb" + (tab === t.key ? " on" : "")}
                    onClick={() => showTab(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </nav>
              <button className="pbtn ghost" onClick={toDisplay} title="Fullscreen for a wall screen">
                <Icon name="maximize" size={16} />
                Display mode
              </button>
            </div>
          </div>

          <div className="wb-board" ref={boardRef}>
            {data.connection === "attention" && (
              <div className="int-note bad">
                The ServiceM8 connection needs attention — job data on this board may be stale.
              </div>
            )}

            {demo && (
              <div className="wb-demo">
                <Icon name="alert" size={16} />
                <span>
                  <b>Example data.</b> Three agreements and three projects, so the board can be
                  judged full rather than empty. It disappears the moment you add a real one or
                  connect ServiceM8 — nothing here is saved.
                </span>
              </div>
            )}

            <Vitals tiles={vitals.tiles} filter={filter} onFilter={setFilter} />

            {tab === "maintenance" ? (
              <>
                <div className="card2">
                  <div className="c2h">
                    <span className="ci">
                      <Icon name="activity" size={19} />
                    </span>
                    <div>
                      <b>The next eight weeks</b>
                      <em>Where the services pile up — and where there&apos;s room.</em>
                    </div>
                  </div>
                  <LoadRail columns={weeks} empty="Nothing scheduled in the next two months." />
                </div>

                <div className="card2">
                  <div className="c2h">
                    <span className="ci">
                      <Icon name="rotate" size={19} />
                    </span>
                    <div>
                      <b>Services</b>
                      <em>Overdue first — those breathe red until someone deals with them.</em>
                    </div>
                    {!demo && (
                      <Link
                        href="/dashboard/workboard/maintenance"
                        className="pbtn ghost"
                        style={{ marginLeft: "auto" }}
                      >
                        All agreements
                      </Link>
                    )}
                  </div>
                  {shownRadar.length === 0 ? (
                    <p className="int-hint">
                      {filter === "all"
                        ? `Nothing on the radar${data.manage ? " — set up an agreement under All agreements" : ""}.`
                        : emptyForFilter}
                    </p>
                  ) : (
                    <RadarGroups radar={shownRadar} today={data.today} demo={demo} />
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="card2">
                  <div className="c2h">
                    <span className="ci">
                      <Icon name="activity" size={19} />
                    </span>
                    <div>
                      <b>Down the pipeline</b>
                      <em>Every stage, so you can see where jobs bank up.</em>
                    </div>
                  </div>
                  <LoadRail columns={funnel} empty="No projects in the pipeline." />
                </div>

                <div className="card2">
                  <div className="c2h">
                    <span className="ci">
                      <Icon name="layers" size={19} />
                    </span>
                    <div>
                      <b>Projects in flight</b>
                      <em>Stage, checklist and how long since anyone touched it.</em>
                    </div>
                    {!demo && (
                      <Link
                        href="/dashboard/workboard/projects"
                        className="pbtn ghost"
                        style={{ marginLeft: "auto" }}
                      >
                        All projects
                      </Link>
                    )}
                  </div>
                  {shownProjects.length === 0 ? (
                    <p className="int-hint">
                      {filter === "all"
                        ? `Nothing on the go${data.manage ? " — start one under All projects" : ""}.`
                        : emptyForFilter}
                    </p>
                  ) : (
                    <div className="wb-projgrid">
                      {shownProjects.map((p) => (
                        <ProjectCard key={p.id} project={p} today={data.today} demo={demo} />
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Shared by both tabs: the crew's actual week, straight from the
                schedule. Only exists with an integration. */}
            {connected && (
              <div className="card2 wb-run">
                <div className="c2h">
                  <span className="ci">
                    <Icon name="calendar" size={19} />
                  </span>
                  <div>
                    <b>Booked in — next 7 days</b>
                    <em>Straight from the ServiceM8 schedule.</em>
                  </div>
                  {data.counts && (
                    <span className="wb-runcounts">
                      <i>{data.counts.quotes}</i> quotes · <i>{data.counts.workOrders}</i> work
                      orders · <i>{data.counts.completedFortnight}</i> done in 14 days
                    </span>
                  )}
                </div>
                {data.upcoming.length === 0 ? (
                  <p className="int-hint">Nothing scheduled in the next week.</p>
                ) : (
                  [...byDay.entries()].map(([day, list]) => (
                    <div className="wb-day" key={day}>
                      <div className="wb-dayhead">{fmtAuWeekdayDayMonth(day)}</div>
                      {list.map((b) => (
                        <div className="wb-row" key={b.id}>
                          <span className="wb-time">{timeLabel(b.start)}</span>
                          {b.jobNumber && <span className="wb-chip">#{b.jobNumber}</span>}
                          <span className="wb-who">
                            <b>{b.clientName ?? "—"}</b>
                            {b.suburb && <em> · {b.suburb}</em>}
                          </span>
                          <span className="wb-tech">{b.staffName ?? ""}</span>
                          {b.jobStatus && (
                            <span className={"wb-chip " + (b.jobStatus === "Work Order" ? "on" : "")}>
                              {b.jobStatus}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* One line, not a card: standalone is a fact about the board, not
                a thing to read every morning. */}
            {data.connection === "none" && (
              <p className="wb-stamp">
                Running standalone — projects and maintenance are tracked here without any
                integration.
                {data.manage && (
                  <>
                    {" "}
                    <Link href="/dashboard/admin/integrations/servicem8" className="ro-link">
                      Connect ServiceM8
                    </Link>{" "}
                    to fill it with live jobs, clients and bookings.
                  </>
                )}
              </p>
            )}

            {connected && data.synced && (
              <p className="wb-stamp">
                {data.synced.running
                  ? "Syncing with ServiceM8 now…"
                  : `Mirror synced ${agoLabel(data.synced.finishedAt)}`}
                {data.timezone ? ` · ${data.timezone}` : ""}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
