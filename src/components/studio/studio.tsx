"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Icon } from "@/components/shell/icon";
import { JobSearchField, type JobSearch } from "./job-search";
export type { JobSearch };
import { agoLabel } from "@/lib/format/duration";
import {
  createDesign,
  newId,
  type DesignDocument,
  type DesignObject,
  type DesignSettings,
  type DesignVariantRef,
} from "@/lib/studio/document";
import { CLIMATE_ZONES, type SizingBasis } from "@/lib/studio/loads";
import { effectiveClimateZone, effectiveBuildingType } from "@/lib/studio/summary";
import { openDesignJson, DesignDocumentError } from "@/lib/studio/migrations";
import { pruneObjects, releaseRoomsFromSystems, removedRoomIds } from "@/lib/studio/attach";
import {
  browserDesignStore,
  designFileName,
  exportDesignJson,
  SyncedDesignStore,
  type DesignStore,
  type DesignSummary,
} from "@/lib/studio/store";
import { RemoteDesignStore } from "@/lib/studio/remote-store";
import { History } from "@/lib/studio/history";
import {
  StudioCanvas,
  ALL_LAYERS_ON,
  type AirComponentKind,
  type ArmedComponent,
  type CanvasTool,
  type LayerFlags,
  type PlacingUnit,
  type ZoomApi,
} from "./canvas";
import { ComponentPalette, PlenumHud } from "./air-tools";
import { isAirCapable } from "@/lib/studio/modules";
import { roomsServedBy } from "@/lib/studio/coverage";
import { PlansPanel } from "./plans-panel";
import { StepPrompt } from "./step-prompt";
import {
  floorDisplayName,
  formatLevel,
  RemotePlanImages,
  type PlanImages,
} from "@/lib/studio/plans";
import { SummaryView } from "./summary/summary";
import type { SimReady } from "./summary/sim-card";
import { buildSimModel } from "@/lib/studio/sim";
import { SystemCockpit } from "./cockpit-panel";
import { RoomModal } from "./room-modal";
import { ReferenceViewer } from "./reference-viewer";
import { SimPresentMode } from "./sim-present";
import { SimRuntime } from "@/lib/studio/sim-runtime";
import {
  prefillFromJob,
  type JobPrefill,
  type StudioJobHit,
} from "@/lib/studio/job-link";
import type { DataPack, IndoorUnit } from "@/lib/studio/packs/schema";
import "./studio.css";

/* The sim flag never changes after load, so there is nothing to subscribe to —
   this store is read once and then quiet. Both functions are module-level
   constants: useSyncExternalStore re-reads whenever the subscribe or snapshot
   identity changes, so defining them inline would re-read every render. */
const subscribeNever = () => () => {};
const readSimFlag = (): boolean => {
  try {
    return (
      process.env.NEXT_PUBLIC_STUDIO_SIM === "1" ||
      window.localStorage.getItem("studio.sim") === "1"
    );
  } catch {
    return false; // storage unavailable (private mode, blocked cookies)
  }
};


/* server actions load lazily so jsdom tests never parse the auth0 runtime —
   same pattern as remote-store.ts */
const packActions = () => import("@/app/actions/studio-packs");
const studioActions = () => import("@/app/actions/studio");

/* Design Studio — Stage 0: shell mount, home + new-design flow, workflow
   stepper, autosaving document, per-stage empty states. The canvas engine,
   plans pipeline and system modules land in Stages 1+ on top of this frame. */

/* Three screens, two tabs: Plans (step 0) lives behind the menu's "Edit
   plans"; Design (1) and Summary (2) are the tab switcher. On Plans neither
   tab lights up. */
const TABS = [
  { step: 1, label: "Design" },
  { step: 2, label: "Summary" },
] as const;

const MODE_LABEL = { plan: "Floor plans", blank: "Blank canvas" } as const;

/* screen-swap timings — see throughSwap(). Must stay in step with the .2s
   exit transitions on `.dstudio.swapping .ds-home-stack` in studio.css: the
   leaving screen has to be fully gone before the swap lands. */
const SWAP_OUT_MS = 200;
/* failed-save retry: doubles from 5s to a 60s ceiling. Long enough that a
   session-long outage keeps being retried, slow enough never to be a poll. */
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;
const SWAP_PAINT_MS = 16; // one frame, so the arriving screen has a state to animate from

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return agoLabel(Math.floor(s / 86400));
}

/* menu Export — the .heytiff-design.json download; round-trips through the
   Home screen's "Import design file" (openDesignJson) */
