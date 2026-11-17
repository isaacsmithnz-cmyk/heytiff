"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/parts/button";
import { Fade } from "@/components/parts/fade";
import { Empty } from "@/components/parts/states";
import { StateWord } from "@/components/parts/state";
import { Tray, ViewTabs } from "@/components/parts/tabs";
import { Icon } from "@/components/shell/icon";
import type { TodayView } from "@/lib/dashboard/home-today";
import { freeLine, teamLine, type HomeDay, type LivePerson, type TeamDay, type TeamJob } from "@/lib/dashboard/team-day";
import {
  edgeOf,
  farOnes,
  fitView,
  grouped,
  kmBetween,
  middleOf,
  panned,
  pixelOf,
  zoomed,
  type LatLng,
  type MapView,
} from "@/lib/dashboard/day-map";

/* HOME'S SCHEDULE TAB (Isaac, 17 November 2026: "default would be team
   view", "you can scroll through the next few days", then the two tabs on
   https://claude.ai/artifact/7ijojbkVbMJUGasurPCvVF and "Build it"). The
   days along the top as soft tabs (rule 29), Team or You in a tray (rule
   30) on the same line; under them the day's jobs on the left, one row
   each, and on the right the map of where they are and who's there. A
   different day changes what's in the card and nothing else: the list
   stays left, the map right, the controls where they were. Team by
   default; Home keeps the choice. */

type People = "team" | "you";

/** What the browser kept under `key`; null where it can't say. */
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** A choice the browser keeps, read as a store so the server's first draw
    and the browser's agree. */
function useKept<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const subscribe = (fn: () => void) => {
    window.addEventListener("storage", fn);
    window.addEventListener(`kept:${key}`, fn);
    return () => {
      window.removeEventListener("storage", fn);
      window.removeEventListener(`kept:${key}`, fn);
    };
  };
  const read = (): T | null => {
    const v = readStored(key);
    return allowed.includes(v as T) ? (v as T) : null;
  };
  const kept = useSyncExternalStore(subscribe, read, () => null);
  const [chosen, setChosen] = useState<T | null>(null);
  const set = (v: T) => {
    setChosen(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      /* not kept: it still shows */
    }
    window.dispatchEvent(new Event(`kept:${key}`));
  };
  return [chosen ?? kept ?? fallback, set];
}

export { useKept };

const PEOPLE: readonly { value: People; label: string }[] = [
  { value: "team", label: "Team" },
  { value: "you", label: "You" },
];

/** One job on the list: its number in its colour's box, the client, the
    suburb and who's on it, and its start with where it's up to. */
function JobRow({ job, view, today, hot, onHot }: { job: TeamJob; view: People; today: boolean; hot: boolean; onHot: (id: string | null) => void }) {
  return (
    <li className={`hm-sd-item hm-jc--${job.done ? "grey" : job.hue}${job.done ? " hm-sd-item--done" : ""}${hot ? " hm-sd-item--hot" : ""}`}>
      <Link
        href={job.href}
        className="hm-sd-row"
        onMouseEnter={() => onHot(job.id)}
        onMouseLeave={() => onHot(null)}
        onFocus={() => onHot(job.id)}
        onBlur={() => onHot(null)}
      >
        <span className="hm-jc-n">{job.number ?? "Job"}</span>
        <span className="hm-jc-t">
          <Fade className="hm-jc-client">{job.client}</Fade>
          <Fade className="hm-jc-line">{teamLine(job, view)}</Fade>
        </span>
        <span className="hm-jc-end">
          <span className="hm-jc-time">{job.time}</span>
          {today && job.state ? (
            <StateWord tone={job.state.tone}>{job.state.word}</StateWord>
          ) : job.state && job.state.tone !== "info" ? (
            <StateWord tone={job.state.tone}>{job.state.word}</StateWord>
          ) : (
            <span className="hm-sd-kind">{job.kind}</span>
          )}
        </span>
      </Link>
    </li>
  );
}

const MAP_H = 368;
const MAP_MAX_W = 640;

const mapSrc = (v: MapView, w: number, h: number) => `/api/home/day-map?lat=${v.lat}&lng=${v.lng}&z=${v.zoom}&w=${w}&h=${h}`;

