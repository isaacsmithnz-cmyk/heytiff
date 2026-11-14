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
   (plans.ts), and stored by the same PlanImages as the old Plans step.

   FROM THE JOB'S PLANS (Isaac, 9 November 2026, the Plans mock, board 7):
   a job with plans in its Documents shows them here in the drop zone's
   place, each ticked once Tiff has read it, with the floors she found;
   Start design takes the floors and her reading from the plan and reads
   nothing again (lib/jobs/plans.ts designFromPlan). Add plans puts a file
   onto the job and into its Plans, read once there, and it joins the list
   as it is read; the drop zone stays for a job with no plans and a design
   with no job.

   THE JOB COMES FIRST (Isaac, 14 November 2026, the mock "Designs from a
   job": "from now on, designs have to be built from a job ... Unless you
   just do unlinked job, which doesn't connect into anything, and you can
   link it later on"). Where the business's jobs can be read, the dialog
   opens on the job alone: a search, Recent and All jobs as job cards
   (job-picker.tsx), and Start without a job for an idea or a quick
   example. The name and the plans show once one of the two is chosen, and
   the job chosen stays as its card, with a cross to change it. */

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
import { StateWord } from "@/components/parts/state";
import { Tick } from "@/components/parts/tick";
import { floorPagesOf, pageCaption, planReadLine, planStateWord, startablePlans, type JobPlanRead } from "@/lib/jobs/plans";
import { kickPlanReads, PLAN_POLL_MS } from "@/lib/jobs/plans-client";
import type { JobSearch } from "./job-search";
import { cardOfHit, cardOfPrefill, JobCardFace, JobPicker, type JobLists } from "./job-picker";
import { useStudioFlow } from "./flow";

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
  /* the next flow: what's already on its way up, started as the files were
     dropped and the pages ticked; everything else goes up at once, together */
  early?: { source: (s: Source) => Promise<string> | undefined; page: (i: number) => Promise<string> | undefined },
): Promise<{ floors: Floor[]; planImport: PlanImport }> {
  const used = [...new Set(drafts.map((d) => d.page))].sort((a, b) => a - b);
  const total = sources.length + used.length;
  let done = 0;
  const stored: PlanImportSource[] = [];
  const refs: Record<number, string> = {};
  if (early) {
    const tick = <T,>(p: Promise<T>) => p.then((v) => (onProgress(++done, total), v));
    onProgress(0, total);
    const [srcRefs, pageRefs] = await Promise.all([
      Promise.all(sources.map((s) => tick(early.source(s) ?? planImages.uploadSource(s.file)))),
      Promise.all(used.map((i) => tick(early.page(i) ?? planImages.upload(pages[i])))),
    ]);
    sources.forEach((s, k) => stored.push({ ref: srcRefs[k], kind: s.kind }));
    used.forEach((i, k) => (refs[i] = pageRefs[k]));
  } else {
    for (const s of sources) {
      onProgress(done, total);
      stored.push({ ref: await planImages.uploadSource(s.file), kind: s.kind });
      done = done + 1;
    }
    for (const i of used) {
      onProgress(done, total);
      refs[i] = await planImages.upload(pages[i]);
      done = done + 1;
    }
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
  jobLists,
  planImages,
  onBlank,
  onPlans,
  onClose,
  forJob,
  onFromPlans,
  jobPlans: givenPlans,
  loadJobPlans,
  addJobPlan,
}: {
  sm8Jobs?: boolean;
  jobSearch: JobSearch;
  /** Recent and All jobs for the job picker; without it the picker is the search alone */
  jobLists?: JobLists;
  planImages: PlanImages;
  onBlank: (name: string, job?: JobPrefill) => void;
  /** opens the design on the canvas; resolves once it's saved */
  onPlans: (name: string, job: JobPrefill | undefined, floors: Floor[], planImport: PlanImport) => Promise<void>;
  /** opens the design on the job's plans: their floors and Tiff's reading come with them */
  onFromPlans?: (name: string, job: JobPrefill, plans: JobPlanRead[]) => Promise<void>;
  /** the job's plans (lib/jobs/plans.ts): the fixed job's, read on the
      server by the route; a picked job's are asked for with `loadJobPlans` */
  jobPlans?: JobPlanRead[] | null;
  loadJobPlans?: (jobUuid: string) => Promise<JobPlanRead[] | null>;
  /** a file onto the job and into its Plans; the ids of the plans made, to start their reads */
  addJobPlan?: (jobUuid: string, file: File) => Promise<{ ok: true; planIds: string[] } | { ok: false; error: string }>;
  onClose: () => void;
  /** the job it's started on, from the quote's Design step (Isaac, 28
      October 2026): fixed, its street the name, nothing to search for */
  forJob?: JobPrefill;
}) {
  const [stage, setStage] = useState<Stage>("start");
  const [picked, setPicked] = useState<StudioJobHit | null>(null);
  /* Start without a job: a design that is linked to nothing, for an idea or
     a quick example, linked later from its Summary */
  const [noJob, setNoJob] = useState(false);
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
  /* THE NEXT FLOW STARTS THE SLOW PARTS EARLY: the source goes up as it's
     dropped, a page is drawn in full as it's ticked and goes up as soon as
     it is, so Start design waits on what's left, not on all of it. */
  const flow = useStudioFlow();
  const sourceUp = useRef(new Map<File, Promise<string>>());
  const drawn = useRef(new Map<number, Promise<PageImage>>());
  const pageUp = useRef(new Map<number, Promise<string>>());
  const sendEarly = (list: Source[]) => {
    if (flow !== "next") return;
    for (const x of list) {
      const up = planImages.uploadSource(x.file);
      up.catch(() => sourceUp.current.delete(x.file));
      sourceUp.current.set(x.file, up);
    }
  };
  /* and what went up early and isn't used is taken away again when the
     dialog goes: all of it if no design was made, a page ticked and then
     unticked if one was. `kept` is what the design took, set before it is
     handed over, because handing it over closes this dialog. */
  const kept = useRef<Set<string> | null>(null);
  const leftBehind = useRef(() => {});
  useEffect(() => {
    leftBehind.current = () => {
      const keep = kept.current ?? new Set<string>();
      void Promise.allSettled([...sourceUp.current.values(), ...pageUp.current.values()]).then((all) =>
        all.forEach((r) => {
          if (r.status === "fulfilled" && !keep.has(r.value)) planImages.remove(r.value).catch(() => {});
        })
      );
    };
  });
  useEffect(() => () => leftBehind.current(), []);
  /* `from` is the pages as they are now, when that is newer than the last render's */
  const drawPage = (i: number, from?: PageImage[]): Promise<PageImage> => {
    const had = drawn.current.get(i);
    if (had) return had;
    const list = from ?? pagesRef.current;
    const p = list[i];
    const made = p.previewOf
      ? fullPages(list, [i], () => {}).then((full) => ({ ...full[i], label: p.label }))
      : Promise.resolve(p);
    drawn.current.set(i, made);
    void made
      .then((full) => {
        if (!pageUp.current.has(i)) {
          const up = planImages.upload(full);
          up.catch(() => pageUp.current.delete(i));
          pageUp.current.set(i, up);
        }
        setPages((cur) => cur.map((x, k) => (k === i && x.previewOf ? full : x)));
      })
      .catch(() => drawn.current.delete(i));
    return made;
  };

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
  /* the job it was opened on, read as a card for its colour and its kind */
  const [fixedRead, setFixedRead] = useState<StudioJobHit | null>(null);
  const fixedId = fixed?.remoteId ?? "";
  useEffect(() => {
    if (!fixedId || !jobLists) return;
    let live = true;
    void jobLists
      .recent([fixedId])
      .then((jobs) => {
        if (live && jobs[0]) setFixedRead(jobs[0]);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [fixedId, jobLists]);
  /* the job is asked for before anything else, where there are jobs to pick */
  const askJob = !!sm8Jobs && !fixed && !picked && !noJob;
  const designName = name.trim() || "Untitled design";

  /* THE JOB'S PLANS: the fixed job's arrive with the dialog; a picked job's
     are asked for, and asked again every few seconds while one is being
     read, so a plan just added turns to Read here as it does on the job */
  const [plansOf, setPlansOf] = useState<{ job: string; plans: JobPlanRead[] | null }>(() => ({ job: fixed?.remoteId ?? "", plans: givenPlans ?? null }));
  const jobId = job?.remoteId ?? "";
  const plans = plansOf.job === jobId ? plansOf.plans : null;
  const plansReading = !!plans?.some((p) => p.state === "reading");
  const [planTicks, setPlanTicks] = useState<ReadonlySet<string> | null>(null);
  const [planBusy, setPlanBusy] = useState<string | null>(null);
  const planPicker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!jobId || !loadJobPlans) return;
    if (plansOf.job === jobId && plansOf.plans && !plansReading) return;
    let live = true;
    const ask = () =>
      void loadJobPlans(jobId)
        .then((p) => {
          if (live && p) setPlansOf({ job: jobId, plans: p });
        })
        .catch(() => {});
    if (plansOf.job !== jobId || !plansOf.plans) ask();
    const timer = plansReading ? window.setInterval(ask, PLAN_POLL_MS) : 0;
    return () => {
      live = false;
      if (timer) window.clearInterval(timer);
    };
  }, [jobId, loadJobPlans, plansOf, plansReading]);
  const startable = plans ? startablePlans(plans) : [];
  /* read plans come ticked; a tick taken off stays off */
  const tickedPlans = startable.filter((p) => (planTicks ? planTicks.has(p.id) : true));
  const togglePlan = (id: string, on: boolean) =>
    setPlanTicks((cur) => {
      const next = new Set(cur ?? startable.map((p) => p.id));
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const addPlanFiles = async (list: File[]) => {
    if (!addJobPlan || !jobId || list.length === 0) return;
    setError(null);
    for (let i = 0; i < list.length; i++) {
      setPlanBusy(list.length === 1 ? "Adding the plan to the job" : `Adding ${i + 1} of ${list.length} to the job`);
      const added = await addJobPlan(jobId, list[i]).catch(() => ({ ok: false as const, error: "The plan couldn't be added. Try again." }));
      if (!added.ok) {
        setError(added.error);
        break;
      }
      kickPlanReads(added.planIds);
    }
    setPlanBusy(null);
    const fresh = await loadJobPlans?.(jobId).catch(() => null);
    if (fresh) setPlansOf({ job: jobId, plans: fresh });
  };
  const showPlans = !!job && !!onFromPlans && !!plans && plans.length > 0;
  const startFromPlans = async () => {
    if (!job || !onFromPlans || tickedPlans.length === 0) return;
    setError(null);
    setBusy({ word: "Opening the design", done: 0, total: 1 });
    try {
      await onFromPlans(designName, job, tickedPlans);
    } catch (e) {
      setBusy(null);
      setError(`The design didn't save: ${failed(e)}. Try again.`);
    }
  };
  const heading = "New design";
  const jobWord = job?.jobNumber ? `job ${job.jobNumber}` : null;

  const pickJob = (hit: StudioJobHit) => {
    setPicked(hit);
    const fill = prefillFromJob(hit);
    if (fill.name) setName(fill.name);
  };
  /* the job let go: the name it gave goes with it, a name typed over it stays */
  const unpickJob = () => {
    if (picked && name === prefillFromJob(picked).name) setName("");
    setPicked(null);
  };

  const onFiles = async (list: File[]) => {
    if (list.length === 0) return;
    setError(null);
    const more = adding.current;
    adding.current = false;
    /* ONE SOURCE (#1448): on a job, the plans go into the job's Plans, read
       once there, and the design starts from them as Start design does; only
       a design on no job keeps plans of its own */
    if (!more && job && onFromPlans && addJobPlan && loadJobPlans) {
      setStage("reading");
      setBusy({ word: list.length === 1 ? "Adding the plan to the job" : "Adding the plans to the job", done: 0, total: list.length });
      await addPlanFiles(list);
      setBusy(null);
      setStage("start");
      return;
    }
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
      sendEarly(read.sources);
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
    sendEarly(read.sources);
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
      if (flow === "next") {
        full = [...all];
        /* a count kept on an object: the compiler won't take a `++` on a
           variable the callbacks share */
        const tally = { done: 0 };
        await Promise.all(
          chosen.map((i) =>
            drawPage(i, all).then((p) => {
              full[i] = p;
              tally.done += 1;
              setBusy({ word: "Getting the pages ready", done: tally.done, total: chosen.length });
            }),
          ),
        );
      } else full = await fullPages(all, chosen, (done, total) => setBusy({ word: "Getting the pages ready", done, total }));
    } catch (e) {
      setBusy(null);
      setError(failed(e));
      return null;
    }
    setBusy(null);
    setPages(full);
    return full;
  };

  const toggle = (i: number) => {
    if (flow === "next" && !ticked.includes(i)) void drawPage(i).catch(() => {});
    setTicked((t) => (t.includes(i) ? t.filter((x) => x !== i) : [...t, i].sort((a, b) => a - b)));
  };

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
    /* out of the try: the compiler takes no conditional inside one */
    const early =
      flow === "next"
        ? { source: (x: Source) => sourceUp.current.get(x.file), page: (i: number) => pageUp.current.get(i) }
        : undefined;
    try {
      made = await storePlans(
        planImages,
        sources,
        pages,
        drafts,
        (done, total) => setBusy({ word: "Saving the plans", done, total }),
        early,
      );
    } catch (e) {
      setBusy(null);
      setError(`The plans didn't save: ${failed(e)}. Your pages are still here; try again.`);
      return;
    }
    kept.current = new Set([
      ...made.planImport.sources.map((x) => x.ref),
      ...made.floors.flatMap((f) => f.plans.map((pl) => pl.imageRef)),
    ]);
    try {
      await onPlans(designName, job, made.floors, made.planImport);
    } catch (e) {
      kept.current = null;
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
    const foot = showPlans ? (
      <>
        <Button onClick={onClose} disabled={!!busy}>
          Cancel
        </Button>
        <Button kind="main" disabled={tickedPlans.length === 0 || !!busy || !!planBusy} onClick={() => void startFromPlans()}>
          Start design
        </Button>
      </>
    ) : (
      <Button onClick={onClose}>Cancel</Button>
    );
    if (askJob)
      return (
        <Dialog heading={heading} onClose={onClose} width={720} foot={<Button onClick={onClose}>Cancel</Button>}>
          <div className="ds2-nd-form">
            <Field label="Job">
              <JobPicker onPick={pickJob} search={jobSearch} lists={jobLists} />
            </Field>
            <button type="button" className="pt-link ds2-nd-blank" onClick={() => setNoJob(true)}>
              Start without a job
            </button>
          </div>
        </Dialog>
      );
    return (
      <Dialog heading={heading} onClose={onClose} width={720} dismissable={stage === "start"} foot={foot}>
        {filePicker}
        <div className="ds2-nd-form">
          {fixed && (
            <Field label="Job">
              <div className={`ds2-nd-picked sc-card sc-card--${cardOfPrefill(fixed, fixedRead).hue}`}>
                <JobCardFace job={cardOfPrefill(fixed, fixedRead)} plans={false} />
              </div>
            </Field>
          )}
          {sm8Jobs && !fixed && picked && (
            <Field label="Job">
              <div className={`ds2-nd-picked sc-card sc-card--${cardOfHit(picked).hue}`}>
                <JobCardFace job={cardOfHit(picked)} plans={false} />
                <IconButton glyph="clear" label="Clear the job" size={32} onClick={unpickJob} />
              </div>
            </Field>
          )}
          {sm8Jobs && !fixed && !picked && noJob && (
            <Field label="Job">
              <div className="ds2-nd-picked sc-card sc-card--grey">
                <span className="sc-cb">
                  <span className="sc-c1">No job</span>
                </span>
                <IconButton glyph="clear" label="Choose a job" size={32} onClick={() => setNoJob(false)} />
              </div>
            </Field>
          )}
          <Field label="Name">
            <TextInput
              data-autofocus
              placeholder="Design name, e.g. 14 Harbour View Rd"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {showPlans ? (
            <Field label="Plans">
              <div className="ds2-nd-plans">
                <ul className="pt-rows" aria-label="The job's plans">
                  {plans.map((p) => {
                    const can = startable.some((s) => s.id === p.id);
                    const on = can && tickedPlans.some((t) => t.id === p.id);
                    const state = planStateWord(p);
                    const pages = floorPagesOf(p).filter((pg) => p.thumbs[pg.n]);
                    return (
                      <li key={p.id} className="pt-row pt-row--wrap">
                        <span className="pt-row-lead">
                          <Tick className="jdoc-tick" checked={on} disabled={!can} onChange={(v) => togglePlan(p.id, v)} label={<span className="sr-only">{`Use ${p.name}`}</span>} />
                        </span>
                        <span className="pt-row-text">
                          <span className="pt-row-name">{p.name}</span>
                          <span className="pt-row-line">{planReadLine(p)}</span>
                          {pages.length > 0 && (
                            <span className="jpl-pages jpl-pages--sm">
                              {pages.map((pg) => (
                                <span key={pg.n} className="jpl-page">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={p.thumbs[pg.n]} alt={pageCaption(pg)} />
                                  <span>{pageCaption(pg)}</span>
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                        <span className="pt-row-end">
                          <StateWord tone={state.tone}>{state.word}</StateWord>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {addJobPlan && (
                  <span className="ds2-nd-addword">
                    <Button kind="quiet" size={32} disabled={!!planBusy} onClick={() => planPicker.current?.click()}>
                      {planBusy ?? "Add plans"}
                    </Button>
                    <input
                      ref={planPicker}
                      type="file"
                      hidden
                      multiple
                      accept="application/pdf,image/png,image/jpeg"
                      aria-label="Choose plans to add to the job"
                      onChange={(e) => {
                        const list = [...(e.target.files ?? [])];
                        e.target.value = "";
                        void addPlanFiles(list);
                      }}
                    />
                  </span>
                )}
              </div>
            </Field>
          ) : stage === "reading" && busy ? (
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
