"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { WorkboardData } from "@/lib/workboard/page-data";
import { NoteCapture } from "./note-capture";
import { MaintenanceBoard } from "./board/maintenance-board";
import { ProjectsBoard } from "./board/projects-board";
import { MaintenanceWall } from "./board/wall";
import { calOfMaintenance, calOfProject } from "./board/derive";

/* The Workboard — a command centre, not a menu.

   THE BRIEF, IN ONE LINE: someone running a crew opens this at 6am and needs
   three answers before their first coffee — what's on fire, what's about to
   be, and how heavy is the run ahead. Everything on this screen serves one of
   those; anything that served none of them was cut.

   Both sides of the switcher are now the SAME architecture — one persistent
   card, tabs that swap information rather than surface, every colour derived
   from the one status law. Maintenance runs five tabs, projects four; flags
   route to the board whose work they point at, so nothing appears twice.

   Desktop-first, big-screen ready: DISPLAY MODE fullscreens the board element
   itself and refreshes every minute while it's up. No new route, no token —
   the person at the TV signed in like anyone else, and closing is Esc.

   Standalone-first: with no ServiceM8 connection the board says exactly that
   and keeps working — the SM8-derived strips are absent, not broken. */

const REFRESH_MS = 60_000;

const TABS = [
  { key: "maintenance", label: "Maintenance" },
  { key: "projects", label: "Projects" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

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

/* ═════════════ the board ═════════════ */

export function OverviewScreen({ data }: { data: WorkboardData }) {
  const router = useRouter();
  const boardRef = useRef<HTMLDivElement>(null);
  const [display, setDisplay] = useState(false);
  const [tab, setTab] = useState<TabKey>("maintenance");
  /** What the capture pill attaches to — a visit while its sheet is open. */
  const [capture, setCapture] = useState<{ visitId: string; label: string } | null>(null);

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

  const connected = data.connection === "connected";

  /* Flags route to the board whose work they point at (the one rule: nothing
     appears twice). A flag on a project or a project's trip belongs to the
     projects queue; everything else — visits, agreements, general — stays
     with maintenance, which has always carried the general noise. */
  const projectVisitIds = useMemo(
    () => new Set(data.projectsBoard.visits.map((v) => v.id)),
    [data.projectsBoard.visits]
  );
  const { maintFlags, projectFlags } = useMemo(() => {
    const project = data.flags.filter(
      (f) =>
        f.targetKind === "project" ||
        (f.targetKind === "visit" && f.targetId !== null && projectVisitIds.has(f.targetId))
    );
    const projectIds = new Set(project.map((f) => f.id));
    return {
      projectFlags: project,
      maintFlags: data.flags.filter((f) => !projectIds.has(f.id)),
    };
  }, [data.flags, projectVisitIds]);

  /* Each side's calendar can fold the other side in (P3). */
  const calMaint = useMemo(() => data.board.visits.map(calOfMaintenance), [data.board.visits]);
  const calProj = useMemo(
    () => data.projectsBoard.visits.map(calOfProject),
    [data.projectsBoard.visits]
  );

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
              {/* The capture pill docks by the page header on every screen
                  (D15) — outside the board element, so Display mode never
                  fullscreens a control nobody at the TV can press. */}
              <NoteCapture
                target={capture ? { kind: "visit", id: capture.visitId } : { kind: "none" }}
                targetLabel={capture?.label}
                voiceEnabled={data.voiceEnabled}
              />
              {/* data-active drives the sliding thumb, the studio idiom */}
              <nav className="segsw" aria-label="Board" data-active={TABS.findIndex((t) => t.key === tab)}>
                <span className="segsw-thumb" aria-hidden="true" />
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={"segsw-b" + (tab === t.key ? " on" : "")}
                    onClick={() => setTab(t.key)}
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
            {tab === "maintenance" ? (
              display ? (
                /* The wall composition (A10): Urgent + four weeks, LIGHT,
                   zero interactivity — not "fullscreen the current tab". */
                <MaintenanceWall data={data.board} flags={maintFlags} today={data.today} />
              ) : (
                <MaintenanceBoard
                  data={data.board}
                  flags={maintFlags}
                  today={data.today}
                  manage={data.manage}
                  connected={connected}
                  aiEnabled={data.aiEnabled}
                  calOthers={calProj}
                  sm8={
                    data.connection === "none"
                      ? null
                      : {
                          attention: data.connection === "attention",
                          syncedAt: data.synced?.finishedAt ?? null,
                          running: data.synced?.running ?? false,
                        }
                  }
                  onCaptureTarget={setCapture}
                />
              )
            ) : (
              <>
                {data.connection === "attention" && (
                  <div className="int-note bad">
                    The ServiceM8 connection needs attention — job data on this board may be stale.
                  </div>
                )}
                <ProjectsBoard
                  data={data.projectsBoard}
                  flags={projectFlags}
                  today={data.today}
                  manage={data.manage}
                  connected={connected}
                  calOthers={calMaint}
                  onCaptureTarget={setCapture}
                />
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