/** First letters for a person beside a job: "J", or how many where more
    than one is there. */
const herePeople = (here: readonly string[]) => (here.length > 1 ? String(here.length) : (here[0] ?? "").charAt(0).toUpperCase());

/** THE MAP. Google's picture of the view under the page's own pins: a job
    still to do in its colour with its number, a done one a grey dot, who's
    clocked on beside their job, and a job off the map as a chip on the edge
    facing it, with how far it is. Drag to move it, + and − to zoom, Show
    all to fit every job. Jobs too close to read join into one count;
    pressing it zooms in. */
function DayMap({ jobs, whereNow = [], hot, onHot }: { jobs: readonly TeamJob[]; whereNow?: readonly LivePerson[]; hot: string | null; onHot: (id: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(MAP_MAX_W);
  const h = MAP_H;
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(160, Math.min(MAP_MAX_W, Math.round(e!.contentRect.width)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const placed = jobs.filter((j): j is TeamJob & { at: LatLng } => j.at !== null);
  const far = farOnes(placed.map((j) => j.at));
  const near = placed.filter((_, i) => !far[i]);
  const middle = middleOf(near.map((j) => j.at)) ?? middleOf(placed.map((j) => j.at));
  const [view, setView] = useState<MapView>(() => fitView(near.map((j) => j.at), w, h));
  /* the picture shown, and the view it is of: a new one replaces it once
     it has loaded, so the map never blinks to blank */
  const [shown, setShown] = useState<MapView>(view);
  /* no picture (Google refused, or no key): the pins on the plain ground */
  const [blank, setBlank] = useState(false);
  useEffect(() => {
    if (shown.lat === view.lat && shown.lng === view.lng && shown.zoom === view.zoom) return;
    const img = new Image();
    img.onload = () => setShown(view);
    img.src = mapSrc(view, w, h);
  }, [view, w, h, shown]);

  /* dragging: the picture and the pins follow the hand, and the view moves
     when it lets go */
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const [off, setOff] = useState({ dx: 0, dy: 0 });
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("a, button")) return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) setOff({ dx: e.clientX - drag.current.x, dy: e.clientY - drag.current.y });
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    if (off.dx !== 0 || off.dy !== 0) setView((v) => panned(v, off.dx, off.dy));
    setOff({ dx: 0, dy: 0 });
  };

  const at = (p: LatLng) => {
    const q = pixelOf(view, p, w, h);
    return { x: q.x + off.dx, y: q.y + off.dy };
  };
  /* the picture of `shown`, placed and sized for `view` */
  const k = 2 ** (shown.zoom - view.zoom);
  const c = at(shown);
  const inside = (p: { x: number; y: number }) => p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;

  const live = placed.filter((j) => !j.done && inside(at(j.at)));
  const dots = placed.filter((j) => j.done && inside(at(j.at)));
  /* a done job off the map says nothing: only what's still to do waits on the edge */
  const out = placed.filter((j) => !j.done && !inside(at(j.at)));
  const groups = grouped(live, (j) => at(j.at), 40);
  /* the chips on each edge, pushed apart so none sits on another */
  const chips = out.map((j) => ({ j, ...edgeOf(at(j.at), w, h) })).sort((a, b) => a.along - b.along);
  const used: Record<string, number[]> = {};
  const chipAt = (edge: string, along: number, span: number) => {
    if (!used[edge]) used[edge] = [];
    const taken = used[edge]!;
    /* a chip is 32 tall, and about 176 wide with its number, place and distance */
    const side = edge === "left" || edge === "right";
    const gap = side ? 40 : 184;
    const half = side ? 24 : 96;
    const want = Math.max(half, Math.min(span - half, along * span));
    /* the nearest free place along the edge, either way, inside it */
    let p = want;
    for (let i = 1; taken.some((t) => Math.abs(t - p) < gap) && i < 12; i++) {
      const step = Math.ceil(i / 2) * gap * (i % 2 ? 1 : -1);
      if (want + step >= half && want + step <= span - half) p = want + step;
    }
    taken.push(p);
    return p;
  };

  return (
    <div className="hm-map" ref={box}>
      <div
        className="hm-map-view"
        style={{ height: h }}
        role="group"
        aria-label="Map of the day's jobs"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- our own route's picture, sized by the view */}
        <img
          className={blank ? "hm-map-img hm-map-img--none" : "hm-map-img"}
          onError={() => setBlank(true)}
          onLoad={() => setBlank(false)}
          /* a picture that failed before the page woke heard no onError */
          ref={(el) => {
            if (el && el.complete && el.naturalWidth === 0 && !blank) setBlank(true);
          }}
          src={mapSrc(shown, w, h)}
          alt=""
          draggable={false}
          width={w}
          height={h}
          style={{ transform: `translate(${c.x - w / 2}px, ${c.y - h / 2}px) scale(${k})` }}
        />
        {/* where the team is now, as their phones said, where the business has it on */}
        {whereNow
          .filter((p) => inside(at(p.at)))
          .map((p) => {
            const q = at(p.at);
            const who = p.name === "you" ? "You" : p.name;
            return (
              <span
                key={`live:${p.name}`}
                className={p.name === "you" ? "hm-map-person hm-map-person--you" : "hm-map-person"}
                style={{ left: q.x, top: q.y }}
                role="img"
                aria-label={`${who}, ${p.mins < 1 ? "now" : `${p.mins} min ago`}`}
              >
                {who.charAt(0).toUpperCase()}
              </span>
            );
          })}
        {dots.map((j) => {
          const p = at(j.at);
          return <span key={j.id} className="hm-map-dot" style={{ left: p.x, top: p.y }} aria-hidden="true" />;
        })}
        {groups.map((g) => {
          if (g.items.length > 1)
            return (
              <button
                key={g.items.map((j) => j.id).join()}
                type="button"
                className="hm-map-count"
                style={{ left: g.x, top: g.y }}
                aria-label={`${g.items.length} jobs here, zoom in`}
                onClick={() => {
                  const first = g.items[0]!;
                  setView((v) => ({ lat: first.at.lat, lng: first.at.lng, zoom: zoomed(v, 1).zoom }));
                }}
              >
                {g.items.length}
              </button>
            );
          const j = g.items[0]!;
          return (
            <span key={j.id} className="hm-map-at" style={{ left: g.x, top: g.y }}>
              <Link
                href={j.href}
                className={`hm-map-pin hm-jc--${j.hue}${hot === j.id ? " hm-map-pin--hot" : ""}`}
                onMouseEnter={() => onHot(j.id)}
                onMouseLeave={() => onHot(null)}
                aria-label={`${j.number ?? "Job"}, ${j.client}`}
              >
                {j.number ?? "Job"}
              </Link>
              {j.here.length > 0 && (
                <span className="hm-map-here" aria-label={`${j.here.join(", ")} on site`}>
                  {herePeople(j.here)}
                </span>
              )}
            </span>
          );
        })}
        {chips.map(({ j, edge, along }) => {
          const p = chipAt(edge, along, edge === "left" || edge === "right" ? h : w);
          const style =
            edge === "left" ? { left: 8, top: p } : edge === "right" ? { right: 8, top: p } : edge === "top" ? { top: 8, left: p } : { bottom: 8, left: p };
          const km = middle ? Math.round(kmBetween(j.at, middle)) : null;
          return (
            <button
              key={j.id}
              type="button"
              className={`hm-map-edge hm-map-edge--${edge} hm-jc--${j.done ? "grey" : j.hue}`}
              style={style}
              onClick={() => setView((v) => ({ lat: j.at.lat, lng: j.at.lng, zoom: v.zoom }))}
            >
              <span className="hm-map-edge-n">{j.number ?? "Job"}</span>
              <span>{j.suburb ?? j.client}</span>
              {km !== null && km > 0 && <span className="hm-map-edge-km">{km} km</span>}
            </button>
          );
        })}
        <div className="hm-map-ctl">
          <Button size={32} onClick={() => setView(fitView(placed.map((j) => j.at), w, h))}>
            Show all
          </Button>
          <span className="hm-map-zoom">
            <button type="button" aria-label="Zoom in" onClick={() => setView((v) => zoomed(v, 1))}>
              +
            </button>
            <button type="button" aria-label="Zoom out" onClick={() => setView((v) => zoomed(v, -1))}>
              −
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

export function HomeSchedule({
  first,
  days,
  birthdays = [],
  unlinked = null,
}: {
  /** Today's team day, read with the page. */
  first: TeamDay;
  days: readonly HomeDay[];
  /** Whose birthday it is today, from those who share it. */
  birthdays?: readonly string[];
  /** What You says where ServiceM8 doesn't know who the viewer is. */
  unlinked?: TodayView["empty"] | null;
}) {
  const [day, setDay] = useState(first.day);
  const [people, setPeople] = useKept<People>("heytiff.home.people.v1", ["team", "you"], "team");
  const [read, setRead] = useState<Record<string, TeamDay | "reading" | "failed">>({ [first.day]: first });
  const [hot, setHot] = useState<string | null>(null);
  const got = read[day];
  /* a day is read when it is first pressed, and kept for the visit */
  const go = (d: string) => {
    setDay(d);
    if (read[d] !== undefined && read[d] !== "failed") return;
    setRead((r) => ({ ...r, [d]: "reading" }));
    fetch(`/api/home/team-day?day=${d}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<TeamDay>) : Promise.reject(new Error(String(r.status)))))
      .then((t) => setRead((r) => ({ ...r, [d]: t })))
      .catch(() => setRead((r) => ({ ...r, [d]: "failed" })));
  };

  const label = days.find((d) => d.day === day)?.label ?? day;
  const team = typeof got === "object" ? got : null;
  const jobs = team ? (people === "you" ? team.jobs.filter((j) => j.mine) : team.jobs) : [];
  const free = team && people === "team" ? freeLine(team.free) : null;
  const when = label === "Today" ? "today" : `on ${label}`;

  let list;
  if (got === "reading" || got === undefined) list = <p className="hm-sd-note">Reading {label === "Today" ? "today" : label}</p>;
  else if (got === "failed")
    list = <Empty what={`${label} couldn't be read`} line="Try another day, or open the Schedule" action={<Button href="/dashboard/schedule">Open Schedule</Button>} />;
  else if (people === "you" && unlinked && team && !team.linked)
    list = (
      <Empty
        what={unlinked.what}
        line={unlinked.line ?? undefined}
        action={unlinked.action ? <Button href={unlinked.action.href}>{unlinked.action.label}</Button> : null}
      />
    );
  else if (jobs.length === 0) list = <Empty what={people === "you" ? `Nothing booked for you ${when}` : `Nothing booked ${when}`} action={null} />;
  else
    list = (
      <ul className="hm-sd-rows" aria-label={`Jobs ${when}`}>
        {jobs.map((j) => (
          <JobRow key={j.id} job={j} view={people} today={!!team?.today} hot={hot === j.id} onHot={setHot} />
        ))}
      </ul>
    );

  const mapped = jobs.some((j) => j.at !== null);
  return (
    <div className="hm-tabpanel" id="hm-panel-schedule" role="tabpanel" aria-labelledby="hm-tab-schedule">
      <div className="hm-sub">
        <ViewTabs items={days.map((d) => ({ key: d.day, label: d.label }))} current={day} onGo={go} ariaLabel="Day" />
        <span className="hm-sub-end">
          <Tray options={PEOPLE} value={people} onChange={setPeople} ariaLabel="Whose day" />
        </span>
      </div>
      <div className={mapped ? "hm-sd" : "hm-sd hm-sd--nomap"}>
        <div className="hm-sd-list">
          {free && <p className="hm-sd-note">{free}</p>}
          {team?.today && birthdays.length > 0 && (
            <ul className="hm-bdays" aria-label="Birthdays">
              {birthdays.map((words, i) => (
                <li key={`${words}-${i}`} className="hm-bday">
                  <Icon name="star" size={16} />
                  <span>{words}</span>
                </li>
              ))}
            </ul>
          )}
          {list}
        </div>
        {mapped && (
          <DayMap
            key={`${day}:${people}`}
            jobs={jobs}
            whereNow={team?.today ? (people === "you" ? team.live.filter((p) => p.name === "you") : team.live) : []}
            hot={hot}
            onHot={setHot}
          />
        )}
      </div>
    </div>
  );
}
