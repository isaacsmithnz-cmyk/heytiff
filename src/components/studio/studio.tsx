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
import type { OrgBrand } from "@/lib/org/brand";
import { DotField } from "@/components/ui/dot-field";
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
import { CLIMATE_ZONES, sizingCapacityKw, type SizingBasis } from "@/lib/studio/loads";
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
import {
  noteAlive,
  noteBoot,
  setBuildStamp,
  noteGesture,
  readTrail,
} from "@/lib/studio/reload-breadcrumb";
import { RemoteDesignStore } from "@/lib/studio/remote-store";
import { History } from "@/lib/studio/history";
import {
  StudioCanvas,
  ALL_LAYERS_ON,
  DEFAULT_DRAW,
  isRunTool,
  type AirComponentKind,
  type ArmedComponent,
  type CanvasTool,
  type DrawOptions,
  type LayerFlags,
  type PlacingUnit,
  type ZoomApi,
} from "./canvas";
import { useWheelMode, WheelModeToggle } from "./wheel-toggle";
import { pairPipeSizes } from "@/lib/studio/components";
import { ComponentPalette, PlenumHud } from "./air-tools";
import { isAirCapable, moduleFor } from "@/lib/studio/modules";
import { roomCoverage, roomsServedBy, systemPairKw } from "@/lib/studio/coverage";
import { nextMove, panelRests, unitsVerb, type NextMove, type UnitsVerb } from "@/lib/studio/next-move";
import { roomAreaM2, roomLoadKw, type RoomObj } from "@/lib/studio/loads-room";
import type { PairProposal } from "@/lib/studio/split";
import { UnitBrowser } from "./unit-browser";
import { PlansPanel } from "./plans-panel";
import { StepPrompt } from "./step-prompt";
import {
  floorDisplayName,
  formatLevel,
  RemotePlanImages,
  type PlanImages,
} from "@/lib/studio/plans";
import { SummaryView } from "./summary/summary";
import { useOrgBrand } from "./summary/use-org-brand";
import type { SimReady } from "./summary/sim-card";
import { buildSimModel } from "@/lib/studio/sim";
import {
  isFloorApproved,
  setFloorApproval,
  simApprovalState,
} from "@/lib/studio/sim-approval";
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
  buildStamp,
  brand: servedBrand,
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
  /** Which build this tab is running, READ ON THE SERVER by the route. Only
      the reload breadcrumb uses it: it is how a tab that came back on a
      DIFFERENT deployment can say so, rather than guessing from the page. */
  buildStamp?: string;
  /** The business's letterhead, READ ON THE SERVER by the route. Held here
      rather than in the Summary sheet that renders it, because here is where
      it can be in hand before the sheet is opened — the logo is primed into
      the browser cache from the moment a design is, and the sheet's first
      paint already carries its frame. Absent (the tests), the hook asks for
      it itself. */
  brand?: OrgBrand;
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

  /* THE LETTERHEAD IS HELD AT THE TOP, not by the sheet that prints it. Held
     here it is in hand — and its logo already fetched — before Summary is
     ever pressed, which is the difference between a document that opens
     branded and one that opens plain and then reshapes around a frame. */
  const brand = useOrgBrand(servedBrand);

  /* null = the list has not answered yet. THREE STATES, not two: loading,
     empty, and no-matches. Collapsing the first into the second is how the
     home screen came to say "No designs yet" to somebody with three. */
  const [recents, setRecents] = useState<DesignSummary[] | null>(null);
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
    const store = getStore();
    /* paint what this machine already knows FIRST — a localStorage read — and
       let the merged answer replace it when the server gets back. Only a
       machine that has never opened a design here sees the loading state at
       all, and then it is telling the truth. */
    if (store.listLocal)
      void store.listLocal().then((local) => {
        if (local.length > 0) setRecents((cur) => cur ?? local);
      });
    void store.list().then(setRecents);
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

     A design that isn't there — deleted, or another org's id typed in — is
     said out loud rather than silently dropping you on Home wondering whether
     the link was broken or you were. */
  const [openFailed, setOpenFailed] = useState(false);
  /* nothing to say about the URL until an arrival has settled — see the sync
     effect below, which must not clear the very id it is being asked to open */
  const [arrived, setArrived] = useState(!openDesignId);
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
        setArrived(true);
      });
    return () => {
      live = false;
      /* and let a re-run try again. The guard above is a ref, so it survives a
         teardown that the in-flight load does NOT: without this, a double
         mount (React StrictMode in dev, or any remount) leaves the first load
         cancelled by `live` and the second refused by the ref, and the design
         named in the URL silently never opens. */
      openedOnce.current = false;
    };
  }, [openDesignId, getStore, openDesign]);

  /* ── the URL says which design is open ──

     `?design=<id>` is how a job sheet links in, and it is also how this screen
     survives being reloaded. Everything the studio knows lives in client
     state, so with a bare `/dashboard/studio` in the address bar any reload —
     a refresh, a deploy landing, a session hiccup, anything that quietly
     reloads the tab mid-session — comes back to Home with the design you were
     drawing nowhere in sight and no hint in the URL that anything happened.
     With the id there, the same reload comes back to the design.

     It used to be STRIPPED on arrival, for a real reason poorly served: a
     parameter left behind after you closed a design would drag you back into
     it on the next refresh. Keeping it IN STEP answers that properly — it is
     removed when you go Home, which is the moment you actually left.

     `replaceState`, never a router navigation: only the query moves, and the
     App Router folds that change into its own URL without a server round trip
     (`linking-and-navigating.md`, "Native History API"). A push would stack a
     history entry per design opened, turning Back into a tour of everything
     you looked at; and a `router.replace` would re-run the page on the server
     — including its capability check — for a change the server needn't hear
     about at all. The PATH never moves: the shell keys its outlet on pathname,
     and writing that would remount this whole screen. */
  /* Named out here rather than read off `doc` inside the effect, for two
     reasons. The dependency is the ID, not the document: `doc` is a new object
     on every stroke, and the URL has nothing to say about any of them. And
     React Compiler 1.0 cannot lower a value block — an optional chain, a `??`,
     a ternary — inside a try/catch, and answers by giving up on the WHOLE
     component, silently: lint, build and tests look identical either way. The
     canvas hoists its setPointerCapture calls out of a try for the same
     reason, and says so at the top of that file. */
  const openId = doc ? doc.id : null;

  /* ── the breadcrumb: why did this tab reload? ──
     A full document load wipes everything above and drops you on Home, and
     until now it left no trace — which is exactly why "it jumps back to the
     studio home page mid-design" could only ever be answered with a shortlist
     of suspects. Each load now reads what the previous one looked like as it
     ended and writes down which kind of ending it was, so the NEXT occurrence
     names the cause instead of us reasoning about it. Local, no network.

     The alive-crumb is rewritten whenever the open design changes and again on
     the way out; the gesture listeners are what separate a reload the person
     asked for from one that simply happened to them. */
  /* the stamp as it was at mount — a document boots once, so the effect must
     not re-run, and a ref says that without silencing the dependency rule */
  const stampAtMount = useRef(buildStamp);
  useEffect(() => {
    setBuildStamp(stampAtMount.current);
    noteBoot();
    window.__htDiag = readTrail;
    const gesture = () => noteGesture();
    window.addEventListener("pointerdown", gesture, { passive: true });
    window.addEventListener("keydown", gesture, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", gesture);
      window.removeEventListener("keydown", gesture);
    };
  }, []);
  useEffect(() => {
    noteAlive(openId, false);
    /* pagehide, not beforeunload: it fires for the back/forward cache and on
       mobile teardowns that never send beforeunload at all. */
    const bye = () => noteAlive(openId, true);
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, [openId]);
  useEffect(() => {
    if (!arrived) return;
    try {
      const here = new URL(window.location.href);
      // `get` already answers null when absent, so this needs no `??`
      if (here.searchParams.get("design") === openId) return;
      if (openId) here.searchParams.set("design", openId);
      else here.searchParams.delete("design");
      window.history.replaceState(null, "", `${here.pathname}${here.search}`);
    } catch {
      /* no history or URL in this environment — the design is still open */
    }
  }, [openId, arrived]);

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
            brand={brand}
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
  /** null while the list is still being fetched — see the three states below */
  recents: DesignSummary[] | null;
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

  const loading = recents === null;
  const known = recents ?? [];
  const visible = known.filter((r) =>
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
              <h2>Design Studio</h2>
              {/* The capture card's cloud, standing still on the landing, with
                  the button inside it rather than under it. Same instrument the
                  voice card thinks in — mounted straight into `cloud`, so its
                  one-time bloom out of the mark plays on arrival and it then
                  turns and darts on its own clocks for as long as the screen is
                  open. No `from`: there is no button here for it to have flown
                  out of.

                  `cols` is the density and `size` the reach — 44 over 760px is
                  ~300 dots, against the card's ~110. It is the biggest thing on
                  the screen, so it is drawn like it. */}
              <span className="ds-cloud">
                <DotField stage="cloud" size={760} cols={44} />
              </span>
              {/* The landing's one action, so it is sized like one: the mark
                  sits at the far end of a wide button and reads as the arrow
                  it already is, pointing at what happens next. */}
              <button
                className="ds-cta ds-start"
                onClick={() => setStep("name")}
              >
                New design
                <span className="ds-start-mk">
                  <Icon name="arrowR" size={20} />
                </span>
              </button>
            </>
          )}
        </section>

        <section className="ds-recent">
          <div className="ds-recent-head">
            <span className="ds-cardt">Recent designs</span>
            <div className="ds-recent-tools">
              {known.length > 0 && (
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
          {loading ? (
            /* THE SPACE THE LIST IS ABOUT TO OCCUPY, held so the click has
               somewhere to land — the shell's own `pk-b` sweep, slow and
               low-contrast because a fast shimmer reads as an error. The
               status line is for anyone not looking at shapes. */
            <div className="ds-rlist" aria-busy="true">
              <span className="ds-sr" role="status">
                Loading your designs…
              </span>
              {[0, 1, 2].map((i) => (
                <div key={i} className="ds-rcard skel" aria-hidden>
                  <span className="ds-rthumb ds-skb" />
                  <span className="ds-rbody">
                    <div className="ds-skb ds-skb-nm" />
                    <div className="ds-skb ds-skb-mt" />
                  </span>
                  <span className="ds-skb ds-skb-wh" />
                </div>
              ))}
            </div>
          ) : visible.length > 0 ? (
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
                {known.length ? "No matches" : "No designs yet"}
              </div>
              <div className="ds-rempty-s">
                {known.length
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
  brand,
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
  /** the business's letterhead, in hand from the route — see `Studio` */
  brand: OrgBrand;
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

  /* The rail's collapse belongs to the CANVAS: the seam handle shows, and a
     remembered data-rail takes effect, only while the editor is open (this
     attribute). Every other screen keeps the full rail — a collapsed strip
     with no handle there would have stranded people. Unmount lifts it, so
     leaving the editor restores the frame on its own. */
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-ds-canvas", "on");
    return () => root.removeAttribute("data-ds-canvas");
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
  /* the Next chip's unit browser — a room id while it's up. The chip owns its
     own browser instance rather than reaching into the cockpit's: choosing a
     pair is a settings write either way, and this keeps the chip's plumbing
     out of four component signatures. */
  const [pairBrowse, setPairBrowse] = useState<string | null>(null);
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

  /* switching to any other tool disarms the component (and folds the palette)
     — and lets go of a riding unit, so `placing` can never sit stale behind
     another tool (the Units button reads it as "armed") */
  const changeTool = useCallback((t: CanvasTool) => {
    if (t !== "component") {
      setAirComp(null);
      setPaletteOpen(false);
    }
    if (t !== "place") setPlacing(null);
    setTool(t);
  }, []);

  const onComponentPlaced = useCallback(() => {
    setAirComp(null);
    setTool("select");
  }, []);

  /* enter/exit simulation — entering disarms every tool (incl. the armed air
     component) and clears the selection; the canvas locks to pan/zoom while
     simming */
  /* ── the Next chip: the split module's first unmet requirement, named.
     Clicking ARMS the move — the chip is a control, not a caption. ── */
  const next = useMemo(
    () => nextMove(doc, pack, effectiveSystemId),
    [doc, pack, effectiveSystemId]
  );

  /* the chip's pair choice — the same write UnitsSub's picker commits: the
     pair models + the room it serves; a CHANGED pair takes the system's
     placed units and plumbing with it */
  const choosePairFromChip = useCallback(
    (pair: PairProposal, roomId: string) => {
      /* read the pre-write state for the arm decision below: a re-chosen
         identical pair keeps its placed units, and arming then would offer a
         second indoor unit */
      const cur = doc.systems.find((s) => s.id === effectiveSystemId);
      const changed =
        !cur ||
        pair.idu.model !== String(cur.settings.pairIdu ?? "") ||
        pair.odu.model !== String(cur.settings.pairOdu ?? "");
      const hadIdu = doc.objects.some(
        (o) =>
          o.systemId === effectiveSystemId && o.type === "unit" && o.props.role === "idu"
      );
      mutate((d) => {
        const sys = d.systems.find((s) => s.id === effectiveSystemId);
        const swap =
          !sys ||
          pair.idu.model !== String(sys.settings.pairIdu ?? "") ||
          pair.odu.model !== String(sys.settings.pairOdu ?? "");
        return {
          ...d,
          systems: d.systems.map((s) =>
            s.id === effectiveSystemId
              ? {
                  ...s,
                  settings: {
                    ...s.settings,
                    pairIdu: pair.idu.model,
                    pairOdu: pair.odu.model,
                    roomId,
                  },
                }
              : s
          ),
          objects: swap
            ? d.objects.filter(
                (o) =>
                  !(
                    o.systemId === effectiveSystemId &&
                    (o.type === "unit" || o.type === "pipe-run" || o.type === "riser")
                  )
              )
            : d.objects,
        };
      });
      setPairBrowse(null);
      /* choosing ARMS the indoor unit on the cursor — the drop that follows
         is the attribution */
      if (changed || !hadIdu)
        armPlace({
          role: "idu",
          model: pair.idu.model,
          widthMm: pair.idu.width_mm,
          depthMm: pair.idu.depth_mm,
        });
    },
    [doc, mutate, effectiveSystemId, armPlace]
  );

  /* Dragging a unit onto a room card ATTRIBUTES it and nothing more. Unlike
     choosePairFromChip it neither closes the browser nor arms the cursor:
     the workflow is attribute every room in one visit, then place the lot
     afterwards, so an arm here would fight the next drag. The unit becomes a
     pending item on the room — placement is a separate act. */
  const assignPairToRoom = useCallback(
    (pair: PairProposal, roomId: string) => {
      mutate((d) => {
        const sys = d.systems.find((s) => s.id === effectiveSystemId);
        const swap =
          !sys ||
          pair.idu.model !== String(sys.settings.pairIdu ?? "") ||
          pair.odu.model !== String(sys.settings.pairOdu ?? "");
        return {
          ...d,
          systems: d.systems.map((s) =>
            s.id === effectiveSystemId
              ? {
                  ...s,
                  settings: {
                    ...s.settings,
                    pairIdu: pair.idu.model,
                    pairOdu: pair.odu.model,
                    roomId,
                  },
                }
              : s
          ),
          /* a different pair takes the old units (and their pipework) back off
             the plan — the same rule choosePairFromChip applies, so the two
             routes to a pair can never leave different wreckage behind */
          objects: swap
            ? d.objects.filter(
                (o) =>
                  !(
                    o.systemId === effectiveSystemId &&
                    (o.type === "unit" || o.type === "pipe-run" || o.type === "riser")
                  )
              )
            : d.objects,
        };
      });
      /* the lens deliberately does NOT follow the drop. It decides which
         units the table recommends, so moving it would re-rank the list under
         someone mid-way through attributing several rooms — the drop says
         where this unit goes, not what to shop for next. */
    },
    [mutate, effectiveSystemId]
  );

  const onNext = useCallback(() => {
    if (!next) return;
    switch (next.key) {
      case "draw-room":
        changeTool("room-rect");
        break;
      case "choose-pair":
        setPairBrowse(next.roomId);
        break;
      case "place-idu":
      case "place-odu":
        armPlace(next.placing);
        break;
      case "connect":
        changeTool("pipe");
        break;
      case "complete":
        onStep(2);
        break;
    }
  }, [next, changeTool, armPlace, onStep]);

  /* ── the Units verb (bar, System group): browse → arm IDU → arm ODU →
     browse again as a swap. Pressing it while a unit rides the cursor
     cancels the arm instead. ── */
  const unitsV = useMemo(
    () => unitsVerb(doc, pack, effectiveSystemId),
    [doc, pack, effectiveSystemId]
  );

  const onUnits = useCallback(() => {
    if (placing) {
      armPlace(null);
      return;
    }
    if (!unitsV || unitsV.kind === "off") return;
    if (unitsV.kind === "browse") setPairBrowse(unitsV.roomId);
    else armPlace(unitsV.placing);
  }, [placing, unitsV, armPlace]);

  /* the armed pairing's capacity, for the canvas's room tint: pair-flow
     systems rate the pair; per-room modules rate the armed unit itself */
  const placingKw = useMemo(() => {
    if (!placing || placing.role !== "idu" || !pack || !effectiveSystemId) return null;
    const sys = doc.systems.find((s) => s.id === effectiveSystemId);
    if (!sys) return null;
    if (moduleFor(sys.type).unitFlow === "per-room") {
      const idu = pack.indoor_units.find((u) => u.model === placing.model);
      return idu ? sizingCapacityKw(idu, doc.settings.sizingBasis) : null;
    }
    return systemPairKw(doc, pack, effectiveSystemId, doc.settings.sizingBasis);
  }, [placing, pack, doc, effectiveSystemId]);

  /* ── the cockpit's two sizes: the flow picks (slice 6). Rested = a 46px
     status tab; open while the flow needs the panel (pair chosen, units
     unplaced), while something is selected (the inspector lives there), or
     while pinned. The pin is remembered PER SYSTEM TYPE — multi's tuning
     stage will want it standing open. Read through useSyncExternalStore so
     the server snapshot (nothing pinned) and the client settle without an
     effect — the same pattern as the shell rail. ── */
  const ckPins = useSyncExternalStore(subscribeCkPins, readCkPins, emptyCkPins);
  const activeSysType = doc.systems.find((s) => s.id === effectiveSystemId)?.type ?? null;
  const ckWouldRest = panelRests(doc, effectiveSystemId);
  const cockpitRested =
    ckWouldRest && !(activeSysType != null && ckPins[activeSysType]) && selectedId == null;
  const cockpitRest = useMemo(
    () => ({
      rested: cockpitRested,
      wouldRest: ckWouldRest,
      onExpand: () => {
        if (activeSysType) writeCkPin(activeSysType, true);
      },
      onRest: () => {
        if (activeSysType) writeCkPin(activeSysType, false);
        setSelectedId(null);
      },
    }),
    [cockpitRested, ckWouldRest, activeSysType]
  );

  /* rooms whose PLACED unit missed their load — the verdict that persists on
     the room label after the drop. A state, never a block. */
  const roomFits = useMemo(() => {
    const m: Record<string, "oversized" | "undersized"> = {};
    if (!pack) return m;
    for (const o of doc.objects) {
      if (o.type !== "room" || o.geometry.kind !== "polygon") continue;
      const cov = roomCoverage(doc, pack, o as RoomObj, doc.settings.sizingBasis);
      if (cov.loadKw == null || cov.coveredKw <= 0) continue;
      if (cov.oversized) m[o.id] = "oversized";
      else if (cov.status === "under") m[o.id] = "undersized";
    }
    return m;
  }, [doc, pack]);

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

  /* Has the simulation been ticked as fit to show a customer? Derived from the
     document, so the Summary chrome, the checks list and the customer's live
     link all read one verdict. See sim-approval.ts for why the tick pins to
     the design and why the option is all-or-nothing. */
  const simApproval = useMemo(
    () => simApprovalState(doc, pack),
    [doc, pack]
  );

  /* the switch in the simulation view. Reads through the same helper the
     verdict does, and writes through `mutate` so the tick autosaves and
     undoes like any other change to the document. */
  const activeFloorApproved = activeFloorId
    ? isFloorApproved(doc, activeFloorId)
    : false;
  const approveActiveFloor = useCallback(
    (on: boolean) => {
      const id = activeFloorId;
      if (!id) return;
      mutate((d) => setFloorApproval(d, id, on));
    },
    [activeFloorId, mutate]
  );

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
      // Esc lets go of a unit riding the cursor (the canvas clears its own
      // drafts from its listener — both fire)
      if (e.key === "Escape") {
        if (placing) armPlace(null);
        return;
      }
      // U = the Units verb: browse → arm IDU → arm ODU → browse-as-swap.
      // Inert while the browser is already up (typing there must not re-arm).
      if (e.key.toLowerCase() === "u") {
        if (!pairBrowse) onUnits();
        return;
      }
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
      // crop/move act on the plan sheets — a blank grid has none to trim or
      // slide, so the keys stay inert exactly like their greyed menu rows
      if (
        (next === "crop" || next === "arrange") &&
        (activeFloor?.plans.length ?? 0) === 0
      )
        return;

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
    // right-click disarms like Esc: let go of a unit riding the cursor (the
    // canvas's own contextmenu handler clears its drafts + returns to Select)
    const onCtx = () => {
      if (step === 1 && placing) armPlace(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", onCtx);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onCtx);
    };
  }, [
    step,
    undo,
    redo,
    effectiveSystemId,
    airGate.ok,
    armComponent,
    changeTool,
    activeFloor?.scaleMmPerUnit,
    activeFloor?.plans.length,
    placing,
    armPlace,
    pairBrowse,
    onUnits,
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
            next={next}
            onNext={onNext}
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
            unitsV={unitsV}
            onUnits={onUnits}
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
            placingKw={placingKw}
            roomFits={roomFits}
            onPlaced={onPlaced}
            onRoomCreated={(id) => {
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
            brand={brand}
            pack={pack}
            onMutate={mutate}
            onExportJson={() => downloadDesign(doc)}
            simFlag={simFlag}
            simReady={simReady}
            simApproval={simApproval}
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
          className={`ds-sidecol${cockpitRested ? " rest" : ""}`}
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
            onBrowseUnits={setPairBrowse}
            onFloor={setPickedFloorId}
            floor={activeFloor}
            rest={cockpitRest}
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
          approval={{
            on: activeFloorApproved,
            nameTheFloor: simApproval.simulatable.length > 1,
            onChange: approveActiveFloor,
          }}
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

      {/* THE unit browser — one instance, opened by the Units verb, the Next
          chip and the cockpit alike. Ranked against the lens room (the chips
          across its top switch the lens), committing the same settings write
          everywhere; choosing arms the indoor unit on the cursor. */}
      {pairBrowse && pack && (
        <LensedUnitBrowser
          doc={doc}
          pack={pack}
          systemId={effectiveSystemId}
          roomId={pairBrowse}
          onLens={setPairBrowse}
          onChoose={choosePairFromChip}
          onAssign={assignPairToRoom}
          onClose={() => setPairBrowse(null)}
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

/* ── the cockpit pin store (slice 6): which system TYPES hold their panel
   open. localStorage-backed, read via useSyncExternalStore — the snapshot is
   cached on the raw string so getSnapshot stays referentially stable. ── */
const CK_PIN_KEY = "ht-ckpin";
const emptyCkPinsValue: Record<string, boolean> = {};
const emptyCkPins = () => emptyCkPinsValue;
let ckPinsRaw: string | null = null;
let ckPinsCache: Record<string, boolean> = emptyCkPinsValue;
const ckPinListeners = new Set<() => void>();
function readCkPins(): Record<string, boolean> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(CK_PIN_KEY);
  } catch {
    /* storage unavailable — nothing is pinned */
  }
  if (raw !== ckPinsRaw) {
    ckPinsRaw = raw;
    try {
      ckPinsCache = raw ? (JSON.parse(raw) as Record<string, boolean>) : emptyCkPinsValue;
    } catch {
      ckPinsCache = emptyCkPinsValue;
    }
  }
  return ckPinsCache;
}
function writeCkPin(type: string, v: boolean) {
  const next = { ...readCkPins(), [type]: v };
  try {
    localStorage.setItem(CK_PIN_KEY, JSON.stringify(next));
  } catch {
    /* private mode — the pin won't survive a reload, but it works now */
  }
  ckPinsCache = next;
  ckPinsRaw = JSON.stringify(next);
  ckPinListeners.forEach((l) => l());
}
function subscribeCkPins(cb: () => void) {
  ckPinListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    ckPinListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

const CANVAS_TOOLS: {
  key: CanvasTool;
  icon: string;
  label: string;
  /** the word the toolbar wears; `label` stays the full accessible name */
  short: string;
  needsSystem?: boolean;
}[] = [
  { key: "select", icon: "cursor", label: "Select", short: "Select" },
  { key: "erase", icon: "eraser", label: "Eraser", short: "Erase" },
];

/** toolbar lookup by key — a find, not a Record, so a typo'd key fails loudly
    instead of type-checking into a fallback */
function tb(key: CanvasTool) {
  const t = CANVAS_TOOLS.find((x) => x.key === key);
  if (!t) throw new Error(`unknown canvas tool: ${key}`);
  return t;
}

const LAYER_LABELS: Record<keyof LayerFlags, string> = {
  plan: "Floor plan",
  units: "Indoor units",
  pipes: "Pipework",
  labels: "Labels",
};

/* ── THE unit browser, aimed at a room. A component rather than an inline
   block: the chips and the lens load are derived per render, and building
   them inside the editor's own render meant handing the browser a callback
   that reaches the history refs — which is a real hazard there (and what
   react-hooks/refs was pointing at), not a lint technicality. Here the
   derivation happens in this component's render and the handler is just a
   prop. ── */
function LensedUnitBrowser({
  doc,
  pack,
  systemId,
  roomId,
  onLens,
  onChoose,
  onAssign,
  onClose,
}: {
  doc: DesignDocument;
  pack: DataPack;
  systemId: string | null;
  /** the lens: the room the ranking reads through, and the fallback the
      drop attributes to */
  roomId: string;
  onLens: (roomId: string) => void;
  onChoose: (pair: PairProposal, roomId: string) => void;
  /** a unit dragged onto a room card — records the attribution and leaves the
      browser open, unlike onChoose which commits and arms the cursor */
  onAssign: (pair: PairProposal, roomId: string) => void;
  onClose: () => void;
}) {
  const served = roomsServedBy(doc, systemId);
  const room = served.find((r) => r.id === roomId);
  if (!room) return null;
  const sys = doc.systems.find((s) => s.id === systemId);
  const rooms = served.map((r) => {
    const placed = doc.objects.find(
      (o) =>
        o.type === "unit" &&
        o.props.role === "idu" &&
        String(o.props.roomId ?? "") === r.id
    );
    /* what this room has been given: the unit standing in it, else the pair
       chosen FOR it and still waiting to be placed (the pending state the
       toolbar tray will read) */
    const pending =
      sys && String(sys.settings.roomId ?? "") === r.id
        ? String(sys.settings.pairIdu ?? "")
        : "";
    return {
      id: r.id,
      name: String(r.props.name ?? "Room"),
      areaM2: roomAreaM2(doc, r),
      loadKw: roomLoadKw(doc, r),
      served: !!placed,
      assignedModel: String(placed?.props.model ?? "") || pending || null,
    };
  });
  return (
    <UnitBrowser
      pack={pack}
      loadKw={roomLoadKw(doc, room)}
      basis={doc.settings.sizingBasis}
      rooms={rooms}
      lensId={room.id}
      onLens={onLens}
      onChoose={(pair) => onChoose(pair, room.id)}
      onAssign={onAssign}
      onClose={onClose}
    />
  );
}

/* ── the Room tool: ONE bench button; the shape choice (square or drawn)
   appears where the click landed, and picking either arms its draw tool.
   R and G still arm each shape directly from the keyboard. ── */
function RoomTool({
  tool,
  onTool,
  disabled,
}: {
  tool: CanvasTool;
  onTool: (t: CanvasTool) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
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
  const on = tool === "room-rect" || tool === "room-poly";
  const arm = (t: CanvasTool) => {
    onTool(t);
    setOpen(false);
  };
  return (
    <div className="ds-pal-wrap" ref={wrapRef}>
      <button
        className={`ds-tool${on ? " on" : ""}`}
        aria-label="Room"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title={disabled ? "Room — pick a system first" : "Room — square or drawn shape"}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="square" size={15} />
        Room
      </button>
      {open && !disabled && (
        <div className="ds-roomfly" role="menu" aria-label="Room shape">
          <button role="menuitem" onClick={() => arm("room-rect")}>
            <Icon name="square" size={14} />
            Square
          </button>
          <button role="menuitem" onClick={() => arm("room-poly")}>
            <Icon name="hexagon" size={14} />
            Shape
          </button>
        </div>
      )}
    </div>
  );
}

/* ── the Draw tool: ONE bench button for everything drawn as a line. The
   flyout names the three families — pipe (soft or hard drawn), drain (size
   picked at draw), cable (power or data) — and each chip arms its tool with
   that option. Soft pipe and cable place dots that smooth into a curve; hard
   pipe and drain stay orthogonal. P still arms pipe from the keyboard. ── */
function DrawTool({
  tool,
  onTool,
  draw,
  onDraw,
  disabled,
}: {
  tool: CanvasTool;
  onTool: (t: CanvasTool) => void;
  draw: DrawOptions;
  onDraw: (d: DrawOptions) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
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
  const on = isRunTool(tool) || tool === "riser";
  const arm = (t: CanvasTool, patch?: Partial<DrawOptions>) => {
    if (patch) onDraw({ ...draw, ...patch });
    onTool(t);
    setOpen(false);
  };
  const chip = (
    label: string,
    active: boolean,
    t: CanvasTool,
    patch?: Partial<DrawOptions>
  ) => (
    <button
      key={label}
      role="menuitemradio"
      aria-checked={active && tool === t}
      className={`ds-drawchip${active && tool === t ? " on" : ""}`}
      onClick={() => arm(t, patch)}
    >
      {label}
    </button>
  );
  return (
    <div className="ds-pal-wrap" ref={wrapRef}>
      <button
        className={`ds-tool${on ? " on" : ""}`}
        aria-label="Draw"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title={
          disabled
            ? "Draw — pick a system first"
            : "Draw — pipe, drain, cable or riser"
        }
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="pipe" size={15} />
        Draw
      </button>
      {open && !disabled && (
        <div className="ds-roomfly ds-drawfly" role="menu" aria-label="Draw a line">
          <div className="ds-drawrow">
            <span className="ds-drawk">
              <Icon name="pipe" size={14} />
              Pipe
            </span>
            <div className="ds-drawchips">
              {chip("Hard drawn", draw.pipeForm === "hard", "pipe", { pipeForm: "hard" })}
              {chip("Soft drawn", draw.pipeForm === "soft", "pipe", { pipeForm: "soft" })}
            </div>
          </div>
          <div className="ds-drawrow">
            <span className="ds-drawk">
              <Icon name="droplet" size={14} />
              Drain
            </span>
            <div className="ds-drawchips">
              {[20, 25, 32, 40].map((mm) =>
                chip(`Ø${mm}`, draw.drainMm === mm, "drain", { drainMm: mm })
              )}
            </div>
          </div>
          <div className="ds-drawrow">
            <span className="ds-drawk">
              <Icon name="zap" size={14} />
              Cable
            </span>
            <div className="ds-drawchips">
              {chip("Power", draw.cableKind === "power", "cable", { cableKind: "power" })}
              {chip("Data", draw.cableKind === "data", "cable", { cableKind: "data" })}
            </div>
          </div>
          {/* the riser rides along: not linework (a point that joins floors),
              but it belongs to the same "put pipework on the plan" verb */}
          <div className="ds-drawrow">
            <span className="ds-drawk">
              <Icon name="arrowUp" size={14} />
              Riser
            </span>
            <div className="ds-drawchips">
              {chip("Joins floors", true, "riser")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
  next,
  onNext,
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
  /** the flow's first unmet requirement — the chip rides this row now, in
      line with the floor/Calibrate/View pills (the bench keeps the verbs) */
  next: NextMove | null;
  onNext: () => void;
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
              {floor.scaleMmPerUnit == null ? (
                <span className="v unset">Needs scale</span>
              ) : (
                <span className="v kbd">K</span>
              )}
            </button>
            {/* plan-prep tools relocated out of the drawing rail. Both act on
                the plan SHEETS, so a blank grid greys them and says why in
                place — armed over nothing they just went silent. */}
            <div className="ds-view-sep" />
            <div className="ds-view-grp">Plan</div>
            <button
              className={`ds-calib-item${tool === "crop" ? " on" : ""}`}
              disabled={floor.plans.length === 0}
              onClick={() => {
                onTool("crop");
                setCalibOpen(false);
              }}
              title={
                floor.plans.length === 0
                  ? "Crop — this floor is a blank grid, there's no plan to trim"
                  : "Crop the plan to the area you're working on (X)"
              }
            >
              <Icon name="maximize" size={13} />
              <span className="k">Crop</span>
              {floor.plans.length === 0 ? (
                <span className="v unset">No plan</span>
              ) : (
                <span className="v kbd">X</span>
              )}
            </button>
            <button
              className={`ds-calib-item${tool === "arrange" ? " on" : ""}`}
              disabled={floor.plans.length === 0}
              onClick={() => {
                onTool("arrange");
                setCalibOpen(false);
              }}
              title={
                floor.plans.length === 0
                  ? "Move plans — this floor is a blank grid, there are no sheets to move"
                  : "Reposition the plan sheets on this floor (M)"
              }
            >
              <Icon name="hand" size={13} />
              <span className="k">Move plans</span>
              {floor.plans.length === 0 ? (
                <span className="v unset">No plan</span>
              ) : (
                <span className="v kbd">M</span>
              )}
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
      {next && (
        <button
          className={`ds-nextchip${next.key === "complete" ? " done" : ""}`}
          onClick={onNext}
          title={
            next.key === "complete"
              ? "Every requirement is met — open the Summary"
              : "Arm the next move"
          }
        >
          <span className="ds-nextdot" aria-hidden="true" />
          {next.key === "complete" ? next.label : `Next: ${next.label}`}
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
  unitsV,
  onUnits,
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
  placingKw,
  roomFits,
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
  /** the Units verb's current meaning (null: this system type still picks
      its units in the panel) — the button wears the reason in place */
  unitsV: UnitsVerb | null;
  onUnits: () => void;
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
  /** armed pairing's capacity — the canvas tints rooms against their loads */
  placingKw: number | null;
  /** rooms whose placed unit missed their load (persists on the label) */
  roomFits: Record<string, "oversized" | "undersized">;
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
  const wheelMode = useWheelMode();
  /* the Draw flyout's armed options (pipe form, drain size, cable kind) —
     view state: what the NEXT line is, never what a drawn one was */
  const [draw, setDraw] = useState<DrawOptions>(DEFAULT_DRAW);
  /* pairing line sizes per system — what a drawn pipe autosizes its label to
     (per-run props override in the object card) */
  const runSizes = useMemo(() => {
    const m = new Map<string, { liquidMm: number; gasMm: number }>();
    for (const s of doc.systems) {
      const sz = pairPipeSizes(doc, pack, s);
      if (sz) m.set(s.id, sz);
    }
    return m;
  }, [doc, pack]);

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
          : t.label
      }
      aria-label={t.label}
      disabled={Boolean(t.needsSystem) && !activeSystemId}
      onClick={() => onTool(t.key)}
    >
      <Icon name={t.icon as never} size={15} />
      {t.short}
    </button>
  );

  return (
    <div className="ds-design">
      <div className="ds-canvas-col">
        {revealTools && (
          <div className="ds-toolbar" role="toolbar" aria-label="Canvas tools">
            {/* the bench reads in workflow order: Select, then Room, then the
                system verbs, then Erase — with history at the far end. The
                separators alone carry the grouping (the uppercase group titles
                are gone — Isaac, 2026-08-24). */}
            {toolButton(tb("select"))}
            <span className="ds-tb-sep" aria-hidden="true" />
            <RoomTool tool={tool} onTool={onTool} disabled={!activeSystemId} />
            <span className="ds-tb-sep" aria-hidden="true" />
            {/* Units leads the System group — the workflow places before it
                connects. One verb, three meanings: browse (nothing chosen),
                arm the next unplaced unit, browse again as a swap. While a
                unit rides the cursor the button is lit and a press disarms. */}
            <button
              className={`ds-tool${tool === "place" ? " on" : ""}`}
              aria-label="Units"
              disabled={!unitsV || unitsV.kind === "off"}
              title={
                !activeSystemId
                  ? "Units — pick a system first"
                  : !unitsV
                    ? "Units — this system type still picks its units in the panel"
                    : unitsV.kind === "off"
                      ? `Units — ${unitsV.reason}`
                      : tool === "place"
                        ? "Let go of the unit"
                        : unitsV.kind === "browse"
                          ? "Choose the units"
                          : "Place the next unit"
              }
              onClick={onUnits}
            >
              <Icon name="unit" size={15} />
              Units
            </button>
            <DrawTool
              tool={tool}
              onTool={onTool}
              draw={draw}
              onDraw={setDraw}
              disabled={!activeSystemId}
            />
            {/* Air group (Stage 7): both tools gate on rooms + an air-capable AHU
                (spec §2); Duct arms at Step 4, Component opens the palette */}
            <button
              className="ds-tool"
              disabled
              aria-label="Duct"
              title="Ductwork arrives at Step 4"
            >
              <Icon name="wind" size={15} />
              Duct
            </button>
            <div className="ds-pal-wrap">
              <button
                className={`ds-tool${tool === "component" ? " on" : ""}`}
                aria-label="Component"
                disabled={!airGate.ok}
                title={airGate.ok ? "Component" : `Component — ${airGate.reason}`}
                onClick={() => onPalette(!paletteOpen)}
              >
                <Icon name="box" size={15} />
                Component
              </button>
              {paletteOpen && airGate.ok && (
                <ComponentPalette onPick={onArmComponent} onClose={() => onPalette(false)} />
              )}
            </div>
            {/* crop + move-plans live in the Calibrate dropdown now (plan-prep) */}
            <span className="ds-tb-sep" aria-hidden="true" />
            {toolButton(tb("erase"))}
            <div className="ds-tb-spring" />
            <button
              className="ds-tool"
              onClick={undo}
              disabled={!hist.undo}
              aria-label="Undo"
              title="Undo (⌘Z)"
            >
              <Icon name="rotate" size={15} />
            </button>
            <button
              className="ds-tool flip"
              onClick={redo}
              disabled={!hist.redo}
              aria-label="Redo"
              title="Redo (⇧⌘Z)"
            >
              <Icon name="rotate" size={15} />
            </button>
          </div>
        )}
        <div className="ds-canvas-body">
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
            placingKw={placingKw}
            roomFits={roomFits}
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
            draw={draw}
            runSizes={runSizes}
            wheelMode={wheelMode}
          />
        </div>
        {/* zoom floats over the canvas, bottom-right — its pre-strip home.
            The scroll toggle leads it: what the wheel does is a fact about
            THIS view, and it belongs where the view's other controls are. */}
        <div className="ds-zoomctl" role="group" aria-label="Zoom">
          <WheelModeToggle value={wheelMode} />
          <button aria-label="Zoom out" onClick={() => zoomApi?.zoomOut()}>
            −
          </button>
          <span className="ds-zoomval">{zoomPct}%</span>
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
              <div className="ds-legend-row"><span className="ds-legend-ic drain" /> Drain</div>
              <div className="ds-legend-row"><span className="ds-legend-ic cable" /> Cable</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
