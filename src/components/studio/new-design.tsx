"use client";

/* NEW DESIGN (v2, 19 October; the boards studio-new, studio-pick,
   studio-peek, studio-floors, studio-crop and studio-cropped at
   https://claude.ai/artifact/JJX25x6p7UB4Fd4fHSrkMr). One dialog from the
   job to the canvas:

     1. the job (its street names the design), the name, and the plans
        dropped in; or Start with a blank canvas;
     2. a set of more than three pages opens as a lightbox of its pages,
        nothing ticked: tick the floor plans, open any one large;
     3. the floors, one row a page, levelled in page order from the ground
        up. A page with several plans on it is cropped here, piece by piece,
        before the canvas: each box drawn becomes a floor holding only its
        box, and what no box covers is left off;
     4. Start design uploads the plans and opens the canvas on the lowest
        floor. Calibration there is exactly as it was.

   The pages are read in the browser by the Studio's own reader
   (plans.ts), and stored by the same PlanImages as the old Plans step. */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, IconButton } from "@/components/parts/button";
import { Dot } from "@/components/parts/state";
import { Chooser } from "@/components/parts/chooser";
import { Dialog } from "@/components/parts/dialog";
import { Field, TextInput } from "@/components/parts/field";
import { Icon } from "@/components/shell/icon";
import type { Floor, PlanImport, PlanImportSource } from "@/lib/studio/document";
import { prefillFromJob, type JobPrefill, type StudioJobHit } from "@/lib/studio/job-link";
import {
  boxFrom,
  boxesOf,
  cropInto,
  draftName,
  draftsFor,
  floorsFrom,
  importFrom,
  LEVELS,
  nextLevel,
  pagesWord,
  PICK_OVER,
  wordsFrom,
  type FloorDraft,
} from "@/lib/studio/new-design";
import { defaultFloorName, imageToPage, labelPagesSequentially, pdfPagesAt, pdfToPages, type PageImage, type PlanImages } from "@/lib/studio/plans";
import type { TrimRect } from "@/lib/studio/plan-trim";
import { JobSearchField, type JobSearch } from "./job-search";

type Stage = "start" | "reading" | "pages" | "peek" | "floors" | "crop";
type Source = { kind: "pdf" | "image"; file: File };
type Busy = { word: string; done: number; total: number };

const LEVEL_OPTIONS = LEVELS.map((l) => ({ value: String(l), label: defaultFloorName(l) }));

/* Reads every dropped file into pages. Out here, not in the component: a
   loop inside a try is a React Compiler bail. */
async function readFiles(files: File[], onProgress: (done: number, total: number) => void) {
  const pages: PageImage[] = [];
  const sources: Source[] = [];
  for (const f of files) {
    if (f.type === "application/pdf") {
      pages.push(...(await pdfToPages(f, onProgress, { preview: true })));
      sources.push({ kind: "pdf", file: f });
    } else if (f.type.startsWith("image/")) {
      pages.push(await imageToPage(f));
      sources.push({ kind: "image", file: f });
    }
  }
  labelPagesSequentially(pages);
  return { pages, sources };
}

/* The chosen pages drawn in full, in place of their previews. Out here for
   the same reason: a loop. */
async function fullPages(pages: PageImage[], chosen: number[], onProgress: (done: number, total: number) => void): Promise<PageImage[]> {
  const out = [...pages];
  const todo = chosen.filter((i) => out[i].previewOf);
  let done = 0;
  for (const i of todo) {
    onProgress(done, todo.length);
    const [full] = await pdfPagesAt(out[i].previewOf!, [out[i].pageNumber ?? 1]);
    out[i] = { ...full, label: out[i].label };
    done = done + 1;
  }
  return out;
}

/* Stores the files and the pages the floors use, then makes the floors.
   Out here for the same reason. */
async function storePlans(
  planImages: PlanImages,
  sources: Source[],
  pages: PageImage[],
  drafts: FloorDraft[],
  onProgress: (done: number, total: number) => void,
): Promise<{ floors: Floor[]; planImport: PlanImport }> {
  const used = [...new Set(drafts.map((d) => d.page))].sort((a, b) => a - b);
  const total = sources.length + used.length;
  let done = 0;
  const stored: PlanImportSource[] = [];
  for (const s of sources) {
    onProgress(done, total);
    stored.push({ ref: await planImages.uploadSource(s.file), kind: s.kind });
    done = done + 1;
  }
  const refs: Record<number, string> = {};
  for (const i of used) {
    onProgress(done, total);
    refs[i] = await planImages.upload(pages[i]);
    done = done + 1;
  }
  const words = wordsFrom(pages, drafts);
  const planImport = importFrom(stored, drafts, refs);
  return { floors: floorsFrom(drafts, pages, refs), planImport: Object.keys(words).length ? { ...planImport, words } : planImport };
}

