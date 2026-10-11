"use client";

import * as links from "@/lib/shell/links";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useCommandPalette } from "./command-palette-context";
import { WindowsContext, titleOf, useRecords, type RecentRecord } from "@/components/records/records-context";
import { recordHref } from "@/lib/records/ref";
import { useTiff } from "@/components/tiff/modal/tiff-context";
import { sm8JobUrl } from "@/lib/integrations/sm8-links";
import { OverlayWhileOpen } from "@/components/overlay/use-overlay";
import { Icon } from "./icon";
import { TiffGlyph } from "@/components/notes/tiff-mark";
import { navFor, type NavItem } from "./nav";
import { searchPalette, type PaletteFinds } from "@/app/actions/palette";
import type { PhotoHit } from "@/app/actions/photo-search";
import { setJobPhotoFavourite } from "@/app/actions/job-photo-favourites";
import { snippet } from "@/lib/workboard/photo-search";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { SEARCH_MIN, jobSearchTerm } from "@/lib/workboard/work-search";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import type { PaletteClient, PaletteProject, PaletteStaff } from "@/lib/workboard/palette-query";
import type { Role } from "@/lib/roles-shared";
import type { Capability } from "@/lib/permissions";

/* The photo viewer loads when a photo is first chosen, not with the frame:
   this palette rides every screen, and the viewer is weight nobody should
   pay for until they open a picture. */
const PalettePhotoViewer = dynamic(
  () => import("./palette-photo-viewer").then((m) => m.PalettePhotoViewer),
  { ssr: false }
);

/** How long typing pauses before the work is asked for. A query per letter is
    a round trip per letter, and only the last one is ever read. */
const WORK_SEARCH_DELAY_MS = 250;

/** One list, top to bottom: the arrow keys walk every group alike. A photo
    is the one row that goes nowhere — it opens over the screen you are on —
    so it carries its place among the photos instead of an address. A verb
    is something to do to the card open under the palette; a recent record
    is one opened lately; the last row hands the words to Tiff. */
type Row =
  | { kind: "verb"; key: string; href: null; label: string; icon: string; keys?: string; act: () => void }
  | { kind: "recent"; key: string; href: string; recent: RecentRecord }
  | { kind: "tiff"; key: string; href: null; words: string }
  | { kind: "screen"; key: string; href: string; screen: NavItem }
  | { kind: "staff"; key: string; href: string; person: PaletteStaff }
  | { kind: "client"; key: string; href: string; client: PaletteClient }
  | { kind: "project"; key: string; href: string; project: PaletteProject }
  | { kind: "job"; key: string; href: string; job: AllJobsMirrorJob }
  | { kind: "photo"; key: string; href: null; photo: PhotoHit; at: number };

/* "Navigate" — which is also what the footer calls moving the selection with
   the arrow keys. One word, two meanings, six inches apart. These name what
   the rows ARE; the jobs are ServiceM8's, which is whose numbers they carry. */
const GROUP: { [K in Row["kind"]]: string } = {
  verb: "This job",
  recent: "Recent",
  tiff: "Tiff",
  screen: "Screens",
  staff: "Staff",
  client: "Clients",
  project: "Projects",
  job: "ServiceM8 jobs",
  photo: "Photos",
};

const NO_FINDS: PaletteFinds = { staff: [], clients: [], projects: [], jobs: [], photos: [] };

/** Whose job a photo is from and when — the Workboard's own photo caption. */
const photoOrigin = (h: PhotoHit) =>
  [
    h.jobNumber ? `#${h.jobNumber}` : null,
    h.clientName,
    h.takenAt ? fmtAuWeekdayDayMonth(h.takenAt.slice(0, 10)) : null,
  ]
    .filter(Boolean)
    .join(", ");

/* Where each record opens: one set of links, shared with Tiff's open_record
   (lib/shell/links), so the two doors never land in different places. */
