"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { RadarItem } from "@/lib/workboard/maintenance-query";
import type { WorkboardData } from "@/lib/workboard/page-data";

/* The Workboard Overview — the shared "what's on" surface.

   Desktop-first, big-screen ready: DISPLAY MODE fullscreens the board
   element itself (the browser renders just that subtree), flips it dark with
   wall-readable type via the :fullscreen styles in shell.css, and refreshes
   the data every minute while it's up. No new route, no token — the person
   at the TV signed in like anyone else, and closing fullscreen is Esc.

   Standalone-first: with no ServiceM8 connection the board says exactly
   that and keeps working — the SM8-derived strips are absent, not broken. */

const REFRESH_MS = 60_000;

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

const BUCKETS: [RadarItem["bucket"], string][] = [
  ["overdue", "Overdue"],
  ["due_soon", "Due soon"],
  ["upcoming", "Coming up"],
];

function RadarGroups({ radar, today }: { radar: RadarItem[]; today: string }) {
  return (
    <>
      {BUCKETS.map(([bucket, title]) => {
        const items = radar.filter((r) => r.bucket === bucket);
        if (items.length === 0) return null;
        return (
          <div className="wb-day" key={bucket}>
            <div className="wb-dayhead">{title}</div>
            {items.map((r) => (
              <Link
                href={`/dashboard/workboard/maintenance/${r.agreementId}`}
                className={"wb-row" + (bucket === "overdue" ? " wb-pulse" : "")}
                key={r.visitId}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <span className={"wb-chip" + (bucket === "overdue" ? " bad" : bucket === "due_soon" ? "" : " on")}>
                  {r.dueDate === today ? "Today" : fmtAuWeekdayDayMonth(r.dueDate)}
                </span>
                <span className="wb-who">
                  <b>{r.label}</b>
                  <em> · {r.clientName}</em>
                  {r.siteLabel && <em> · {r.siteLabel}</em>}
                </span>
                {r.jobNumber && <span className="wb-chip">#{r.jobNumber}</span>}
                <span
                  className={"wb-chip" + (r.ready === r.readyTotal ? " on" : bucket !== "upcoming" ? " bad" : "")}
                  title="Access · time · parts · customer"
                >
                  {r.ready}/{r.readyTotal} ready
                </span>
              </Link>
            ))}
          </div>
        );
      })}
    </>
  );
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

export function OverviewScreen({ data }: { data: WorkboardData }) {
  const router = useRouter();
  const boardRef = useRef<HTMLDivElement>(null);
  const [display, setDisplay] = useState(false);

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

  /* Group the bookings by day once — the board reads as a run sheet. */
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
                Projects, maintenance and the week&apos;s bookings — one board.
              </p>
            </div>
            <button className="pbtn ghost" onClick={toDisplay} title="Fullscreen for a wall screen">
              <Icon name="maximize" size={16} />
              Display mode
            </button>
          </div>

          <div className="wb-board" ref={boardRef}>
            {data.connection === "attention" && (
              <div className="int-note bad">
                The ServiceM8 connection needs attention — job data on this board may be stale.
              </div>
            )}

            {connected && data.counts && (
              <div className="wb-stats">
                <div className="wb-stat">
                  <b>{data.counts.quotes}</b>
                  <em>Open quotes</em>
                </div>
                <div className="wb-stat">
                  <b>{data.counts.workOrders}</b>
                  <em>Work orders</em>
                </div>
                <div className="wb-stat">
                  <b>{data.counts.completedFortnight}</b>
                  <em>Completed — last 14 days</em>
                </div>
              </div>
            )}

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

            {!connected && data.connection === "none" && (
              <div className="card2">
                <div className="c2h">
                  <span className="ci">
                    <Icon name="servicem8" size={19} />
                  </span>
                  <div>
                    <b>Running standalone</b>
                    <em>
                      The Workboard works without any integration — projects and maintenance are
                      typed in and tracked here. Connecting ServiceM8 fills this board with live
                      jobs, clients and bookings.
                    </em>
                  </div>
                </div>
                {data.manage && (
                  <p className="int-hint">
                    An owner can connect it under{" "}
                    <Link href="/dashboard/admin/integrations/servicem8" className="ro-link">
                      Admin → Integrations → ServiceM8
                    </Link>
                    .
                  </p>
                )}
              </div>
            )}

            {/* projects in flight */}
            <div className="card2">
              <div className="c2h">
                <span className="ci">
                  <Icon name="layers" size={19} />
                </span>
                <div>
                  <b>Projects in flight</b>
                  <em>Stage and checklist progress, straight off each project.</em>
                </div>
                <Link
                  href="/dashboard/workboard/projects"
                  className="pbtn ghost"
                  style={{ marginLeft: "auto" }}
                >
                  All projects
                </Link>
              </div>
              {data.projects.length === 0 ? (
                <p className="int-hint">
                  Nothing on the go{data.manage ? " — start one under All projects" : ""}.
                </p>
              ) : (
                <div className="wb-strip">
                  {data.projects.map((p) => (
                    <Link
                      href={`/dashboard/workboard/projects/${p.id}`}
                      className="wb-row"
                      key={p.id}
                      style={{ textDecoration: "none", color: "inherit" }}
                    >
                      <span className="wb-who">
                        <b>{p.name}</b>
                        {p.clientName && <em> · {p.clientName}</em>}
                      </span>
                      <span className="wb-chip on">{p.stage}</span>
                      <div className="wb-bar">
                        <span style={{ width: `${p.percent}%` }} />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* the maintenance radar — the reason the wall screen exists */}
            <div className="card2">
              <div className="c2h">
                <span className="ci">
                  <Icon name="rotate" size={19} />
                </span>
                <div>
                  <b>Maintenance radar</b>
                  <em>Overdue first — those breathe red until someone deals with them.</em>
                </div>
                <Link
                  href="/dashboard/workboard/maintenance"
                  className="pbtn ghost"
                  style={{ marginLeft: "auto" }}
                >
                  All agreements
                </Link>
              </div>
              {data.radar.length === 0 ? (
                <p className="int-hint">
                  Nothing on the radar{data.manage ? " — set up an agreement under All agreements" : ""}.
                </p>
              ) : (
                <RadarGroups radar={data.radar} today={data.today} />
              )}
            </div>

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