/* Keep a drag's pointer while it leaves the page. Out here: a pointer the
   browser no longer knows (a pen lifted, a scripted event) throws. */
function capture(el: Element, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* the drag still works while it stays over the page */
  }
}

const failed = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

export function NewDesign({
  sm8Jobs,
  jobSearch,
  planImages,
  onBlank,
  onPlans,
  onClose,
  forJob,
}: {
  sm8Jobs?: boolean;
  jobSearch: JobSearch;
  planImages: PlanImages;
  onBlank: (name: string, job?: JobPrefill) => void;
  /** opens the design on the canvas; resolves once it's saved */
  onPlans: (name: string, job: JobPrefill | undefined, floors: Floor[], planImport: PlanImport) => Promise<void>;
  onClose: () => void;
  /** the job it's started on, from the quote's Design step (Isaac, 28
      October 2026): fixed, its street the name, nothing to search for */
  forJob?: JobPrefill;
}) {
  const [stage, setStage] = useState<Stage>("start");
  const [picked, setPicked] = useState<StudioJobHit | null>(null);
  /* held from the first draw: the studio lets go of the job it was opened
     on as the design is saved, and the dialog keeps it till it closes */
  const [fixed] = useState<JobPrefill | null>(forJob ?? null);
  const [name, setName] = useState(forJob?.name ?? "");
  const [pages, setPages] = useState<PageImage[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [ticked, setTicked] = useState<number[]>([]);
  const [peek, setPeek] = useState(0);
  const [drafts, setDrafts] = useState<FloorDraft[]>([]);
  const [cropping, setCropping] = useState<number | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const adding = useRef(false);

  /* the pages' pictures are object URLs: let them go when the dialog does */
  const pagesRef = useRef(pages);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);
  useEffect(() => () => pagesRef.current.forEach((p) => p.blob && URL.revokeObjectURL(p.thumbUrl)), []);

  /* a page opened large is drawn in full, so its title block can be read;
     the preview stands in until it lands */
  const peeking = stage === "peek" ? pages[peek] : undefined;
  const peekFile = peeking?.previewOf;
  useEffect(() => {
    if (!peekFile) return;
    let live = true;
    void fullPages(pagesRef.current, [peek], () => {})
      .then((full) => {
        if (live) setPages((cur) => cur.map((p, i) => (i === peek && p.previewOf ? full[peek] : p)));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [peek, peekFile]);

  const job = fixed ?? (picked ? prefillFromJob(picked) : undefined);
  const designName = name.trim() || "Untitled design";
  const heading = "New design";
  const jobWord = job?.jobNumber ? `job ${job.jobNumber}` : null;

  const pickJob = (hit: StudioJobHit) => {
    setPicked(hit);
    const fill = prefillFromJob(hit);
    if (fill.name) setName(fill.name);
  };

  const onFiles = async (list: File[]) => {
    if (list.length === 0) return;
    setError(null);
    const more = adding.current;
    adding.current = false;
    setStage("reading");
    setBusy({ word: "Reading the pages", done: 0, total: list.length });
    let read: Awaited<ReturnType<typeof readFiles>>;
    try {
      read = await readFiles(list, (done, total) => setBusy({ word: "Reading the pages", done, total }));
    } catch (e) {
      setBusy(null);
      setStage(more ? "floors" : "start");
      setError(failed(e));
      return;
    }
    setBusy(null);
    if (read.pages.length === 0) {
      setStage(more ? "floors" : "start");
      setError("No pages in that: drop a PDF, PNG or JPG.");
      return;
    }
    if (more) {
      /* another file onto floors already set: its pages join, ticked, above the rest */
      const base = pages.length;
      const all = [...pages, ...read.pages];
      labelPagesSequentially(all);
      setPages(all);
      setSources((s) => [...s, ...read.sources]);
      const fresh = read.pages.map((_, k) => base + k);
      if (!(await ready(fresh, all))) {
        setStage("floors");
        return;
      }
      setTicked((t) => [...t, ...fresh]);
      setDrafts((ds) => {
        const top = nextLevel(ds.map((d) => d.level));
        return [...ds, ...draftsFor(fresh).map((d, k) => ({ ...d, level: top + k }))];
      });
      setStage("floors");
      return;
    }
    setPages(read.pages);
    setSources(read.sources);
    if (read.pages.length > PICK_OVER) {
      setTicked([]);
      setStage("pages");
    } else {
      const all = read.pages.map((_, i) => i);
      setTicked(all);
      if (!(await ready(all, read.pages))) {
        setStage("start");
        return;
      }
      setDrafts(draftsFor(all));
      setStage("floors");
    }
  };

  /* the chosen pages drawn in full before the floors (a crop needs every pixel) */
  const ready = async (chosen: number[], all: PageImage[]): Promise<PageImage[] | null> => {
    if (!chosen.some((i) => all[i].previewOf)) return all;
    setBusy({ word: "Getting the pages ready", done: 0, total: chosen.length });
    let full: PageImage[];
    try {
      full = await fullPages(all, chosen, (done, total) => setBusy({ word: "Getting the pages ready", done, total }));
    } catch (e) {
      setBusy(null);
      setError(failed(e));
      return null;
    }
    setBusy(null);
    setPages(full);
    return full;
  };

  const toggle = (i: number) => setTicked((t) => (t.includes(i) ? t.filter((x) => x !== i) : [...t, i].sort((a, b) => a - b)));

  /* Use these pages: floors for the ticked pages, keeping what's set on a page already there */
  const takePages = async () => {
    if (!(await ready(ticked, pages))) return;
    setDrafts((ds) => {
      const kept = ds.filter((d) => ticked.includes(d.page));
      const have = new Set(kept.map((d) => d.page));
      const fresh = draftsFor(ticked.filter((i) => !have.has(i)));
      const top = nextLevel(kept.map((d) => d.level));
      return [...kept, ...fresh.map((d, k) => ({ ...d, level: kept.length ? top + k : d.level }))];
    });
    setStage("floors");
  };

  const setDraft = (key: string, patch: Partial<FloorDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const removeDraft = (key: string) => {
    const gone = drafts.find((d) => d.key === key);
    const left = drafts.filter((d) => d.key !== key);
    setDrafts(left);
    if (gone && !left.some((d) => d.page === gone.page)) setTicked((t) => t.filter((i) => i !== gone.page));
  };

  const start = async () => {
    setError(null);
    setBusy({ word: "Saving the plans", done: 0, total: 1 });
    let made: Awaited<ReturnType<typeof storePlans>>;
    try {
      made = await storePlans(planImages, sources, pages, drafts, (done, total) => setBusy({ word: "Saving the plans", done, total }));
    } catch (e) {
      setBusy(null);
      setError(`The plans didn't save: ${failed(e)}. Your pages are still here; try again.`);
      return;
    }
    try {
      await onPlans(designName, job, made.floors, made.planImport);
    } catch (e) {
      setBusy(null);
      setError(`The design didn't save: ${failed(e)}. Try again.`);
    }
  };

  const chooseFiles = (more = false) => {
    adding.current = more;
    fileRef.current?.click();
  };

  const filePicker = (
    <input
      ref={fileRef}
      type="file"
      hidden
      multiple
      accept="application/pdf,image/png,image/jpeg"
      onChange={(e) => {
        if (e.target.files) void onFiles([...e.target.files]);
        e.target.value = "";
      }}
    />
  );

  const errorLine = error && (
    <p className="ds2-nd-error" role="alert">
      <Dot hue="red" />
      {error}
    </p>
  );

  /* ── 1. the job, the name, the plans ── */
  if (stage === "start" || stage === "reading") {
    return (
      <Dialog heading={heading} onClose={onClose} width={720} dismissable={stage === "start"} foot={<Button onClick={onClose}>Cancel</Button>}>
        {filePicker}
        <div className="ds2-nd-form">
          {fixed && (
            <Field label="Job">
              <div className="ds2-nd-job">
                <b>{[fixed.jobNumber, fixed.client].filter(Boolean).join(" ") || "Job"}</b>
                {fixed.site && <span>{fixed.site}</span>}
              </div>
            </Field>
          )}
          {sm8Jobs && !fixed && (
            <Field label="Job">
              {picked ? (
                <div className="ds2-nd-job">
                  <b>{picked.jobNumber ? `${picked.jobNumber} ${picked.clientName ?? ""}`.trim() : (picked.clientName ?? "Job")}</b>
                  {job?.site && <span>{job.site}</span>}
                  <IconButton glyph="clear" label="Clear the job" size={32} onClick={() => setPicked(null)} />
                </div>
              ) : (
                <JobSearchField onPick={pickJob} search={jobSearch} />
              )}
            </Field>
          )}
          <Field label="Name">
            <TextInput
              data-autofocus={sm8Jobs && !fixed ? undefined : true}
              placeholder="Design name, e.g. 14 Harbour View Rd"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {stage === "reading" && busy ? (
            <div className="ds2-nd-drop" aria-busy="true">
              <span className="ds2-nd-drop-t">{busy.word}</span>
              <span className="ds2-nd-drop-s" role="status">
                {busy.total > 1 ? `${busy.done} of ${busy.total}` : "One moment"}
              </span>
            </div>
          ) : (
            <div
              className={`ds2-nd-drop${dragOver ? " ds2-nd-drop--over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void onFiles([...e.dataTransfer.files]);
              }}
            >
              <span className="ds2-nd-drop-ic" aria-hidden="true">
                <Icon name="upload" size={20} />
              </span>
              <span className="ds2-nd-drop-t">Drop the plans</span>
              <span className="ds2-nd-drop-s">A PDF of the set, or photos of the pages</span>
              <Button onClick={() => chooseFiles()}>Choose files</Button>
            </div>
          )}
          {errorLine}
          <button type="button" className="pt-link ds2-nd-blank" onClick={() => onBlank(designName, job)}>
            Start with a blank canvas
          </button>
        </div>
      </Dialog>
    );
  }

  /* ── 2. the pages, as a lightbox ── */
  if (stage === "pages") {
    return (
      <Dialog
        heading="Choose the floor plans"
        onClose={onClose}
        width="wide"
        dismissable={false}
        foot={
          <>
            <span className="ds2-nd-foot-fact" role="status">
              {busy ? `${busy.word}, ${Math.min(busy.done + 1, busy.total)} of ${busy.total}` : pagesWord(ticked)}
            </span>
            <Button onClick={() => setStage("start")}>Back</Button>
            <Button kind="main" disabled={ticked.length === 0 || !!busy} onClick={() => void takePages()}>
              {ticked.length === 1 ? "Use 1 page" : `Use ${ticked.length} pages`}
            </Button>
          </>
        }
      >
        <p className="ds2-nd-fact">
          {pages.length} pages. Tick the floor plans; open a page to read its title block.
        </p>
        <ul className="ds2-nd-grid" aria-label="Pages">
          {pages.map((p, i) => {
            const on = ticked.includes(i);
            return (
              <li key={i} className={`ds2-nd-page${on ? " ds2-nd-page--on" : ""}`}>
                <button type="button" className="ds2-nd-thumb" aria-pressed={on} aria-label={`Page ${i + 1}`} onClick={() => toggle(i)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumbUrl} alt="" />
                  <span className="ds2-nd-tick" aria-hidden="true">
                    {on && <Icon name="check" size={14} />}
                  </span>
                </button>
                <span className="ds2-nd-page-n">{i + 1}</span>
                <Button
                  kind="quiet"
                  size={32}
                  className="ds2-nd-open"
                  onClick={() => {
                    setPeek(i);
                    setStage("peek");
                  }}
                >
                  Open
                </Button>
              </li>
            );
          })}
        </ul>
      </Dialog>
    );
  }

  /* ── a page, large ── */
  if (stage === "peek") {
    const p = pages[peek];
    const on = ticked.includes(peek);
    return (
      <Dialog
        heading={`Page ${peek + 1} of ${pages.length}`}
        onClose={onClose}
        width="wide"
        dismissable={false}
        foot={
          <>
            <span className="ds2-nd-foot-fact">{pagesWord(ticked)}</span>
            <Button onClick={() => setStage("pages")}>All pages</Button>
            <Button icon={on ? "check" : undefined} onClick={() => toggle(peek)}>
              {on ? "Chosen" : "Choose this page"}
            </Button>
            <Button kind="main" disabled={ticked.length === 0} onClick={() => void takePages()}>
              {ticked.length === 1 ? "Use 1 page" : `Use ${ticked.length} pages`}
            </Button>
          </>
        }
      >
        <div
          className="ds2-nd-peek"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" && peek > 0) setPeek(peek - 1);
            if (e.key === "ArrowRight" && peek < pages.length - 1) setPeek(peek + 1);
          }}
        >
          <IconButton glyph="earlier" label="Earlier page" disabled={peek === 0} onClick={() => setPeek(peek - 1)} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="ds2-nd-peek-img" src={p.thumbUrl} alt={`Page ${peek + 1}`} />
          <IconButton glyph="later" label="Later page" disabled={peek === pages.length - 1} onClick={() => setPeek(peek + 1)} />
        </div>
      </Dialog>
    );
  }

  /* ── crop the plans out of one page ── */
  if (stage === "crop" && cropping !== null) {
    return (
      <Cropper
        page={pages[cropping]}
        index={cropping}
        initial={boxesOf(drafts, cropping)}
        startLevel={drafts.find((d) => d.page === cropping)?.level ?? 0}
        onCancel={() => setStage("floors")}
        onDone={(boxes) => {
          setDrafts((ds) => cropInto(ds, cropping, boxes));
          setCropping(null);
          setStage("floors");
        }}
        onClose={onClose}
      />
    );
  }

  /* ── 3. the floors ── */
  const floorsCount = new Set(drafts.map((d) => d.level)).size;
  return (
    <Dialog
      heading={heading}
      onClose={onClose}
      width={960}
      dismissable={false}
      foot={
        <>
          {busy && (
            <span className="ds2-nd-foot-fact" role="status">
              {busy.word}, {Math.min(busy.done + 1, busy.total)} of {busy.total}
            </span>
          )}
          <Button disabled={!!busy} onClick={() => setStage(pages.length > PICK_OVER ? "pages" : "start")}>
            Back
          </Button>
          <Button kind="main" disabled={!!busy || drafts.length === 0} onClick={() => void start()}>
            {busy ? "Saving the plans" : floorsCount === 1 ? "Start design, 1 floor" : `Start design, ${floorsCount} floors`}
          </Button>
        </>
      }
    >
      {filePicker}
      <div className="ds2-nd-form">
        <p className="ds2-nd-fact">
          <b>{designName}</b>
          {jobWord ? `, ${jobWord}` : ""}. {drafts.length === 1 ? "1 plan" : `${drafts.length} plans`} from{" "}
          {pages.length === 1 ? "1 page" : `${pages.length} pages`}.
        </p>
        <ul className="ds2-nd-floors" aria-label="Floors">
          {drafts.map((d) => {
            const p = pages[d.page];
            return (
              <li key={d.key} className="ds2-nd-floor">
                <span className="ds2-nd-floor-thumb">
                  <PagePicture page={p} box={d.box} />
                </span>
                <Chooser
                  aria-label={`Level of ${draftName(d)}`}
                  options={LEVEL_OPTIONS}
                  value={String(d.level)}
                  onChange={(v) => setDraft(d.key, { level: Number(v) })}
                />
                <span className="ds2-nd-floor-name">
                  <TextInput aria-label="Floor name" placeholder={defaultFloorName(d.level)} value={d.name} onChange={(e) => setDraft(d.key, { name: e.target.value })} />
                  <span className="ds2-nd-floor-from">
                    Page {d.page + 1}
                    {d.box ? ", cropped" : ""}
                  </span>
                </span>
                <span className="ds2-nd-floor-acts">
                  <Button
                    kind="quiet"
                    size={32}
                    disabled={!!busy}
                    onClick={() => {
                      setCropping(d.page);
                      setStage("crop");
                    }}
                  >
                    Crop
                  </Button>
                  <Button kind="quiet" size={32} disabled={!!busy || drafts.length === 1} onClick={() => removeDraft(d.key)}>
                    Remove
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
        {errorLine}
        <div className="ds2-nd-links">
          {pages.length > PICK_OVER && (
            <button type="button" className="pt-link" onClick={() => setStage("pages")}>
              Choose other pages
            </button>
          )}
          <button type="button" className="pt-link" onClick={() => chooseFiles(true)}>
            Add another file
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/* A page's picture, or the box cut from it, filling its frame. */
function PagePicture({ page, box }: { page: PageImage; box?: TrimRect }) {
  if (!box) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={page.thumbUrl} alt="" />;
  }
  return (
    <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <image href={page.thumbUrl} x={0} y={0} width={page.width} height={page.height} />
    </svg>
  );
}

/* ── CROP IT OUT (the board studio-crop) ──
   The page large. Drag a box round one plan and Crop it out: it greys out on
   the page, labelled with its level, and you draw the next from what's left.
   The pieces list on the right, each with its level; Put back takes one off.
   Done makes each piece a floor. */
function Cropper({
  page,
  index,
  initial,
  startLevel,
  onCancel,
  onDone,
  onClose,
}: {
  page: PageImage;
  index: number;
  initial: { box: TrimRect; level: number }[];
  startLevel: number;
  onCancel: () => void;
  onDone: (boxes: { box: TrimRect; level: number }[]) => void;
  onClose: () => void;
}) {
  const [pieces, setPieces] = useState(initial);
  const [from, setFrom] = useState<{ x: number; y: number } | null>(null);
  const [to, setTo] = useState<{ x: number; y: number } | null>(null);
  const [drawing, setDrawing] = useState(false);
  /* the drag in hand, read by the move before the state above has landed */
  const dragging = useRef(false);
  const svg = useRef<SVGSVGElement>(null);

  /* where the pointer is, in the page's own pixels */
  const at = useCallback((e: ReactPointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * page.width, y: ((e.clientY - r.top) / r.height) * page.height };
  }, [page.width, page.height]);

  const box = from && to ? boxFrom(from, to, page.width, page.height) : null;
  const level = (l: number) => defaultFloorName(l);
  const cut = () => {
    if (!box) return;
    const used = pieces.map((p) => p.level);
    setPieces([...pieces, { box, level: pieces.length ? nextLevel(used) : startLevel }]);
    setFrom(null);
    setTo(null);
  };
  const stroke = Math.max(page.width, page.height) / 400;

  return (
    <Dialog
      heading={`Crop the plans out of page ${index + 1}`}
      onClose={onClose}
      width="wide"
      dismissable={false}
      foot={
        <>
          <span className="ds2-nd-foot-fact">
            {pieces.length === 0 ? "Drag a box round one plan" : pieces.length === 1 ? "1 piece cropped" : `${pieces.length} pieces cropped`}
          </span>
          <Button onClick={onCancel}>Cancel</Button>
          <Button kind="main" onClick={() => onDone(pieces)}>
            {pieces.length === 0 ? "Keep the whole page" : pieces.length === 1 ? "Done, 1 floor" : `Done, ${pieces.length} floors`}
          </Button>
        </>
      }
    >
      <div className="ds2-nd-crop">
        <div className="ds2-nd-crop-page">
          <svg
            ref={svg}
            className="ds2-nd-crop-svg"
            viewBox={`0 0 ${page.width} ${page.height}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={`Page ${index + 1}: drag a box round a plan`}
            onPointerDown={(e) => {
              capture(e.currentTarget, e.pointerId);
              const p = at(e);
              setFrom(p);
              setTo(p);
              dragging.current = true;
              setDrawing(true);
            }}
            onPointerMove={(e) => {
              if (dragging.current) setTo(at(e));
            }}
            onPointerUp={(e) => {
              if (dragging.current) setTo(at(e));
              dragging.current = false;
              setDrawing(false);
            }}
          >
            <image href={page.thumbUrl} x={0} y={0} width={page.width} height={page.height} />
            {pieces.map((p, k) => (
              <g key={k}>
                <rect className="ds2-nd-crop-done" x={p.box.x} y={p.box.y} width={p.box.w} height={p.box.h} strokeWidth={stroke} />
                <text className="ds2-nd-crop-label" x={p.box.x + stroke * 6} y={p.box.y + stroke * 18} fontSize={stroke * 12}>
                  {level(p.level)}
                </text>
              </g>
            ))}
            {box && <rect className="ds2-nd-crop-sel" x={box.x} y={box.y} width={box.w} height={box.h} strokeWidth={stroke} />}
          </svg>
        </div>
        <aside className="ds2-nd-crop-side" aria-label="Pieces">
          <h3 className="ds2-nd-crop-h">Pieces of page {index + 1}</h3>
          {pieces.length === 0 && <p className="ds2-nd-fact">None yet. Drag a box round one plan, then Crop it out.</p>}
          <ul className="ds2-nd-pieces">
            {pieces.map((p, k) => (
              <li key={k} className="ds2-nd-piece">
                <span className="ds2-nd-floor-thumb">
                  <PagePicture page={page} box={p.box} />
                </span>
                <Chooser
                  aria-label={`Level of piece ${k + 1}`}
                  options={LEVEL_OPTIONS}
                  value={String(p.level)}
                  onChange={(v) => setPieces(pieces.map((q, j) => (j === k ? { ...q, level: Number(v) } : q)))}
                />
                <Button kind="quiet" size={32} onClick={() => setPieces(pieces.filter((_, j) => j !== k))}>
                  Put back
                </Button>
              </li>
            ))}
          </ul>
          <Button disabled={!box || drawing} onClick={cut}>
            Crop it out
          </Button>
        </aside>
      </div>
    </Dialog>
  );
}