const staffHref = (person: PaletteStaff) => links.staffHref(person.id);
const jobHref = (job: AllJobsMirrorJob) => links.jobHref(job.remoteId);
const clientHref = (client: PaletteClient) => links.clientHref(client.name);
const projectHref = (project: PaletteProject) => links.projectHref(project.id);

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
  const records = useRecords();
  const tiff = useTiff();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
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
    ...(findsWork ? ["clients", "projects", "jobs", "photos"] : []),
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

  /* THE JOB UNDER THE PALETTE. Opened over a job card, the palette leads
     with what can be done to that job: the card's own Set aside and Next
     job, its link to send someone, and the job in ServiceM8. Typing narrows
     them like everything else. */
  const windows = useContext(WindowsContext);
  const front = windows?.windows.find((w) => !w.aside) ?? null;
  const verbs = useMemo<Row[]>(() => {
    if (!windows || !front) return [];
    const verb = (key: string, label: string, icon: string, act: () => void, keys?: string): Row => ({
      kind: "verb",
      key: `verb:${key}`,
      href: null,
      label,
      icon,
      act,
      ...(keys ? { keys } : {}),
    });
    const sm8 = front.ref.kind === "job" ? sm8JobUrl(front.ref.id) : null;
    const noun = front.ref.kind;
    const all = [
      ...(windows.docked ? [verb("aside", "Set aside", "minus", () => windows.setAside(front.key))] : []),
      ...(windows.stepOf(front.key, 1) ? [verb("next", "Next job", "chevR", () => windows.step(front.key, 1), "J")] : []),
      verb("link", `Copy the link to this ${noun}`, "send", () => {
        const link = `${window.location.origin}${recordHref(front.ref)}`;
        void (navigator.clipboard?.writeText(link) ?? Promise.reject()).then(
          () => windows.toast("Link copied."),
          () => windows.toast("Could not copy the link"),
        );
      }),
      ...(sm8 ? [verb("sm8", "Open in ServiceM8", "servicem8", () => window.open(sm8, "_blank", "noopener"))] : []),
    ];
    const q = query.trim().toLowerCase();
    return q ? all.filter((v) => v.kind === "verb" && v.label.toLowerCase().includes(q)) : all;
  }, [windows, front, query]);

  /* RECENT: the jobs opened lately, while nothing is typed — the way back
     to the one you had a minute ago. */
  const recents = useMemo<Row[]>(
    () =>
      query.trim() || !windows
        ? []
        : windows.recent
            .filter((r) => r.key !== front?.key)
            .map((r): Row => ({ kind: "recent", key: `recent:${r.key}`, href: recordHref(r.ref), recent: r })),
    [query, windows, front],
  );

  /* Screens first — the palette's first job is still getting about — then
     the people, then the work from the broadest answer to the narrowest: a
     client, their projects, the jobs. Under all of it, the words as they
     stand, for Tiff. */
  const words = query.trim();
  const rows = useMemo<Row[]>(
    () => [
      ...verbs,
      ...recents,
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
      ...finds.photos.map(
        (h, at): Row => ({ kind: "photo", key: `photo:${h.remoteId}`, href: null, photo: h, at })
      ),
      ...(words ? [{ kind: "tiff", key: "tiff", href: null, words } satisfies Row] : []),
    ],
    [verbs, recents, screens, finds, words]
  );

  /* THE PHOTO BEING READ, over whatever screen the palette was opened on. A
     SNAPSHOT of the hits at the moment one was chosen — the palette closes
     behind it, and nothing typed later can reshuffle the roll. The stars are
     owned here for the same reason the Workboard owns its own: the viewer's
     star is the same act as the gallery's, and it has to start at the truth. */
  const [viewing, setViewing] = useState<{ items: readonly PhotoHit[]; index: number } | null>(
    null
  );
  const [stars, setStars] = useState<ReadonlySet<string>>(new Set());
  const closeViewer = useCallback(() => setViewing(null), []);
  const navViewer = useCallback(
    (index: number) => setViewing((cur) => (cur ? { ...cur, index } : cur)),
    []
  );
  const star = (remoteId: string) => {
    const hit = viewing?.items.find((h) => h.remoteId === remoteId);
    if (!hit) return;
    const on = !stars.has(remoteId);
    const paint = (next: boolean) =>
      setStars((cur) => {
        const set = new Set(cur);
        if (next) set.add(remoteId);
        else set.delete(remoteId);
        return set;
      });
    paint(on);
    void setJobPhotoFavourite(hit.jobUuid, remoteId, on)
      .then((res) => {
        if (!res.ok) paint(res.starred);
      })
      .catch(() => paint(!on));
  };

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
      // the palette asked for again is the photo put down
      setViewing(null);
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
  const choose = useCallback(
    (row: Row) => {
      onClose();
      const searchbtn = document.querySelector<HTMLElement>(".topbar .searchbtn");
      if (row.kind === "verb") {
        row.act();
      } else if (row.kind === "recent") {
        records.open(row.recent.ref, { from: searchbtn });
      } else if (row.kind === "tiff") {
        /* The words go to Tiff as the first thing said, the way "Sort it
           out" hands over what was typed in a box. */
        tiff.open({ from: searchbtn ?? document.body, words: row.words });
      } else if (row.kind === "photo") {
        setStars(new Set(finds.photos.filter((h) => h.starred).map((h) => h.remoteId)));
        setViewing({ items: finds.photos, index: row.at });
      } else if (row.kind === "job") {
        /* A job opens OVER the screen you are on, in the record host — not
           by sending you to the Workboard. Focus goes back to the search
           button that opened the palette, and the jobs it found come with
           it, so the card steps through them (Next job). */
        const jobs = finds.jobs.map((j) => j.remoteId);
        records.open(
          { kind: "job", id: row.job.remoteId },
          {
            from: searchbtn,
            ...(jobs.length > 1 ? { list: jobs } : {}),
          }
        );
      } else {
        router.push(row.href);
      }
    },
    [onClose, router, records, tiff, finds]
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
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rows.length) pick((sel + 1) % rows.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rows.length) pick((sel - 1 + rows.length) % rows.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const row = rows[sel];
        if (row) choose(row);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, rows, sel, onClose, choose]);

  /* The rows in their groups, each group a run of one kind, so a screen
     reader hears which group a row is in. The index is the row's place in
     the whole list, which is what the arrow keys walk. */
  const groups = rows.reduce<{ kind: Row["kind"]; at: number; rows: Row[] }[]>((gs, r, i) => {
    const last = gs[gs.length - 1];
    if (last && last.kind === r.kind) last.rows.push(r);
    else gs.push({ kind: r.kind, at: i, rows: [r] });
    return gs;
  }, []);
  const optionId = (i: number) => `fg-cmd-o-${i}`;

  return (
    <>
    {open &&
      createPortal(
        /* OVER EVERYTHING WHILE IT IS OPEN, a job card included: drawn at the
           end of <body> when it is asked for, in the frame's own dress, so ⌘K
           over a card lands on top of it rather than under it. */
        <div className="fg" style={{ display: "contents" }}>
    <div className="fg-cmd open" id="fg-cmd">
      <div className="ov" onClick={onClose} />
      {/* Escape closes the palette, and only the palette, even over a job
          card (the overlay stack). Tab stays inside it. */}
      <OverlayWhileOpen of={boxRef} onEscape={onClose} />
      <div className="box" ref={boxRef}>
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
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls="fg-cmd-list"
            aria-autocomplete="list"
            aria-activedescendant={rows.length ? optionId(sel) : undefined}
          />
          <kbd className="esc">ESC</kbd>
        </div>

        <div className="clist no-sb" id="fg-cmd-list" ref={listRef} role="listbox" aria-label="Found">
          {/* Says what it is doing while the work is still being asked
              for — never "no match" before it has had its say. Asking Tiff
              is offered under it, so the box is never a dead end. */}
          {rows.every((r) => r.kind === "tiff") && (
            <div className="cempty" role="presentation">
              <b>
                {!answered
                  ? "Searching…"
                  : asking
                    ? <>Nothing matches &ldquo;{query}&rdquo;</>
                    : <>No screen matches &ldquo;{query}&rdquo;</>}
              </b>
            </div>
          )}
          {groups.map((g) => (
              <div key={g.kind} className="cgroup" role="group" aria-labelledby={`fg-cmd-g-${g.kind}`}>
                <div className="cgl" id={`fg-cmd-g-${g.kind}`}>
                  {g.kind === "verb" && front ? titleOf(front.body).title : GROUP[g.kind]}
                </div>
                {g.rows.map((r, j) => {
                  const i = g.at + j;
                  return (
                <button
                  key={r.key}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === sel}
                  tabIndex={-1}
                  className={`crow${i === sel ? " on" : ""}`}
                  onMouseMove={() => i !== sel && setSel(i)}
                  onClick={() => choose(r)}
                  type="button"
                >
                  {r.kind === "verb" ? (
                    <>
                      <span className="ci2 find">
                        <Icon name={r.icon} size={17} />
                      </span>
                      <span className="ck">
                        <b>{r.label}</b>
                      </span>
                      {r.keys && <kbd className="ckey">{r.keys}</kbd>}
                    </>
                  ) : r.kind === "recent" ? (
                    <>
                      <span className="ci2 find">
                        <Icon name="clock" size={17} />
                      </span>
                      <span className="ck">
                        <b>{r.recent.title}</b>
                        {r.recent.sub && <em>{r.recent.sub}</em>}
                      </span>
                    </>
                  ) : r.kind === "tiff" ? (
                    <>
                      <span className="ci2 find" aria-hidden>
                        <TiffGlyph size={17} />
                      </span>
                      <span className="ck">
                        <b>Ask Tiff</b>
                        <em>{r.words}</em>
                      </span>
                    </>
                  ) : r.kind === "screen" ? (
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
                  ) : r.kind === "photo" ? (
                    <>
                      <span className="ci2 find shot" aria-hidden>
                        {r.photo.url ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={r.photo.url} alt="" loading="lazy" />
                        ) : (
                          <Icon name="cam" size={17} />
                        )}
                      </span>
                      <span className="ck">
                        <b>{r.photo.caption || r.photo.name}</b>
                        {/* WHY IT MATCHED, when the words are on the equipment in
                            the frame — the Workboard's panel says the same. */}
                        <em>
                          {r.photo.match.transcript
                            ? snippet(r.photo.ocrText, term)
                            : photoOrigin(r.photo) || "No job"}
                        </em>
                      </span>
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
                  );
                })}
              </div>
            ))}
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
              <TiffGlyph size={20} />
            </span>{" "}
            {/* was "HeyTiff Command" — there are no commands in it */}
            HeyTiff
          </div>
        </div>
      </div>
    </div>
        </div>,
        document.body,
      )}
    {viewing && (
      <PalettePhotoViewer
        items={viewing.items}
        index={viewing.index}
        starred={stars}
        onNav={navViewer}
        onStar={star}
        onClose={closeViewer}
      />
    )}
    </>
  );
}