function downloadDesign(doc: DesignDocument) {
  const url = URL.createObjectURL(
    new Blob([exportDesignJson(doc)], { type: "application/json" })
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = designFileName(doc);
  a.click();
  URL.revokeObjectURL(url);
}

/** test/harness seam — defaults to the auth-gated server action */
export type PackLoader = () => Promise<{
  pack: DataPack;
  version: string;
} | null>;

/** test/harness seam — defaults to the auth-gated server action */


export function Studio({
  store,
  planImages,
  packLoader,
  sm8Jobs,
  jobSearch,
  openDesignId,
}: {
  store?: DesignStore;
  planImages?: PlanImages;
  packLoader?: PackLoader;
  /** ServiceM8 is connected AND this person may read the client book — the
      route decides both. Off means the new-design step never mentions it. */
  sm8Jobs?: boolean;
  jobSearch?: JobSearch;
  /** `?design=<id>` — open this design instead of landing on Home. What a
      link from the Workboard's job sheet arrives with. */
  openDesignId?: string;
}) {
  // the store is browser-only; create it lazily so SSR prerender never touches
  // it. Server rows are the source of truth; localStorage is the crash buffer.
  const storeRef = useRef<DesignStore | null>(null);
  const getStore = useCallback(
    () =>
      (storeRef.current ??=
        store ??
        new SyncedDesignStore(new RemoteDesignStore(), browserDesignStore())),
    [store]
  );
  const planImagesInst = useMemo(
    () => planImages ?? new RemotePlanImages(),
    [planImages]
  );

  const [recents, setRecents] = useState<DesignSummary[]>([]);
  const [doc, setDoc] = useState<DesignDocument | null>(null);
  const [step, setStep] = useState(0);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "local">(
    "saved"
  );
  /** how long to wait before the next automatic retry (see the effect below) */
  const retryIn = useRef(RETRY_BASE_MS);
  /* menu New lands on Home with the new-design wizard already open */
  const [homeAutoNew, setHomeAutoNew] = useState(false);

  const [swapping, setSwapping] = useState(false);
  /* true only while the OLD screen is leaving. The well's colour keys off this so
     it can start dissolving the moment you leave the canvas, instead of holding
     on until the swap lands. */
  const [exiting, setExiting] = useState(false);

  const refreshRecents = useCallback(() => {
    void getStore().list().then(setRecents);
  }, [getStore]);

  useEffect(() => {
    refreshRecents();
  }, [refreshRecents]);

  /* Run a screen swap as a hand-off rather than a cross-fade: the leaving screen
     clears out, then the arriving one comes in. `swapping` drives both sides in
     studio.css — the start screen sinks downward and rises back from below, the
     editor fades.

     `prepare` (the load/save) runs DURING the exit, so the travel time is real
     work: by the time the start screen has sunk away, the design is loaded and
     the canvas can arrive already populated. `apply` then mounts the new screen
     in its "away" state, and one paint beat later `swapping` drops so it has a
     frame to animate in from. */
  const swapTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const timers = swapTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);
  const throughSwap = useCallback(
    async <T,>(prepare: () => T | Promise<T>, apply: (value: T) => void) => {
      const wait = (ms: number) =>
        new Promise<void>((r) => {
          swapTimers.current.push(setTimeout(r, ms));
        });
      setSwapping(true);
      setExiting(true);
      try {
        const [value] = await Promise.all([prepare(), wait(SWAP_OUT_MS)]);
        apply(value);
        setExiting(false); // same commit as the swap: the old screen is gone
        await wait(SWAP_PAINT_MS);
      } finally {
        setSwapping(false); // always bring the screen back, even if the load throws
        setExiting(false);
      }
    },
    []
  );

  /* Every mutation flows through here so updatedAt always bumps and the
     autosave below sees one consistent object. */
  const mutate = useCallback((fn: (d: DesignDocument) => DesignDocument) => {
    setSaveState("saving");
    setDoc((d) => {
      if (!d) return d;
      const next = fn(d);
      return {
        ...next,
        meta: { ...next.meta, updatedAt: new Date().toISOString() },
      };
    });
  }, []);

  /* Autosave: every change hits the local crash buffer immediately, then a
     debounced full save goes to the server. If the server is unreachable the
     design is still safe locally — the indicator says so. */
  useEffect(() => {
    if (!doc) return;
    void getStore().stash?.(doc);
    const t = setTimeout(() => {
      void getStore()
        .save(doc)
        .then(() => {
          retryIn.current = RETRY_BASE_MS;
          setSaveState("saved");
        })
        .catch(() => setSaveState("local"));
    }, 600);
    return () => clearTimeout(t);
  }, [doc, getStore]);

  /* A failed save retries ITSELF. Nothing did before: the debounce only fires
     on the next edit, so a design saved while the connection was down could
     sit local long after the network came back, with the amber pill the only
     hint and a click the only cure.

     Two triggers. `online` is the fast one — the browser telling us the
     connection is back — and it retries at once and resets the wait. The
     backoff is the honest one, because `online` lies both ways: it doesn't
     fire for a server that was down rather than a network that was, and it
     fires on a captive portal that goes nowhere. Doubling from 5s to a 60s
     ceiling keeps trying for a session-long outage without ever becoming a
     poll. */
  const latestDoc = useRef(doc);
  useEffect(() => {
    latestDoc.current = doc;
  }, [doc]);

  useEffect(() => {
    if (saveState !== "local") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    /* An automatic attempt does NOT flip the pill to "Saving…". Partly because
       a flicker every few seconds is noise for a fact that hasn't changed —
       the design IS still saved locally — and partly because it would end this
       effect mid-flight (the state is its own dependency) and take the retry
       schedule with it. Each failure arms the next attempt from inside the
       same effect instead. A save the USER asked for still reports itself. */
    const attempt = () => {
      const d = latestDoc.current;
      if (stopped || !d) return;
      void getStore()
        .save(d)
        .then(() => {
          if (stopped) return;
          retryIn.current = RETRY_BASE_MS;
          setSaveState("saved");
        })
        .catch(() => {
          if (stopped) return;
          retryIn.current = Math.min(retryIn.current * 2, RETRY_MAX_MS);
          timer = setTimeout(attempt, retryIn.current);
        });
    };

    timer = setTimeout(attempt, retryIn.current);
    const onOnline = () => {
      retryIn.current = RETRY_BASE_MS;
      clearTimeout(timer);
      attempt();
    };
    window.addEventListener("online", onOnline);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [saveState, getStore]);

  const openDesign = useCallback((d: DesignDocument) => {
    setDoc(d);
    // reopen straight into the canvas so you resume where you were working —
    // blank designs always, and any plan design that already has floors built.
    // Only a plan design with nothing set up yet starts on Plans (upload → pick
    // → stack); once floors exist, Plans is a place you step *back* to, not into.
    setStep(d.meta.mode === "blank" || d.floors.length > 0 ? 1 : 0);
  }, []);

  /* ── arriving on a named design (`?design=<id>`, e.g. from a job sheet) ──

     Runs once, on mount, and only when nothing is open — never a swap, because
     there is no screen to leave: the studio opens ON the design rather than
     landing on Home and then travelling.

     The parameter is then STRIPPED with replaceState (no router push, the
     profile screen's pattern). Otherwise the URL keeps saying `?design=…`
     after you close the design and go back to Home, and a refresh from there
     would drag you back into a design you had deliberately left.

     A design that isn't there — deleted, or another org's id typed in — is
     said out loud rather than silently dropping you on Home wondering whether
     the link was broken or you were. */
  const [openFailed, setOpenFailed] = useState(false);
  const openedOnce = useRef(false);
  useEffect(() => {
    if (!openDesignId || openedOnce.current) return;
    openedOnce.current = true;
    let live = true;
    void getStore()
      .load(openDesignId)
      .catch(() => null)
      .then((d) => {
        if (!live) return;
        if (d) openDesign(d);
        else setOpenFailed(true);
        try {
          window.history.replaceState(null, "", window.location.pathname);
        } catch {
          /* no history in this environment — the design still opened */
        }
      });
    return () => {
      live = false;
    };
  }, [openDesignId, getStore, openDesign]);

  /* undo/redo restores an exact prior document — no updatedAt bump */
  const replaceDoc = useCallback((d: DesignDocument) => {
    setSaveState("saving");
    setDoc(d);
  }, []);

  /* ── design variations: sibling documents sharing a variants[] roster ── */
  const addVariant = useCallback(async () => {
    if (!doc) return;
    const now = new Date().toISOString();
    const currentLabel = doc.meta.variantLabel ?? "Option 1";
    const existing: DesignVariantRef[] =
      doc.variants.length > 0 ? doc.variants : [{ id: doc.id, label: currentLabel }];
    const newDocId = newId("dsn");
    const nextLabel = `Option ${existing.length + 1}`;
    const allVariants = [...existing, { id: newDocId, label: nextLabel }];

    const updatedCurrent: DesignDocument = {
      ...doc,
      meta: { ...doc.meta, variantLabel: currentLabel, updatedAt: now },
      variants: allVariants,
    };
    const newDoc: DesignDocument = {
      ...doc,
      id: newDocId,
      meta: { ...doc.meta, variantLabel: nextLabel, createdAt: now, updatedAt: now },
      variants: allVariants,
    };

    await getStore().save(updatedCurrent);
    await getStore().save(newDoc);
    // older siblings (3rd+ option) need the fuller roster too
    await Promise.all(
      existing
        .filter((v) => v.id !== doc.id)
        .map(async (v) => {
          const sib = await getStore().load(v.id);
          if (sib) await getStore().save({ ...sib, variants: allVariants });
        })
    );
    setDoc(newDoc);
    refreshRecents();
  }, [doc, getStore, refreshRecents]);

  const switchVariant = useCallback(
    async (id: string) => {
      if (!doc || id === doc.id) return;
      await getStore()
        .save(doc)
        .catch(() => {});
      const d = await getStore().load(id);
      if (d) setDoc(d); // keep the current step — this is the same editing session
    },
    [doc, getStore]
  );

  const renameVariant = useCallback(
    async (label: string) => {
      if (!doc) return;
      const trimmed = label.trim();
      if (!trimmed || trimmed === doc.meta.variantLabel) return;
      const updatedVariants = doc.variants.map((v) =>
        v.id === doc.id ? { ...v, label: trimmed } : v
      );
      mutate((d) => ({
        ...d,
        meta: { ...d.meta, variantLabel: trimmed },
        variants: updatedVariants,
      }));
      await Promise.all(
        updatedVariants
          .filter((v) => v.id !== doc.id)
          .map(async (v) => {
            const sib = await getStore().load(v.id);
            if (sib) await getStore().save({ ...sib, variants: updatedVariants });
          })
      );
    },
    [doc, getStore, mutate]
  );

  /* leaving the editor: flush the debounce before going (the local buffer already
     has it) — this runs during the fade-out, then backToHome lands the swap */
  const flushSave = useCallback(async () => {
    if (doc) {
      await getStore()
        .save(doc)
        .catch(() => {});
    }
  }, [doc, getStore]);

  const backToHome = useCallback(
    (opts?: { autoNew?: boolean }) => {
      setHomeAutoNew(Boolean(opts?.autoNew));
      setDoc(null);
      refreshRecents();
    },
    [refreshRecents]
  );

  /* menu Save — the same pipeline as autosave, just on demand. The debounced
     save may fire again right after; the upsert is idempotent. */
  const saveNow = useCallback(() => {
    if (!doc) return;
    setSaveState("saving");
    void getStore()
      .save(doc)
      .then(() => {
        retryIn.current = RETRY_BASE_MS;
        setSaveState("saved");
      })
      .catch(() => setSaveState("local"));
  }, [doc, getStore]);

  return (
    <div className="page in">
      <div
        className={`dstudio${doc ? " editing" : ""}${
          swapping ? " swapping" : ""
        }${exiting ? " exiting" : ""}`}
      >
        {doc ? (
          <Editor
            doc={doc}
            step={step}
            saveState={saveState}
            onStep={setStep}
            onMutate={mutate}
            onReplace={replaceDoc}
            onHome={() => throughSwap(flushSave, () => backToHome())}
            onNew={() => throughSwap(flushSave, () => backToHome({ autoNew: true }))}
            onSaveNow={saveNow}
            onAddVariant={addVariant}
            onSwitchVariant={switchVariant}
            onRenameVariant={renameVariant}
            planImages={planImagesInst}
            packLoader={packLoader}
            loadVariant={(id) => getStore().load(id)}
          />
        ) : (
          <Home
            recents={recents}
            autoNew={homeAutoNew}
            sm8Jobs={sm8Jobs}
            jobSearch={jobSearch}
            openFailed={openFailed}
            onCreate={(name, mode, job) =>
              throughSwap(async () => {
                const d = createDesign({
                  name,
                  mode,
                  jobNumber: job?.jobNumber,
                  client: job?.client,
                  site: job?.site,
                  job: job
                    ? { remoteId: job.remoteId, jobNumber: job.jobNumber || null }
                    : undefined,
                });
                await getStore().save(d);
                return d;
              }, openDesign)
            }
            onOpen={(id) =>
              throughSwap(
                () => getStore().load(id),
                (d) => {
                  if (d) openDesign(d);
                }
              )
            }
            onDelete={async (id) => {
              await getStore()
                .remove(id)
                .catch(() => {});
              refreshRecents();
            }}
            onImport={(d) =>
              throughSwap(async () => {
                await getStore().save(d);
                return d;
              }, openDesign)
            }
          />
        )}
      </div>
    </div>
  );
}

/* ═════════════ Home ═════════════ */

function Home({
  recents,
  autoNew,
  sm8Jobs,
  jobSearch,
  openFailed,
  onCreate,
  onOpen,
  onDelete,
  onImport,
}: {
  recents: DesignSummary[];
  /** arrive with the new-design wizard already open (menu → New) */
  autoNew?: boolean;
  /** offer "start from a ServiceM8 job" on the naming step */
  sm8Jobs?: boolean;
  jobSearch?: JobSearch;
  /** a `?design=<id>` link pointed at something that is no longer here */
  openFailed?: boolean;
  onCreate: (
    name: string,
    mode: "plan" | "blank",
    job?: JobPrefill
  ) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onImport: (doc: DesignDocument) => void;
}) {
  // new-design wizard: name the job first, then choose how to start. Home
  // remounts on every editor exit, so initial state is enough for autoNew.
  const [step, setStep] = useState<null | "name" | "mode">(
    autoNew ? "name" : null
  );
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── the ServiceM8 job behind this design, if it came from one.
        The field itself is JobSearchField — shared with the Summary sheet's
        attach control, which picks a job for a design that already exists. ── */
  const [picked, setPicked] = useState<StudioJobHit | null>(null);

  /* Picking a job names the design and remembers the three fields the Summary
     sheet prints. The name stays EDITABLE afterwards — the street is a good
     first answer, not the last word — and editing it doesn't unpick the job,
     because the job is what the client and site came from. */
  /* the injected search in tests, the real action in the app */
  const jobSearchFn = useCallback(
    (q: string) =>
      (jobSearch ?? ((s: string) => studioActions().then((a) => a.searchStudioJobs(s))))(q),
    [jobSearch]
  );

  const pickJob = (hit: StudioJobHit) => {
    const fill = prefillFromJob(hit);
    setPicked(hit);
    if (fill.name) setName(fill.name);
  };

  const unpickJob = () => setPicked(null);

  const visible = recents.filter((r) =>
    r.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  const trimmed = name.trim();
  const cancel = () => {
    setStep(null);
    setName("");
    unpickJob();
  };
  const create = (mode: "plan" | "blank") =>
    onCreate(
      trimmed || "Untitled design",
      mode,
      picked ? prefillFromJob(picked) : undefined
    );

  const importFile = async (file: File) => {
    setImportError(null);
    try {
      const { doc } = openDesignJson(await file.text());
      onImport(doc);
    } catch (e) {
      setImportError(
        e instanceof DesignDocumentError
          ? `${e.message}. Import takes design files exported from HeyTiff (.heytiff-design.json).`
          : "Couldn't read that file"
      );
    }
  };

  return (
    <div className="ds-home">
      {/* no `stgp`: the shell's pop-in stagger (.4s plus up to .18s of delays)
          replays every time Home remounts, so it ran ON TOP of the screen-swap
          fade and kept things moving for ~600ms after the swap had landed. The
          fade is the transition now. */}
      <div className="ds-home-stack">
        <section className="ds-hero">
          {step === "name" ? (
            <>
              <span className="ds-hero-step">Step 1 of 2</span>
              <h3 className="ds-hero-etitle">Name your design</h3>
              <p className="ds-hero-esub">
                {sm8Jobs
                  ? "Pull the job in from ServiceM8, or name it yourself — you'll choose how to start next."
                  : "Give the job a name — you'll choose how to start next."}
              </p>
              {/* The ServiceM8 step sits ABOVE the name field because it
                  ANSWERS it: pick the job and the name is filled in below,
                  where you can still change it. Underneath, it would read as
                  an afterthought to something already typed. */}
              {sm8Jobs && (
                <div className="ds-sm8">
                  {picked ? (
                    <div className="ds-sm8-on">
                      <Icon name="check" size={14} />
                      <span className="ds-sm8-onl">
                        From ServiceM8{" "}
                        {picked.jobNumber ? <b>job {picked.jobNumber}</b> : <b>job</b>}
                        {picked.clientName ? ` · ${picked.clientName}` : ""}
                      </span>
                      <button
                        type="button"
                        className="ds-sm8-clear"
                        onClick={unpickJob}
                        aria-label="Start from a different job"
                      >
                        <Icon name="x" size={13} />
                      </button>
                    </div>
                  ) : (
                    <JobSearchField onPick={pickJob} search={jobSearchFn} />
                  )}
                </div>
              )}
              <input
                className="ds-name-input"
                placeholder="Design name — e.g. 14 Harbour View Rd"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && trimmed) setStep("mode");
                  if (e.key === "Escape") cancel();
                }}
              />
              <div className="ds-hero-nav">
                <button className="ds-hero-back" onClick={cancel}>
                  <Icon name="chevL" size={14} />
                  Cancel
                </button>
                <button
                  className="ds-cta sm"
                  disabled={!trimmed}
                  onClick={() => setStep("mode")}
                >
                  Continue
                  <Icon name="chevR" size={16} />
                </button>
              </div>
            </>
          ) : step === "mode" ? (
            <>
              <span className="ds-hero-step">Step 2 of 2</span>
              <h3 className="ds-hero-etitle">How do you want to start?</h3>
              <p className="ds-hero-esub">
                Designing <b>{trimmed}</b>
                {picked?.jobNumber ? ` · ServiceM8 job ${picked.jobNumber}` : ""}
              </p>
              <div className="ds-opts">
                <button className="ds-opt" onClick={() => create("plan")}>
                  <span className="ds-opt-ic">
                    <Icon name="file" size={20} />
                  </span>
                  <span className="ds-opt-n">Upload floor plans</span>
                  <span className="ds-opt-d">
                    Bring in PDF or image plans, calibrate the scale and design
                    to size on the real drawing.
                  </span>
                </button>
                <button className="ds-opt" onClick={() => create("blank")}>
                  <span className="ds-opt-ic">
                    <Icon name="square" size={20} />
                  </span>
                  <span className="ds-opt-n">Blank canvas</span>
                  <span className="ds-opt-d">
                    Sketch a system with no plan — a scaled grid keeps everything
                    true to size.
                  </span>
                </button>
              </div>
              <button className="ds-hero-back" onClick={() => setStep("name")}>
                <Icon name="chevL" size={14} />
                Back
              </button>
            </>
          ) : (
            <>
              <span className="ds-hero-badge">
                <Icon name="wind" size={12} />
                Design Studio
              </span>
              <h2>
                Every system on the job,
                <br />
                on one canvas.
              </h2>
              <p>
                Splits, ducted, VRF and ventilation — designed on calibrated
                plans, validated live, with the materials list built for you.
              </p>
              <button className="ds-cta" onClick={() => setStep("name")}>
                <Icon name="plus" size={18} />
                New design
              </button>
            </>
          )}
        </section>

        <section className="ds-recent">
          <div className="ds-recent-head">
            <span className="ds-cardt">Recent designs</span>
            <div className="ds-recent-tools">
              {recents.length > 0 && (
                <label className="ds-search">
                  <Icon name="search" size={16} />
                  <input
                    placeholder="Search designs..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              )}
              <button
                className="ds-import"
                title="Restore a design exported from HeyTiff (.heytiff-design.json) — not for floor plans or CAD files"
                onClick={() => fileRef.current?.click()}
              >
                <Icon name="arrowUp" size={14} />
                Import design file
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importFile(f);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
          {openFailed && (
            <div className="ds-ierr">
              That design is no longer here — it may have been deleted. Anything
              still saved is in the list below.
            </div>
          )}
          {importError && <div className="ds-ierr">{importError}</div>}
          {visible.length > 0 ? (
            <div className="ds-rlist">
              {visible.map((r) => (
                <div
                  key={r.id}
                  className="ds-rcard"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(r.id)}
                  onKeyDown={(e) => e.key === "Enter" && onOpen(r.id)}
                >
                  <span className="ds-rthumb">
                    <Icon
                      name={r.mode === "plan" ? "file" : "square"}
                      size={19}
                    />
                  </span>
                  <span className="ds-rbody">
                    <div className="ds-rnm">{r.name}</div>
                    <div className="ds-rmeta">
                      {MODE_LABEL[r.mode]} · {r.floorCount}{" "}
                      {r.floorCount === 1 ? "floor" : "floors"} · {r.systemCount}{" "}
                      {r.systemCount === 1 ? "system" : "systems"}
                    </div>
                  </span>
                  <span className="ds-rwhen">{timeAgo(r.updatedAt)}</span>
                  <button
                    className={`ds-rdel${armedDelete === r.id ? " arm" : ""}`}
                    aria-label={`Delete ${r.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (armedDelete === r.id) {
                        setArmedDelete(null);
                        onDelete(r.id);
                      } else {
                        setArmedDelete(r.id);
                      }
                    }}
                    onBlur={() => setArmedDelete(null)}
                  >
                    {armedDelete === r.id ? (
                      "Delete?"
                    ) : (
                      <Icon name="x" size={15} />
                    )}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="ds-rempty">
              <div className="ds-rempty-t">
                {recents.length ? "No matches" : "No designs yet"}
              </div>
              <div className="ds-rempty-s">
                {recents.length
                  ? "Nothing matches that search."
                  : "Your recent work will appear here — start your first design on the left."}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ═════════════ Editor ═════════════ */

function Editor({
  doc,
  step,
  saveState,
  onStep,
  onMutate,
  onReplace,
  onHome,
  onNew,
  onSaveNow,
  onAddVariant,
  onSwitchVariant,
  onRenameVariant,
  planImages,
  packLoader,
  loadVariant,
}: {
  doc: DesignDocument;
  step: number;
  saveState: "saved" | "saving" | "local";
  onStep: (i: number) => void;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onReplace: (d: DesignDocument) => void;
  /** menu Open — Home IS the open-a-design screen */
  onHome: () => void;
  /** menu New — Home with the wizard auto-opened */
  onNew: () => void;
  /** menu Save — explicit flush of the autosave pipeline */
  onSaveNow: () => void;
  onAddVariant: () => void;
  onSwitchVariant: (id: string) => void;
  onRenameVariant: (label: string) => void;
  planImages: PlanImages;
  packLoader?: PackLoader;
  /** sibling variant docs for multi-option export (store-scoped) */
  loadVariant: (id: string) => Promise<DesignDocument | null>;
}) {
  /* ── undo/redo: record the outgoing document before every mutation ── */
  const historyRef = useRef(new History<DesignDocument>(50));
  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  /* refs can't be read during render — mirror can-undo/redo into state */
  const [hist, setHist] = useState({ undo: false, redo: false });
  const syncHist = useCallback(() => {
    setHist({
      undo: historyRef.current.canUndo,
      redo: historyRef.current.canRedo,
    });
  }, []);

  const mutate = useCallback(
    (fn: (d: DesignDocument) => DesignDocument) => {
      historyRef.current.record(docRef.current);
      onMutate(fn);
      syncHist();
    },
    [onMutate, syncHist]
  );

  const undo = useCallback(() => {
    const prev = historyRef.current.undo(docRef.current);
    if (prev) onReplace(prev);
    syncHist();
  }, [onReplace, syncHist]);

  const redo = useCallback(() => {
    const next = historyRef.current.redo(docRef.current);
    if (next) onReplace(next);
    syncHist();
  }, [onReplace, syncHist]);

  /* ── design-stage state (active floor is derived, never synced) ── */
  const [pickedFloorId, setPickedFloorId] = useState<string | null>(null);
  const activeFloorId =
    pickedFloorId && doc.floors.some((f) => f.id === pickedFloorId)
      ? pickedFloorId
      : (doc.floors[0]?.id ?? null);
  const [tool, setTool] = useState<CanvasTool>("select");
  /* room drawing is shape-first: "Draw a room" raises a pill offering the
     rectangle and polygon tools (they left the rail), and it folds away once
     a room lands */
  const [roomPicker, setRoomPicker] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /* reference-sheets viewer — browse the uploaded plan set without placing it */
  const [refOpen, setRefOpen] = useState(false);
  const hasReference = Boolean(doc.planImport?.sources?.length);
  /* canvas view state (transient, not persisted): layer visibility, plan
     grayscale, and the legend panel toggle */
  const [layers, setLayers] = useState<LayerFlags>(ALL_LAYERS_ON);
  const [grayscale, setGrayscale] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);

  /* ── fullscreen: the Workboard's display-mode pattern, ported ──
     The DOCUMENT goes fullscreen (never the studio element) because every
     studio overlay — unit browser, room modal, reference viewer, lightbox,
     guided prompts — portals to <body>; fullscreening anything deeper would
     hide them all. The shell is hidden by an attribute on <html>, not by
     unmounting it, so the canvas and every draft on it stay put. */
  const [fullscreen, setFullscreen] = useState(false);

  // Leaving browser fullscreen (Esc) leaves the mode — you must land back in
  // the app, not on a chromeless page in a window.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /* Cleanup runs on leaving the editor too (menu → New/Open unmounts it), so
     going Home can't strand you fullscreen with no chrome. */
  useEffect(() => {
    if (!fullscreen) return;
    const root = document.documentElement;
    root.setAttribute("data-ds-display", "on");
    return () => {
      root.removeAttribute("data-ds-display");
      if (document.fullscreenElement)
        void document.exitFullscreen?.()?.catch(() => {});
    };
  }, [fullscreen]);

  const toFullscreen = useCallback(() => {
    setFullscreen(true);
    /* A REJECTED request backs the mode out — being chromeless in a window is
       not what was asked for. A MISSING API doesn't: hiding the shell still
       buys the room, and the button is right there either way. */
    void document.documentElement
      .requestFullscreen?.()
      ?.catch(() => setFullscreen(false));
  }, []);

  /* simulation mode (Stage 12a, dev-flagged): the runtime is transient like
     the view state above — sim NEVER mutates the document. Held in STATE (not
     a ref) because present mode renders from it at the Editor level. */
  const [simRt, setSimRt] = useState<SimRuntime | null>(null);
  const simOn = simRt !== null;

  /* Whether the sim is offered at all — an env flag, or the localStorage
     opt-in. Read through useSyncExternalStore rather than set from an effect:
     localStorage does not exist on the server, so the value has to be `false`
     for the markup that gets hydrated and only then become true. That is
     exactly what the server-snapshot argument is for, and it avoids a mount
     render that says "off" followed by a second one that says "on". */
  const simFlag = useSyncExternalStore(subscribeNever, readSimFlag, () => false);

  /* guided calibration: opening an uncalibrated plan floor pops a "Calibrate
     the plan" step modal (DUCTR showCalibratePrompt) — once per floor, tracked
     so dismiss/skip doesn't re-nag. A confirmed scale then chains into the
     "Set north" step modal. */
  const [calibPrompt, setCalibPrompt] = useState(false);
  const [northPrompt, setNorthPrompt] = useState(false);
  const promptedFloors = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (step !== 1 || !activeFloorId) return;
    const f = doc.floors.find((x) => x.id === activeFloorId);
    if (f && f.scaleMmPerUnit == null && !promptedFloors.current.has(activeFloorId)) {
      promptedFloors.current.add(activeFloorId);
      setCalibPrompt(true);
    }
  }, [step, activeFloorId, doc.floors]);

  const activeFloor = doc.floors.find((f) => f.id === activeFloorId) ?? null;

  /* ── systems (Stage 4): product pack, active system, armed placement ── */
  const [pack, setPack] = useState<DataPack | null>(null);
  const [packVersion, setPackVersion] = useState<string>("2026.1");
  const [activeSystemId, setActiveSystemId] = useState<string | null>(null);
  const [placing, setPlacing] = useState<PlacingUnit | null>(null);
  /* room being configured in the heat-load modal (Slice 2) */
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  /* room whose external walls the canvas should re-mark (from the modal) */
  const [remarkRoomId, setRemarkRoomId] = useState<string | null>(null);
  /* room whose SHAPE the canvas should unpin for editing (from the modal) */
  const [reshapeRoomId, setReshapeRoomId] = useState<string | null>(null);
  /* the drawing tool-rail stays hidden until the first system exists, then
     latches on for the session — no point showing draw tools with nothing to
     draw for. Plan-prep (calibrate/crop/move) lives in the top bar regardless. */
  const [toolsRevealed, setToolsRevealed] = useState(false);

  /* the effective active system: the picked one, else the first system. The
     canvas scopes rooms/objects to this; room tools require it (type-first). */
  const effectiveSystemId =
    activeSystemId && doc.systems.some((s) => s.id === activeSystemId)
      ? activeSystemId
      : (doc.systems[0]?.id ?? null);

  /* A one-way latch: once a system exists the tools stay out, even if the
     system is later removed. Latched while rendering rather than in an effect,
     so the tools are present in the same paint that first has a system —
     an effect revealed them one render late. */
  if (effectiveSystemId && !toolsRevealed) setToolsRevealed(true);

  useEffect(() => {
    let on = true;
    const load =
      packLoader ??
      (() => packActions().then((a) => a.loadStudioPack("mitsubishi-electric")));
    load()
      .then((r) => {
        if (on && r) {
          setPack(r.pack);
          setPackVersion(r.version);
        }
      })
      .catch(() => {
        /* offline — proposals unavailable, drawing still works */
      });
    return () => {
      on = false;
    };
  }, [packLoader]);

  /* arm (or null-disarm) unit placement — armed by dragging a unit card */
  const armPlace = useCallback((p: PlacingUnit | null) => {
    setPlacing(p);
    setTool(p ? "place" : "select");
  }, []);

  /* a unit landed: disarm. Each card is dragged/placed on its own (Slice 3);
     no more auto-chaining IDU→ODU→pipe. */
  const onPlaced = useCallback(() => {
    setPlacing(null);
    setTool("select");
  }, []);

  /* ── air tools (Stage 7 Step 2): the Component tool, its palette and the
     armed component. C re-arms the last-used component; the dock button (and
     a first-ever C) opens the grid. ── */
  const [airComp, setAirComp] = useState<ArmedComponent | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const lastComp = useRef<AirComponentKind | null>(null);

  /* spec-§2 gate: the air tools need ≥1 served room AND an air-capable
     chosen/placed AHU — capability keys off UNIT data, not system type
     (spec §11.1), via the pack row of the placed IDU or settings.pairIdu. */
  const airGate = useMemo((): { ok: boolean; reason: string; row: IndoorUnit | null } => {
    if (!effectiveSystemId)
      return { ok: false, reason: "pick a system first", row: null };
    if (roomsServedBy(doc, effectiveSystemId).length === 0)
      return { ok: false, reason: "add a room first", row: null };
    const sys = doc.systems.find((s) => s.id === effectiveSystemId);
    const placedIdu = doc.objects.find(
      (o) =>
        o.systemId === effectiveSystemId && o.type === "unit" && o.props.role === "idu"
    );
    const model = String(placedIdu?.props.model ?? sys?.settings.pairIdu ?? "");
    const row = (model && pack?.indoor_units.find((u) => u.model === model)) || null;
    /* Say what to DO, not what's missing. "air-capable air handler" is the
       code's word for it and told you nothing — in particular it read as a
       different SYSTEM type, when the gate is really about the UNIT: a split
       pair with a ducted indoor is fine, a wall unit never is. */
    if (!row || !isAirCapable(row))
      return {
        ok: false,
        reason: "needs a ducted indoor unit; wall and cassette units carry no ductwork",
        row: null,
      };
    return { ok: true, reason: "", row };
  }, [doc, pack, effectiveSystemId]);

  const armComponent = useCallback((kind: AirComponentKind) => {
    lastComp.current = kind;
    setAirComp({ kind, stream: "supply" });
    setPaletteOpen(false);
    setTool("component");
  }, []);

  /* switching to any other tool disarms the component (and folds the palette) */
  const changeTool = useCallback((t: CanvasTool) => {
    if (t !== "component") {
      setAirComp(null);
      setPaletteOpen(false);
    }
    /* the room-shape pill mirrors whichever room tool is armed — any other
       tool (including the auto-disarm after a room lands) folds it away */
    setRoomPicker(t === "room-rect" || t === "room-poly");
    setTool(t);
  }, []);

  const onComponentPlaced = useCallback(() => {
    setAirComp(null);
    setTool("select");
  }, []);

  /* enter/exit simulation — entering disarms every tool (incl. the armed air
     component) and clears the selection; the canvas locks to pan/zoom while
     simming */
  const toggleSim = useCallback(() => {
    if (simOn) {
      setSimRt(null);
      return;
    }
    if (!activeFloorId) return;
    setSimRt(new SimRuntime(doc, pack, activeFloorId, 5));
    setPlacing(null);
    setAirComp(null);
    setPaletteOpen(false);
    setTool("select");
    setSelectedId(null);
  }, [simOn, doc, pack, activeFloorId]);

  /* any doc/floor change while simulating re-derives the model in place —
     temps and controller settings carry across by id */
  useEffect(() => {
    if (simRt && activeFloorId) simRt.rebuild(doc, pack, activeFloorId);
  }, [simRt, doc, pack, activeFloorId]);

  /* Simulate-from-Summary readiness: derive the active floor's model the same
     way toggleSim will, so the card can say WHY it's disabled instead of
     just greying out */
  const simReady = useMemo<SimReady>(() => {
    if (!activeFloor)
      return {
        ok: false,
        reason: "Add a floor first — there is nothing to simulate yet.",
        floorName: "",
      };
    const floorName = floorDisplayName(activeFloor);
    const m = buildSimModel(doc, pack, activeFloor.id);
    if (m.handlers.length > 0) return { ok: true, reason: "", floorName };
    const first = m.notReady[0];
    return {
      ok: false,
      reason: first
        ? `${first.systemName}: ${first.reason}`
        : "Draw a room and place a split system's units on the Design step first.",
      floorName,
    };
  }, [doc, pack, activeFloor]);

  const addFloor = useCallback(() => {
    mutate((d) => {
      const maxLevel = d.floors.reduce((m, f) => Math.max(m, f.level), -1);
      return {
        ...d,
        floors: [
          ...d.floors,
          {
            id: newId("flr"),
            name: maxLevel < 0 ? "Ground floor" : `Level ${maxLevel + 1}`,
            level: maxLevel + 1,
            scaleMmPerUnit: 10,
            northDeg: null,
            northPos: null,
            plans: [],
          },
        ],
      };
    });
  }, [mutate]);

  /* delete a floor: drop it, its rooms/units/pipework, its plan images from
     storage, and any import-session refs that pointed at those images (so a
     later Plans return sends those pages back to the tray, not a dead ref). */
  const deleteFloor = useCallback(
    (id: string) => {
      const sheets = doc.floors.find((f) => f.id === id)?.plans ?? [];
      const removedRefs = new Set(sheets.map((s) => s.imageRef));
      const keep = (o: DesignObject) => o.floorId !== id;
      mutate((d) => ({
        ...d,
        floors: d.floors.filter((f) => f.id !== id),
        // cross-floor runs (risers) lose attaches to what went with the floor
        systems: releaseRoomsFromSystems(d.systems, removedRoomIds(d.objects, keep)),
        objects: pruneObjects(d.objects, keep),
        planImport: d.planImport
          ? {
              ...d.planImport,
              placed: Object.fromEntries(
                Object.entries(d.planImport.placed).filter(([, ref]) => !removedRefs.has(ref))
              ),
            }
          : d.planImport,
      }));
      for (const s of sheets) void planImages.remove(s.imageRef).catch(() => {});
    },
    [doc.floors, mutate, planImages]
  );

  /* ── keyboard: ⌘Z/⇧⌘Z + tool hotkeys on the design step ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (step !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
      // C = Component (spec §3a — calibrate stays a top-toolbar pill): re-arm
      // the last-used component; the first-ever press opens the grid
      if (e.key.toLowerCase() === "c") {
        if (!airGate.ok) return;
        if (lastComp.current) armComponent(lastComp.current);
        else setPaletteOpen(true);
        return;
      }
      const toolKeys: Record<string, CanvasTool> = {
        v: "select",
        r: "room-rect",
        g: "room-poly",
        n: "set-north",
        x: "crop",
        m: "arrange",
        e: "erase",
        p: "pipe",
        i: "riser",
        k: "measure",
      };
      const next = toolKeys[e.key.toLowerCase()];
      if (!next) return;
      // the tape can only speak in metres — no scale, nothing to say
      if (next === "measure" && activeFloor?.scaleMmPerUnit == null) return;
      // room/pipe/riser draw all belong to a system — type-first: none without one
      if (
        (next === "room-rect" ||
          next === "room-poly" ||
          next === "pipe" ||
          next === "riser") &&
        !effectiveSystemId
      )
        return;
      changeTool(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    step,
    undo,
    redo,
    effectiveSystemId,
    airGate.ok,
    armComponent,
    changeTool,
    activeFloor?.scaleMmPerUnit,
  ]);

  return (
    <div className={`ds-editor${step === 1 && activeFloor ? " two-col" : ""}`}>
      {/* three tracks so the tab switcher sits dead-centre: the flanks share
          the leftover width equally, whatever each of them holds */}
      <header className="ds-topbar">
        <div className="ds-tb-left">
          <StudioMenu
            onNew={onNew}
            onOpen={onHome}
            onSave={onSaveNow}
            onEditPlans={() => onStep(0)}
            onReference={hasReference ? () => setRefOpen(true) : undefined}
            settings={doc.settings}
            onSettings={(patch) =>
              mutate((d) => ({ ...d, settings: { ...d.settings, ...patch } }))
            }
          />
          <div className="ds-id">
            <input
              className="ds-title-input"
              value={doc.meta.name}
              aria-label="Design name"
              onChange={(e) =>
                mutate((d) => ({
                  ...d,
                  meta: { ...d.meta, name: e.target.value },
                }))
              }
            />
            {/* Save status rides under the title — off the bar's width budget.

                When the server save has FAILED the label becomes the button:
                nothing retries on its own, so "Saved locally" would otherwise
                sit there until the next edit fired the debounce, and the only
                way out was a menu row you had to think to open. The affordance
                belongs where the person is already looking when they're
                worried. Every other state is a plain label — there is nothing
                to do about "Saved". */}
            {saveState === "local" ? (
              <button
                className="ds-save local retry"
                onClick={onSaveNow}
                title="This design is saved on this device only — click to save it to the server again"
              >
                <span className="dot" />
                Saved locally — retry
              </button>
            ) : (
              <span className={`ds-save ${saveState}`}>
                <span className="dot" />
                {saveState === "saving" ? "Saving…" : "Saved"}
              </span>
            )}
          </div>
        </div>
        {/* the canvas controls take the centre slot — the strip above the
            canvas is gone. Design step only; they're floor-scoped. */}
        {step === 1 && activeFloor && (
          <CanvasControls
            floors={doc.floors}
            floor={activeFloor}
            onFloor={setPickedFloorId}
            onAddFloor={addFloor}
            onDeleteFloor={deleteFloor}
            tool={tool}
            onTool={changeTool}
            layers={layers}
            onLayers={setLayers}
            grayscale={grayscale}
            onGrayscale={setGrayscale}
            legendOpen={legendOpen}
            onLegend={setLegendOpen}
            simFlag={simFlag}
            simOn={simOn}
            onToggleSim={toggleSim}
          />
        )}
        <div className="ds-tb-right">
          {/* fullscreen rides beside the switcher: one toggle, the browser's
              own Esc is the other way out */}
          <button
            className={`ds-fsbtn${fullscreen ? " on" : ""}`}
            onClick={() => (fullscreen ? setFullscreen(false) : toFullscreen())}
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            aria-pressed={fullscreen}
            title={
              fullscreen
                ? "Back to the app — Esc does the same"
                : "Fill the screen — same studio, no app frame"
            }
          >
            <Icon name={fullscreen ? "x" : "maximize"} size={16} />
          </button>
          {/* data-active drives the sliding thumb; -1 on the Plans screen,
              where neither tab is current and the thumb fades out */}
          <nav
            className="ds-steps"
            aria-label="Workflow"
            data-active={TABS.findIndex((t) => t.step === step)}
          >
            <span className="ds-steps-thumb" aria-hidden="true" />
            {TABS.map((t) => (
              <button
                key={t.step}
                className={`ds-step${step === t.step ? " active" : ""}`}
                onClick={() => onStep(t.step)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Design (step 1) fills the viewport with a fixed canvas; the document-
         like steps (Plans/Summary) scroll inside the locked page */}
      <div className={`ds-panel${step === 1 ? "" : " scroll"}`}>
        {step === 0 && (
          <PlansPanel
            doc={doc}
            onMutate={mutate}
            onAddFloor={addFloor}
            onOpenFloor={(id) => {
              setPickedFloorId(id);
              onStep(1);
            }}
            planImages={planImages}
          />
        )}
        {step === 1 && (
          <DesignPanel
            doc={doc}
            activeFloorId={activeFloorId}
            onAddFloor={addFloor}
            onGoPlans={() => onStep(0)}
            tool={tool}
            onTool={changeTool}
            airGate={airGate}
            paletteOpen={paletteOpen}
            onPalette={setPaletteOpen}
            airComp={airComp}
            onArmComponent={armComponent}
            onAirStream={(s) => setAirComp((c) => (c ? { ...c, stream: s } : c))}
            onComponentPlaced={onComponentPlaced}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMutate={mutate}
            planImages={planImages}
            pack={pack}
            activeSystemId={effectiveSystemId}
            revealTools={toolsRevealed}
            placing={placing}
            onPlaced={onPlaced}
            onRoomCreated={(id) => {
              setRoomPicker(false);
              setEditingRoomId(id);
            }}
            remarkRoomId={remarkRoomId}
            reshapeRoomId={reshapeRoomId}
            onReshapeConsumed={() => setReshapeRoomId(null)}
            undo={undo}
            redo={redo}
            hist={hist}
            onRemarkConsumed={() => setRemarkRoomId(null)}
            layers={layers}
            grayscale={grayscale}
            legendOpen={legendOpen}
            onLegend={setLegendOpen}
            onCalibrated={() => {
              const f = docRef.current.floors.find((x) => x.id === activeFloorId);
              if (f && !f.northPos) setNorthPrompt(true);
            }}
          />
        )}
        {step === 2 && (
          <SummaryView
            doc={doc}
            pack={pack}
            onMutate={mutate}
            onExportJson={() => downloadDesign(doc)}
            simFlag={simFlag}
            simReady={simReady}
            onSimulate={toggleSim}
            planImages={planImages}
            loadVariant={loadVariant}
          />
        )}
      </div>

      {/* Cockpit lives at the editor level so it spans the full height beside
          the header (see the .ds-editor grid). It stays MOUNTED off the Design
          step — its column animates shut instead of the panel snapping wide —
          and goes inert while collapsed so it's out of the tab order. */}
      {activeFloor && (
        <aside
          className="ds-sidecol"
          aria-hidden={step !== 1 ? true : undefined}
          inert={step !== 1 ? true : undefined}
        >
          <SystemCockpit
            doc={doc}
            pack={pack}
            packVersion={packVersion}
            activeSystemId={effectiveSystemId}
            onActivate={setActiveSystemId}
            onMutate={mutate}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onEditRoom={setEditingRoomId}
            onArmPlace={armPlace}
            roomDraw={{
              open: roomPicker,
              shape:
                tool === "room-rect" ? "rect" : tool === "room-poly" ? "poly" : null,
              start: () => setRoomPicker(true),
              // null cancels: changeTool("select") folds the picker away too
              pick: (s) =>
                changeTool(s === "rect" ? "room-rect" : s === "poly" ? "room-poly" : "select"),
            }}
            onFloor={setPickedFloorId}
            floor={activeFloor}
            onAddVariant={onAddVariant}
            onSwitchVariant={onSwitchVariant}
            onRenameVariant={onRenameVariant}
          />
        </aside>
      )}

      {/* present mode lives at the Editor level (it's a body portal), so
          Simulate works from Summary as well as the canvas pill — exiting
          lands you back on whichever step you launched from */}
      {simRt && activeFloor && (
        <SimPresentMode
          doc={doc}
          floor={activeFloor}
          pack={pack}
          planImages={planImages}
          activeSystemId={effectiveSystemId}
          runtime={simRt}
          onExit={toggleSim}
        />
      )}

      {refOpen && hasReference && (
        <ReferenceViewer
          doc={doc}
          planImages={planImages}
          onClose={() => setRefOpen(false)}
        />
      )}

      {editingRoomId && doc.objects.some((o) => o.id === editingRoomId) && (
        <RoomModal
          doc={doc}
          roomId={editingRoomId}
          onMutate={mutate}
          onClose={() => setEditingRoomId(null)}
          onRemarkWalls={(id) => {
            setEditingRoomId(null);
            setRemarkRoomId(id);
          }}
          onEditShape={(id) => {
            setEditingRoomId(null);
            setReshapeRoomId(id);
          }}
          onOpenReference={hasReference ? () => setRefOpen(true) : undefined}
        />
      )}

      {calibPrompt && activeFloor && activeFloor.scaleMmPerUnit == null && (
        <StepPrompt
          icon="ruler"
          title="Calibrate the plan"
          intro="Two quick steps to measure everything accurately:"
          bullets={[
            <>
              <strong>Set the scale</strong> — draw a line over a known dimension (e.g.
              a wall) and enter its real length.
            </>,
            <>
              <strong>Set north</strong> — so room orientations and solar loads come out
              right.
            </>,
          ]}
          actionLabel="Calibrate scale →"
          onSkip={() => setCalibPrompt(false)}
          onAction={() => {
            setCalibPrompt(false);
            changeTool("calibrate");
          }}
        />
      )}

      {northPrompt && activeFloor && !activeFloor.northPos && (
        <StepPrompt
          icon="compass"
          title="Set north direction"
          intro="Scale is set. Now orient the plan:"
          bullets={[
            <>
              <strong>Click the plan</strong> to drop the north marker.
            </>,
            <>
              <strong>Drag the N</strong> to point at true north — the whole marker
              rotates.
            </>,
            <>This drives each room&apos;s orientation and solar gain.</>,
          ]}
          actionLabel="Set north →"
          onSkip={() => setNorthPrompt(false)}
          onAction={() => {
            setNorthPrompt(false);
            changeTool("set-north");
          }}
        />
      )}
    </div>
  );
}

/* ═════════════ Studio menu ═════════════ */

/* The top-left menu — the file-style actions that used to be scattered chrome
   (the back arrow, Reference sheets) plus the Plans step, now behind "Edit
   plans". New/Open leave through the same swap as the old back arrow: Home IS
   the open-a-design screen. Export lives on Summary with Print — both are
   "get something out of this design".

   The load settings (climate zone / building type / sizing basis) live here
   too: they re-load every room in the engine, so they belong with the design
   chrome you use WHILE designing — the Summary only echoes them read-only.
   Changing a select keeps the menu open (only .ds-menu-item clicks close it),
   so you can watch the cockpit numbers move as you try zones. */
function StudioMenu({
  onNew,
  onOpen,
  onSave,
  onEditPlans,
  onReference,
  settings,
  onSettings,
}: {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onEditPlans: () => void;
  /** absent until plan pages exist — the item shows disabled */
  onReference?: () => void;
  settings: DesignSettings;
  onSettings: (patch: Partial<DesignSettings>) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = (
    icon: string,
    label: string,
    action: (() => void) | undefined,
    title?: string
  ) => (
    <button
      className="ds-menu-item"
      role="menuitem"
      disabled={!action}
      title={title}
      onClick={() => {
        setOpen(false);
        action?.();
      }}
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  );

  return (
    <div className="ds-menu-wrap" ref={boxRef}>
      <button
        className={`ds-menu-btn${open ? " on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="Studio menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="menu" size={17} />
      </button>
      {open && (
        <div className="ds-menu-pop" role="menu">
          {item("plus", "New", onNew)}
          {item("folder", "Open", onOpen)}
          {item("save", "Save", onSave)}
          <div className="ds-menu-sep" />
          {item("edit", "Edit plans", onEditPlans)}
          {item(
            "library",
            "Reference sheets",
            onReference,
            onReference
              ? "Browse every uploaded page — heights, sections, details"
              : "Reference sheets — upload plan pages first"
          )}
          <div className="ds-menu-sep" />
          <div
            className="ds-menu-set"
            role="group"
            aria-label="Load settings"
            title="Every room load re-derives from these — the whole design updates live"
          >
            <span className="ds-menu-set-t">Load settings</span>
            <label className="ds-menu-set-row">
              <span>Climate zone</span>
              <select
                value={String(effectiveClimateZone(settings))}
                onChange={(e) => onSettings({ climateZone: e.target.value })}
              >
                {Object.entries(CLIMATE_ZONES).map(([z, info]) => (
                  <option key={z} value={z}>
                    {info.label} — {info.cities.split(",")[0]}
                  </option>
                ))}
              </select>
            </label>
            <label className="ds-menu-set-row">
              <span>Building type</span>
              <select
                value={effectiveBuildingType(settings)}
                onChange={(e) => onSettings({ buildingType: e.target.value })}
              >
                <option value="residential">Residential</option>
                <option value="light_commercial">Light commercial</option>
                <option value="commercial">Commercial</option>
              </select>
            </label>
            <label className="ds-menu-set-row">
              <span>Size on</span>
              <select
                value={settings.sizingBasis}
                onChange={(e) =>
                  onSettings({ sizingBasis: e.target.value as SizingBasis })
                }
              >
                <option value="cooling">Cooling</option>
                <option value="heating">Heating</option>
                <option value="worst-of-both">Worst of both</option>
              </select>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═════════════ Stage panels — Stage-0 empty states ═════════════ */

const CANVAS_TOOLS: {
  key: CanvasTool;
  icon: string;
  label: string;
  kbd: string;
  needsSystem?: boolean;
}[] = [
  { key: "select", icon: "cursor", label: "Select", kbd: "V" },
  { key: "room-rect", icon: "square", label: "Room (rectangle)", kbd: "R", needsSystem: true },
  { key: "room-poly", icon: "hexagon", label: "Room (polygon)", kbd: "G", needsSystem: true },
  { key: "pipe", icon: "pipe", label: "Refrigerant run", kbd: "P", needsSystem: true },
  { key: "riser", icon: "arrowUp", label: "Riser (joins floors)", kbd: "I", needsSystem: true },
  { key: "crop", icon: "maximize", label: "Crop plan", kbd: "X" },
  { key: "arrange", icon: "hand", label: "Move plans", kbd: "M" },
  { key: "erase", icon: "eraser", label: "Eraser", kbd: "E" },
];

const LAYER_LABELS: Record<keyof LayerFlags, string> = {
  plan: "Floor plan",
  units: "Indoor units",
  pipes: "Pipework",
  labels: "Labels",
};

/* ═════════════ Canvas controls (topbar, Design step) ═════════════ */

/* A control menu is wider than the pill it hangs from, so it wants to be
   CENTRED on that pill — anchored to either edge it sits under a neighbouring
   pill and reads as belonging to that one instead. But the pills sit near the
   right of the bar and `.dstudio` clips with overflow:hidden, so centring
   alone pushes the rightmost menu off the frame and it gets sliced.
   So: centre, measure, and nudge back inside if it would overhang. The caret
   stays on the WRAPPER, so it keeps pointing at the trigger however far the
   menu is nudged. */
const MENU_EDGE_GAP = 8;

function useClampedMenu(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const place = () => {
      // measure from the centred position, then correct
      el.style.setProperty("--ds-menu-nudge", "0px");
      const frame = el.closest(".dstudio")?.getBoundingClientRect();
      if (!frame) return;
      const r = el.getBoundingClientRect();
      const over = r.right - (frame.right - MENU_EDGE_GAP);
      const under = frame.left + MENU_EDGE_GAP - r.left;
      const nudge = over > 0 ? -over : under > 0 ? under : 0;
      el.style.setProperty("--ds-menu-nudge", `${Math.round(nudge)}px`);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);
  return ref;
}

/* Floor ▾ · Calibrate · View · Simulate — relocated from the old strip above
   the canvas onto the topbar line. Everything they drive lives at the Editor
   level; only the popover-open state is local here. */
function CanvasControls({
  floors,
  floor,
  onFloor,
  onAddFloor,
  onDeleteFloor,
  tool,
  onTool,
  layers,
  onLayers,
  grayscale,
  onGrayscale,
  legendOpen,
  onLegend,
  simFlag,
  simOn,
  onToggleSim,
}: {
  floors: DesignDocument["floors"];
  floor: DesignDocument["floors"][number];
  onFloor: (id: string) => void;
  onAddFloor: () => void;
  onDeleteFloor: (id: string) => void;
  tool: CanvasTool;
  onTool: (t: CanvasTool) => void;
  layers: LayerFlags;
  onLayers: (l: LayerFlags) => void;
  grayscale: boolean;
  onGrayscale: (v: boolean) => void;
  legendOpen: boolean;
  onLegend: (v: boolean) => void;
  /** dev flag — the Simulate pill only renders when it's on */
  simFlag: boolean;
  simOn: boolean;
  onToggleSim: () => void;
}) {
  const sorted = [...floors].sort((a, b) => a.level - b.level);
  // two-step delete of a floor — armed per floor id so switching floors
  // mid-arm can't delete the wrong one
  const [armedDelFloor, setArmedDelFloor] = useState<string | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [calibOpen, setCalibOpen] = useState(false);
  const [floorMenuOpen, setFloorMenuOpen] = useState(false);
  const floorMenuRef = useClampedMenu(floorMenuOpen);
  const calibMenuRef = useClampedMenu(calibOpen);
  const viewMenuRef = useClampedMenu(layersOpen);

  return (
    <div className="ds-canvas-toggles">
      {/* Floor dropdown — current level + a menu of all floors (each with a
          red-on-hover delete x behind an "Are you sure?" confirm) + Add floor */}
      <div className="ds-layers-wrap ds-floor-wrap">
        <button
          className={`ds-floor-trigger${floorMenuOpen ? " on" : ""}`}
          onClick={() => {
            setArmedDelFloor(null);
            setCalibOpen(false);
            setLayersOpen(false);
            setFloorMenuOpen((v) => !v);
          }}
          title={`${floorDisplayName(floor)} — switch floor`}
        >
          <Icon name="layers" size={13} />
          {formatLevel(floor.level)}
          <Icon name="chevD" size={12} />
        </button>
        {floorMenuOpen && (
          <div className="ds-layers-menu ds-floor-menu" role="menu" ref={floorMenuRef}>
            {sorted.map((f) => (
              <div key={f.id} className={`ds-floor-row${f.id === floor.id ? " on" : ""}`}>
                <button
                  className="ds-floor-pick"
                  onClick={() => {
                    onFloor(f.id);
                    setFloorMenuOpen(false);
                  }}
                >
                  <span className="lvl">{formatLevel(f.level)}</span>
                  <span className="nm">{floorDisplayName(f)}</span>
                </button>
                {armedDelFloor === f.id ? (
                  <span className="ds-floor-confirm">
                    <button
                      className="yes"
                      onClick={() => {
                        onDeleteFloor(f.id);
                        setArmedDelFloor(null);
                      }}
                    >
                      Delete?
                    </button>
                    <button
                      className="no"
                      onClick={() => setArmedDelFloor(null)}
                      aria-label="Cancel delete"
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </span>
                ) : (
                  sorted.length > 1 && (
                    <button
                      className="ds-floor-x"
                      onClick={() => setArmedDelFloor(f.id)}
                      title="Delete this floor and everything on it"
                      aria-label={`Delete ${floorDisplayName(f)}`}
                    >
                      <Icon name="x" size={12} />
                    </button>
                  )
                )}
              </div>
            ))}
            <button
              className="ds-floor-add"
              onClick={() => {
                onAddFloor();
                setFloorMenuOpen(false);
              }}
            >
              <Icon name="plus" size={13} />
              Add floor
            </button>
          </div>
        )}
      </div>
      {/* Calibrate — one pill folding scale + north: orange until both are
          set, green when complete; the popover edits either */}
      <div className="ds-layers-wrap">
        <button
          className={`ds-calib-pill${
            floor.scaleMmPerUnit != null && floor.northPos ? " done" : ""
          }${
            calibOpen ||
            tool === "calibrate" ||
            tool === "measure" ||
            tool === "set-north" ||
            tool === "crop" ||
            tool === "arrange"
              ? " on"
              : ""
          }`}
          onClick={() => {
            setFloorMenuOpen(false);
            setLayersOpen(false);
            setCalibOpen((v) => !v);
          }}
          title="Calibrate — set the scale and north"
        >
          <Icon name="ruler" size={13} />
          <span className="ds-ctl-word">
            {floor.scaleMmPerUnit != null && floor.northPos ? "Calibrated" : "Calibrate"}
          </span>
          <Icon name="chevD" size={12} />
        </button>
        {calibOpen && (
          /* Two groups, captioned like the View menu: the calibration pair
             report a VALUE (or "Not set"), the plan tools are plain actions.
             They used to share one column, so "10.0 mm/px" and "Trim the
             plan" — a measurement and a description — read as the same kind
             of thing. Rows are .ds-calib-item, not .ds-calib-row: that name
             belongs to the on-canvas scale widget too, and its margin was
             bleeding 10px under every row in here. */
          <div className="ds-layers-menu ds-calib-menu" role="menu" ref={calibMenuRef}>
            <div className="ds-view-grp">Calibration</div>
            <button
              className="ds-calib-item"
              onClick={() => {
                onTool("calibrate");
                setCalibOpen(false);
              }}
            >
              <Icon name="ruler" size={13} />
              <span className="k">Scale</span>
              <span className={`v${floor.scaleMmPerUnit == null ? " unset" : ""}`}>
                {floor.scaleMmPerUnit != null
                  ? `${floor.scaleMmPerUnit.toFixed(1)} mm/px`
                  : "Not set"}
              </span>
            </button>
            <button
              className="ds-calib-item"
              onClick={() => {
                onTool("set-north");
                setCalibOpen(false);
              }}
            >
              <Icon name="compass" size={13} />
              <span className="k">North</span>
              <span className={`v${floor.northPos ? "" : " unset"}`}>
                {floor.northPos ? `${Math.round(floor.northDeg ?? 0)}°` : "Not set"}
              </span>
            </button>
            {/* A quick check on anything the drawing doesn't dimension. It's
                a READING, not a setting — it makes no mark and saves nothing —
                but it belongs with the measuring tools, and it can't say
                anything until the scale is set. */}
            <button
              className={`ds-calib-item${tool === "measure" ? " on" : ""}`}
              disabled={floor.scaleMmPerUnit == null}
              title={
                floor.scaleMmPerUnit == null
                  ? "Tape measure — calibrate the scale first"
                  : "Tape measure (K) — drag to read a distance"
              }
              onClick={() => {
                onTool("measure");
                setCalibOpen(false);
              }}
            >
              <Icon name="ruler" size={13} />
              <span className="k">Tape measure</span>
              <span className="v unset">{floor.scaleMmPerUnit == null ? "Needs scale" : "K"}</span>
            </button>
            {/* plan-prep tools relocated out of the drawing rail */}
            <div className="ds-view-sep" />
            <div className="ds-view-grp">Plan</div>
            <button
              className={`ds-calib-item${tool === "crop" ? " on" : ""}`}
              onClick={() => {
                onTool("crop");
                setCalibOpen(false);
              }}
              title="Crop the plan to the area you're working on"
            >
              <Icon name="maximize" size={13} />
              <span className="k">Crop</span>
            </button>
            <button
              className={`ds-calib-item${tool === "arrange" ? " on" : ""}`}
              onClick={() => {
                onTool("arrange");
                setCalibOpen(false);
              }}
              title="Reposition the plan sheets on this floor"
            >
              <Icon name="hand" size={13} />
              <span className="k">Move plans</span>
            </button>
          </div>
        )}
      </div>
      {/* View — one pill folding Layers, B&W and Legend into a popover */}
      <div className="ds-layers-wrap">
        <button
          className={`ds-ctl-btn${layersOpen ? " on" : ""}`}
          onClick={() => {
            setFloorMenuOpen(false);
            setCalibOpen(false);
            setLayersOpen((v) => !v);
          }}
          title="View — layers, black & white and legend"
        >
          <Icon name="layers" size={14} />
          <span className="ds-ctl-word">View</span>
        </button>
        {layersOpen && (
          <div className="ds-layers-menu ds-view-menu" role="menu" ref={viewMenuRef}>
            <div className="ds-view-grp">Layers</div>
            {(Object.keys(LAYER_LABELS) as (keyof LayerFlags)[]).map((k) => (
              <label key={k} className="ds-layer-row">
                <input
                  type="checkbox"
                  checked={layers[k]}
                  onChange={(e) => onLayers({ ...layers, [k]: e.target.checked })}
                />
                <span>{LAYER_LABELS[k]}</span>
              </label>
            ))}
            <div className="ds-view-sep" />
            <div className="ds-view-grp">Display</div>
            <label className="ds-layer-row">
              <input
                type="checkbox"
                checked={grayscale}
                onChange={(e) => onGrayscale(e.target.checked)}
              />
              <span>Black &amp; white</span>
            </label>
            <label className="ds-layer-row">
              <input
                type="checkbox"
                checked={legendOpen}
                onChange={(e) => onLegend(e.target.checked)}
              />
              <span>Show legend</span>
            </label>
          </div>
        )}
      </div>
      {simFlag && (
        <button
          className={`ds-ctl-btn ds-sim-go${simOn ? " on" : ""}`}
          onClick={onToggleSim}
          title={
            simOn
              ? "Exit the simulation"
              : "Simulate this floor — read-only, nothing in the design changes"
          }
        >
          <span className="ds-sim-play" aria-hidden>
            {simOn ? "■" : "▶"}
          </span>
          <span className="ds-ctl-word">{simOn ? "Exit sim" : "Simulate"}</span>
        </button>
      )}
    </div>
  );
}

function DesignPanel({
  doc,
  activeFloorId,
  onAddFloor,
  onGoPlans,
  tool,
  onTool,
  airGate,
  paletteOpen,
  onPalette,
  airComp,
  onArmComponent,
  onAirStream,
  onComponentPlaced,
  selectedId,
  onSelect,
  onMutate,
  planImages,
  pack,
  activeSystemId,
  revealTools,
  placing,
  onPlaced,
  onRoomCreated,
  remarkRoomId,
  onRemarkConsumed,
  reshapeRoomId,
  onReshapeConsumed,
  undo,
  redo,
  hist,
  layers,
  grayscale,
  legendOpen,
  onLegend,
  onCalibrated,
}: {
  doc: DesignDocument;
  activeFloorId: string | null;
  onAddFloor: () => void;
  onGoPlans: () => void;
  tool: CanvasTool;
  onTool: (t: CanvasTool) => void;
  /** spec-§2 air-tool gate (rooms + air-capable AHU) + the AHU's pack row */
  airGate: { ok: boolean; reason: string; row: IndoorUnit | null };
  paletteOpen: boolean;
  onPalette: (open: boolean) => void;
  airComp: ArmedComponent | null;
  onArmComponent: (kind: AirComponentKind) => void;
  onAirStream: (s: "supply" | "return") => void;
  onComponentPlaced: () => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  planImages: PlanImages;
  pack: DataPack | null;
  activeSystemId: string | null;
  /** reveal the drawing tool-rail — latched true once a system first exists */
  revealTools: boolean;
  /** the room-shape pill is up (raised by "Draw a room" / "Add room") */
  placing: PlacingUnit | null;
  onPlaced: () => void;
  onRoomCreated: (id: string) => void;
  remarkRoomId: string | null;
  onRemarkConsumed: () => void;
  reshapeRoomId: string | null;
  onReshapeConsumed: () => void;
  /** undo/redo — rendered as tools at the bottom of the rail */
  undo: () => void;
  redo: () => void;
  hist: { undo: boolean; redo: boolean };
  layers: LayerFlags;
  grayscale: boolean;
  legendOpen: boolean;
  onLegend: (v: boolean) => void;
  onCalibrated: () => void;
}) {
  const floor = doc.floors.find((f) => f.id === activeFloorId) ?? null;
  const [zoomApi, setZoomApi] = useState<ZoomApi | null>(null);
  const [zoomPct, setZoomPct] = useState(100);

  /* pack-row resolver the canvas uses for plenum specs / air capability —
     keyed to unit data, never system type (ducted spec §11.1) */
  const iduSpec = useCallback(
    (model: string) => pack?.indoor_units.find((u) => u.model === model) ?? null,
    [pack]
  );
  /** its outdoor twin — the hover card names both sides of a system */
  const oduSpec = useCallback(
    (model: string) => pack?.outdoor_units.find((u) => u.model === model) ?? null,
    [pack]
  );

  if (!floor) {
    return (
      <div className="ds-canvas-well">
        <div className="ds-empty">
          <span className="ds-empty-ic">
            <Icon name="layers" size={22} />
          </span>
          <div className="ds-empty-t">No floors yet</div>
          {doc.meta.mode === "plan" ? (
            <>
              <div className="ds-empty-s">
                This design works on real drawings — upload your plans and pick
                the pages, then come back here to design on them.
              </div>
              <button className="ds-tbbtn" onClick={onGoPlans}>
                <Icon name="file" size={15} />
                Go to Plans
              </button>
            </>
          ) : (
            <>
              <div className="ds-empty-s">
                Add a blank floor to start sketching on the scaled grid.
              </div>
              <button className="ds-tbbtn" onClick={onAddFloor}>
                <Icon name="plus" size={15} />
                Add a blank floor
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const toolButton = (t: (typeof CANVAS_TOOLS)[number]) => (
    <button
      key={t.key}
      className={`ds-tool${tool === t.key ? " on" : ""}`}
      title={
        t.needsSystem && !activeSystemId
          ? `${t.label} — pick a system first`
          : `${t.label} (${t.kbd})`
      }
      aria-label={t.label}
      disabled={Boolean(t.needsSystem) && !activeSystemId}
      onClick={() => onTool(t.key)}
    >
      <Icon name={t.icon as never} size={17} />
    </button>
  );

  return (
    <div className="ds-design">
      <div className="ds-canvas-col">
        <div className="ds-canvas-body">
          {revealTools && (
          <div className="ds-toolrail" role="toolbar" aria-label="Canvas tools">
            {/* room tools left the rail — they're offered by the shape pill,
                raised from the cockpit's Draw a room / Add room */}
            {CANVAS_TOOLS.slice(0, 1).map(toolButton)}
            {/* Air group (Stage 7): both tools gate on rooms + an air-capable AHU
                (spec §2); Duct arms at Step 4, Component opens the palette */}
            <button
              className="ds-tool"
              disabled
              aria-label="Duct"
              title="Ductwork arrives at Step 4"
            >
              <Icon name="wind" size={17} />
            </button>
            <div className="ds-pal-wrap">
              <button
                className={`ds-tool${tool === "component" ? " on" : ""}`}
                aria-label="Component"
                disabled={!airGate.ok}
                title={airGate.ok ? "Component (C)" : `Component — ${airGate.reason}`}
                onClick={() => onPalette(!paletteOpen)}
              >
                <Icon name="box" size={17} />
              </button>
              {paletteOpen && airGate.ok && (
                <ComponentPalette onPick={onArmComponent} onClose={() => onPalette(false)} />
              )}
            </div>
            {/* crop + move-plans live in the Calibrate dropdown now (plan-prep) */}
            {CANVAS_TOOLS.slice(3)
              .filter((t) => t.key !== "crop" && t.key !== "arrange")
              .map(toolButton)}
            {/* history — undo/redo live at the foot of the rail */}
            <div className="ds-rail-sep" />
            <button
              className="ds-tool"
              onClick={undo}
              disabled={!hist.undo}
              aria-label="Undo"
              title="Undo (⌘Z)"
            >
              <Icon name="rotate" size={17} />
            </button>
            <button
              className="ds-tool flip"
              onClick={redo}
              disabled={!hist.redo}
              aria-label="Redo"
              title="Redo (⇧⌘Z)"
            >
              <Icon name="rotate" size={17} />
            </button>
          </div>
          )}
          <StudioCanvas
            key={floor.id}
            doc={doc}
            floor={floor}
            tool={tool}
            selectedId={selectedId}
            onSelect={onSelect}
            onMutate={onMutate}
            onToolDone={() => onTool("select")}
            onCalibrated={onCalibrated}
            onZoomApi={setZoomApi}
            onZoomChange={setZoomPct}
            planImages={planImages}
            activeSystemId={activeSystemId}
            placing={placing}
            onPlaced={onPlaced}
            component={airComp}
            onComponentPlaced={onComponentPlaced}
            iduSpec={iduSpec}
            oduSpec={oduSpec}
            onRoomCreated={onRoomCreated}
            remarkRoomId={remarkRoomId}
            reshapeRoomId={reshapeRoomId}
            onReshapeConsumed={onReshapeConsumed}
            onRemarkConsumed={onRemarkConsumed}
            layers={layers}
            grayscale={grayscale}
            sim={null}
          />
        </div>
        {/* zoom floats over the canvas, bottom-right — its pre-strip home */}
        <div className="ds-zoomctl" role="group" aria-label="Zoom">
          <button aria-label="Zoom out" onClick={() => zoomApi?.zoomOut()}>
            −
          </button>
          <span>{zoomPct}%</span>
          <button aria-label="Zoom in" onClick={() => zoomApi?.zoomIn()}>
            +
          </button>
          <button aria-label="Fit to content" onClick={() => zoomApi?.fit()}>
            Fit
          </button>
        </div>
        {/* The room-shape pill used to live here, pinned to the top of the
            canvas. It has moved ONTO the cockpit's Add room / Draw a room
            button (RoomDrawControl): the choice now appears where the click
            landed instead of on the far side of the screen, which is what
            made pressing the button look like it did nothing. What the canvas
            still says is the tool hint and the crosshair cursor. */}
        {/* options HUD — floating pill strip, top-centre over the canvas,
            while a tool with options is armed (Step 2: the plenum variant) */}
        {tool === "component" && airComp?.kind === "plenum" && (
          <PlenumHud
            stream={airComp.stream}
            onStream={onAirStream}
            returnBuiltIn={airGate.row?.return_opening === "built-in"}
          />
        )}
        {legendOpen && (
          <div className="ds-legend" role="dialog" aria-label="Legend">
            <div className="ds-legend-h">
              <span>Legend</span>
              <button onClick={() => onLegend(false)} title="Close" aria-label="Close legend">
                ×
              </button>
            </div>
            {doc.systems.length > 0 ? (
              doc.systems.map((s) => (
                <div className="ds-legend-row" key={s.id}>
                  <span className="ds-legend-sw" style={{ background: s.colour }} />
                  {s.name}
                </div>
              ))
            ) : (
              <div className="ds-legend-empty">No systems yet</div>
            )}
            <div className="ds-legend-sym">
              <div className="ds-legend-row"><span className="ds-legend-ic room" /> Room</div>
              <div className="ds-legend-row"><span className="ds-legend-ic idu" /> Indoor unit</div>
              <div className="ds-legend-row"><span className="ds-legend-ic odu" /> Outdoor unit</div>
              <div className="ds-legend-row"><span className="ds-legend-ic riser" /> Riser</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
