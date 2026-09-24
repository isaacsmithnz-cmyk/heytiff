"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCommandPalette } from "./command-palette-context";
import { Icon } from "./icon";
import { Chevron } from "@/components/logo";
import { navFor, type NavItem } from "./nav";
import { searchPalette, type PaletteFinds } from "@/app/actions/palette";
import { SEARCH_MIN, jobSearchTerm } from "@/lib/workboard/work-search";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import type { PaletteClient, PaletteProject, PaletteStaff } from "@/lib/workboard/palette-query";
import type { Role } from "@/lib/roles-shared";
import type { Capability } from "@/lib/permissions";

/** How long typing pauses before the work is asked for. A query per letter is
    a round trip per letter, and only the last one is ever read. */
const WORK_SEARCH_DELAY_MS = 250;

/** One list, top to bottom: the arrow keys walk every group alike. */
type Row =
  | { kind: "screen"; key: string; href: string; screen: NavItem }
  | { kind: "staff"; key: string; href: string; person: PaletteStaff }
  | { kind: "client"; key: string; href: string; client: PaletteClient }
  | { kind: "project"; key: string; href: string; project: PaletteProject }
  | { kind: "job"; key: string; href: string; job: AllJobsMirrorJob };

/* "Navigate" — which is also what the footer calls moving the selection with
   the arrow keys. One word, two meanings, six inches apart. These name what
   the rows ARE; the jobs are ServiceM8's, which is whose numbers they carry. */
const GROUP: { [K in Row["kind"]]: string } = {
  screen: "Screens",
  staff: "Staff",
  client: "Clients",
  project: "Projects",
  job: "ServiceM8 jobs",
};

const NO_FINDS: PaletteFinds = { staff: [], clients: [], projects: [], jobs: [] };

/** A person opens on their staff card. */
const staffHref = (person: PaletteStaff) => `/dashboard/team/${encodeURIComponent(person.id)}`;

/** A job opens where its card lives: the Workboard, on the jobs side, with
    this job's sheet up — found in the board's window or past it. */
const jobHref = (job: AllJobsMirrorJob) =>
  `/dashboard/workboard?job=${encodeURIComponent(job.remoteId)}`;

/** A client has no page of their own. The Workboard's search, run on their
    name, is the nearest thing: every job, visit, project and photo that
    names them, grouped by the side that owns it. */
const clientHref = (client: PaletteClient) =>
  `/dashboard/workboard?q=${encodeURIComponent(client.name)}`;

const projectHref = (project: PaletteProject) =>
  `/dashboard/workboard/projects/${encodeURIComponent(project.id)}`;

/** A project's state in one word: its stage while it runs, the state itself
    once it has stopped — the Projects board's own vocabulary. */
const projectState = (p: PaletteProject) =>
  p.status === "done"
    ? "Done"
    : p.status === "blocked"
      ? "Blocked"
      : p.status === "on_hold"
        ? "On hold"
        : p.stage;

export function CommandPalette({
  role,
  caps,
}: {
  role: Role | null;
  caps: readonly Capability[];
}) {
  /* open/close live in context rather than props — this is a SERVER slot (it
     needs the viewer's capabilities to build the entry list), so it cannot
     receive client state or a callback from the frame around it. */
  const { isOpen: open, close: onClose } = useCommandPalette();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [selRaw, setSel] = useState(0);

  /* STAFF for whoever holds `team`, where a staff card opens; CLIENTS,
     PROJECTS AND JOBS for whoever can open the Workboard, where every one of
     them opens. The search behind it checks the same grants group by group;
     asking here only spares everyone else a round trip that has to come back
     empty. */
  const findsStaff = caps.includes("team");
  const findsWork = caps.includes("workboard");
  const asksServer = findsStaff || findsWork;
  /* The box says what it reaches, for this viewer. */
  const reach = [
    "screens",
    ...(findsStaff ? ["staff"] : []),
    ...(findsWork ? ["clients", "projects", "jobs"] : []),
  ];
  const reachSaid =
    reach.length === 1 ? reach[0] : `${reach.slice(0, -1).join(", ")} and ${reach[reach.length - 1]}`;
  /* The answer, with the term it answers. A list is only shown under the
     question it was asked for, so a slow answer can never paint itself under
     a box that has moved on — and the sequence below means only the newest
     question may answer at all. */
  const [work, setWork] = useState<{ term: string; finds: PaletteFinds } | null>(null);
  const workSeq = useRef(0);
  const workTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const term = asksServer ? jobSearchTerm(query) : "";
  const asking = term.length >= SEARCH_MIN;
  const answered = !asking || work?.term === term;
  const finds = asking && work?.term === term ? work.finds : NO_FINDS;

  const screens = useMemo(() => {
    const q = query.trim().toLowerCase();
    return navFor({ caps: new Set(caps), role }).filter(
      (n) => !q || `${n.label} ${n.hint}`.toLowerCase().includes(q)
    );
  }, [query, role, caps]);

  /* Screens first — the palette's first job is still getting about — then
     the people, then the work from the broadest answer to the narrowest: a
     client, their projects, the jobs. */
  const rows = useMemo<Row[]>(
    () => [
      ...screens.map((s): Row => ({ kind: "screen", key: `screen:${s.key}`, href: s.href, screen: s })),
      ...finds.staff.map(
        (p): Row => ({ kind: "staff", key: `staff:${p.id}`, href: staffHref(p), person: p })
      ),
      ...finds.clients.map(
        (c): Row => ({ kind: "client", key: `client:${c.uuid}`, href: clientHref(c), client: c })
      ),
      ...finds.projects.map(
        (p): Row => ({ kind: "project", key: `project:${p.id}`, href: projectHref(p), project: p })
      ),
      ...finds.jobs.map((j): Row => ({ kind: "job", key: `job:${j.remoteId}`, href: jobHref(j), job: j })),
    ],
    [screens, finds]
  );

  /* The highlighted row, clamped as you read it rather than corrected after the
     fact. Typing shortens the list, which can strand the selection past the
     end; an effect that wrote the selection back would render the stale row
     once before fixing it. Derived, it is never wrong for even one frame. */
  const sel = rows.length ? Math.min(selRaw, rows.length - 1) : 0;

  /* Reopening starts clean. Done while rendering the change rather than in an
     effect: this is state derived from `open`, and an effect would paint the
     previous session's query for a frame first. The palette stays mounted when
     closed (it animates on a class), so without this the old text would still
     be sitting there next time. */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setSel(0);
    }
  }

  // focusing the input is a DOM effect, and stays one
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open]);

  /* Closing abandons whatever was on its way: the timer goes, and the
     sequence moves on so an answer already in flight lands on nothing. */
  useEffect(() => {
    if (!open) return;
    return () => {
      if (workTimer.current) clearTimeout(workTimer.current);
      workSeq.current += 1;
    };
  }, [open]);

  /* Asked from the change handler, not an effect: the effect version sets
     state in an effect body, and the Workboard's own box learned that first. */
  const ask = (q: string) => {
    setQuery(q);
    setSel(0);
    if (!asksServer) return;
    if (workTimer.current) clearTimeout(workTimer.current);
    const mine = ++workSeq.current;
    const wanted = jobSearchTerm(q);
    if (wanted.length < SEARCH_MIN) return;
    workTimer.current = setTimeout(() => {
      void searchPalette(wanted)
        .then((found) => {
          if (mine === workSeq.current) setWork({ term: wanted, finds: found });
        })
        /* A failed ask answers "none", or the list would say it was still
           searching for as long as the palette stayed open. */
        .catch(() => {
          if (mine === workSeq.current) setWork({ term: wanted, finds: NO_FINDS });
        });
    }, WORK_SEARCH_DELAY_MS);
  };

  /* Declared ABOVE the key handler, and memoised, because it is one of its
     dependencies. As a bare function declaration it was a new value every
     render — hoisting made it reachable from the effect, which is exactly why
     the missing dependency went unnoticed — and naming it in the array would
     then have torn down and re-added the window listener on every keystroke,
     since `query` re-renders this component as you type. */
  const run = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router]
  );

  useEffect(() => {
    if (!open) return;
    /* The arrow keys can walk past the list's fold now that the work makes
       it long, so the row they land on is brought into view. Only the keys do
       this: scrolling under a resting pointer would hand the hover to the
       next row, and that row would scroll again. */
    const pick = (next: number) => {
      setSel(next);
      listRef.current?.querySelectorAll<HTMLElement>(".crow")[next]?.scrollIntoView?.({ block: "nearest" });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rows.length) pick((sel + 1) % rows.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rows.length) pick((sel - 1 + rows.length) % rows.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const row = rows[sel];
        if (row) run(row.href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, rows, sel, onClose, run]);

  return (
    <div className={`fg-cmd${open ? " open" : ""}`} id="fg-cmd">
      <div className="ov" onClick={onClose} />
      <div className="box">
        <div className="cin">
          <span className="ci">
            <Icon name="search" size={20} />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => ask(e.target.value)}
            placeholder={asksServer ? `Search ${reachSaid}…` : "Jump to a screen…"}
            aria-label={asksServer ? `Search ${reachSaid}` : "Jump to a screen"}
            autoComplete="off"
          />
          <kbd className="esc">ESC</kbd>
        </div>

        <div className="clist no-sb" id="fg-cmd-list" ref={listRef}>
          {rows.length === 0 ? (
            /* Says what it is doing while the work is still being asked
               for — never "no match" before it has had its say. */
            <div className="cempty">
              <b>
                {!answered
                  ? "Searching…"
                  : asking
                    ? <>Nothing matches &ldquo;{query}&rdquo;</>
                    : <>No screen matches &ldquo;{query}&rdquo;</>}
              </b>
            </div>
          ) : (
            rows.map((r, i) => (
              <Fragment key={r.key}>
                {(i === 0 || rows[i - 1].kind !== r.kind) && <div className="cgl">{GROUP[r.kind]}</div>}
                <button
                  className={`crow${i === sel ? " on" : ""}`}
                  onMouseMove={() => i !== sel && setSel(i)}
                  onClick={() => run(r.href)}
                  type="button"
                >
                  {r.kind === "screen" ? (
                    <>
                      <span className="ci2" style={{ background: `${r.screen.accent}15` }}>
                        <span style={{ color: r.screen.accent, display: "flex" }}>
                          <Icon name={r.screen.icon} size={17} />
                        </span>
                      </span>
                      <span className="ck">
                        <b>{r.screen.label}</b>
                        <em>{r.screen.hint}</em>
                      </span>
                    </>
                  ) : r.kind === "staff" ? (
                    <>
                      <span className="ci2 find who" aria-hidden>
                        {r.person.initials}
                      </span>
                      <span className="ck">
                        <b>{r.person.known ? `${r.person.name} (${r.person.known})` : r.person.name}</b>
                        {r.person.title && <em>{r.person.title}</em>}
                      </span>
                      {!r.person.active && <span className="cst">Inactive</span>}
                    </>
                  ) : r.kind === "client" ? (
                    <>
                      <span className="ci2 find">
                        <Icon name="user" size={17} />
                      </span>
                      <span className="ck">
                        <b>{r.client.name}</b>
                        {r.client.address && <em>{r.client.address}</em>}
                      </span>
                    </>
                  ) : r.kind === "project" ? (
                    <>
                      <span className="ci2 find">
                        <Icon name="folder" size={17} />
                      </span>
                      <span className="ck">
                        <b>{r.project.name}</b>
                        <em>
                          {[r.project.clientName, r.project.siteLabel].filter(Boolean).join(", ") ||
                            "No client"}
                        </em>
                      </span>
                      <span className="cst">{projectState(r.project)}</span>
                    </>
                  ) : (
                    <>
                      <span className="ci2 find">
                        <Icon name="file" size={17} />
                      </span>
                      <span className="ck">
                        <b>
                          {r.job.jobNumber && <span className="cno">#{r.job.jobNumber}</span>}
                          {r.job.jobNumber && " "}
                          {r.job.clientName ?? "Unnamed client"}
                        </b>
                        <em>{r.job.description ?? r.job.suburb ?? "No description"}</em>
                      </span>
                      <span className="cst">{r.job.status ?? "Job"}</span>
                    </>
                  )}
                  <span className="cen">
                    <Icon name="cornerDL" size={14} />
                  </span>
                </button>
              </Fragment>
            ))
          )}
        </div>

        <div className="cfoot">
          <div className="cf-l">
            <span style={{ display: "flex" }}>
              <Icon name="arrowUp" size={9} />
              <Icon name="arrowDown" size={9} />
            </span>{" "}
            Navigate,{" "}
            <span style={{ display: "flex" }}>
              <Icon name="cornerDL" size={9} />
            </span>{" "}
            Select
          </div>
          <div className="cf-r">
            {/* The mark, not a sparkle. This corner signs the palette, and it
                was signing it with the badge every AI tool in the market wears
                — beside the word HeyTiff, which is the one thing here that is
                actually ours. `decorative` because that word already says it:
                the mark defaults to an aria-label of "HeyTiff" and would have
                the footer read "HeyTiff HeyTiff". */}
            <span style={{ display: "flex" }}>
              <Chevron size={15} gradient decorative />
            </span>{" "}
            {/* was "HeyTiff Command" — there are no commands in it */}
            HeyTiff
          </div>
        </div>
      </div>
    </div>
  );
}
