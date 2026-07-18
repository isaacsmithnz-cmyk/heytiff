"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import {
  createDesign,
  newId,
  type DesignDocument,
  type DesignVariantRef,
} from "@/lib/studio/document";
import { openDesignJson, DesignDocumentError } from "@/lib/studio/migrations";
import {
  browserDesignStore,
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
import { MaterialsView, JobView } from "./split-panel";
import { SystemCockpit } from "./cockpit-panel";
import { RoomModal } from "./room-modal";
import { ReferenceViewer } from "./reference-viewer";
import { SimPresentMode } from "./sim-present";
import { SimRuntime } from "@/lib/studio/sim-runtime";
import type { DataPack, IndoorUnit } from "@/lib/studio/packs/schema";
import "./studio.css";

/* server actions load lazily so jsdom tests never parse the auth0 runtime —
   same pattern as remote-store.ts */
const packActions = () => import("@/app/actions/studio-packs");

/* Design Studio — Stage 0: shell mount, home + new-design flow, workflow
   stepper, autosaving document, per-stage empty states. The canvas engine,
   plans pipeline and system modules land in Stages 1+ on top of this frame. */

const STEPS = [
  { key: "plans", label: "Plans" },
  { key: "design", label: "Design" },
  { key: "materials", label: "Materials" },
  { key: "job", label: "Job" },
] as const;

const MODE_LABEL = { plan: "Floor plans", blank: "Blank canvas" } as const;

/* screen-swap timings — see throughSwap(). Must stay in step with the .2s
   exit transitions on `.dstudio.swapping .ds-home-stack` in studio.css: the
   leaving screen has to be fully gone before the swap lands. */
const SWAP_OUT_MS = 200;
const SWAP_PAINT_MS = 16; // one frame, so the arriving screen has a state to animate from

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function Studio({
  store,
  planImages,
}: {
  store?: DesignStore;
  planImages?: PlanImages;
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
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("local"));
    }, 600);
    return () => clearTimeout(t);
  }, [doc, getStore]);

  const openDesign = useCallback((d: DesignDocument) => {
    setDoc(d);
    // reopen straight into the canvas so you resume where you were working —
    // blank designs always, and any plan design that already has floors built.
    // Only a plan design with nothing set up yet starts on Plans (upload → pick
    // → stack); once floors exist, Plans is a place you step *back* to, not into.
    setStep(d.meta.mode === "blank" || d.floors.length > 0 ? 1 : 0);
  }, []);

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

  const backToHome = useCallback(() => {
    setDoc(null);
    refreshRecents();
  }, [refreshRecents]);

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
            onHome={() => throughSwap(flushSave, backToHome)}
            onAddVariant={addVariant}
            onSwitchVariant={switchVariant}
            onRenameVariant={renameVariant}
            planImages={planImagesInst}
          />
        ) : (
          <Home
            recents={recents}
            onCreate={(name, mode) =>
              throughSwap(async () => {
                const d = createDesign({ name, mode });
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
  onCreate,
  onOpen,
  onDelete,
  onImport,
}: {
  recents: DesignSummary[];
  onCreate: (name: string, mode: "plan" | "blank") => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onImport: (doc: DesignDocument) => void;
}) {
  // new-design wizard: name the job first, then choose how to start
  const [step, setStep] = useState<null | "name" | "mode">(null);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const visible = recents.filter((r) =>
    r.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  const trimmed = name.trim();
  const cancel = () => {
    setStep(null);
    setName("");
  };
  const create = (mode: "plan" | "blank") =>
    onCreate(trimmed || "Untitled design", mode);

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
                Give the job a name — you&apos;ll choose how to start next.
              </p>
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
  onAddVariant,
  onSwitchVariant,
  onRenameVariant,
  planImages,
}: {
  doc: DesignDocument;
  step: number;
  saveState: "saved" | "saving" | "local";
  onStep: (i: number) => void;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onReplace: (d: DesignDocument) => void;
  onHome: () => void;
  onAddVariant: () => void;
  onSwitchVariant: (id: string) => void;
  onRenameVariant: (label: string) => void;
  planImages: PlanImages;
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

  /* simulation mode (Stage 12a, dev-flagged): the runtime is transient like
     the view state above — sim NEVER mutates the document. */
  const [simFlag, setSimFlag] = useState(false);
  const [simOn, setSimOn] = useState(false);
  const simRef = useRef<SimRuntime | null>(null);
  useEffect(() => {
    try {
      setSimFlag(
        process.env.NEXT_PUBLIC_STUDIO_SIM === "1" ||
          window.localStorage.getItem("studio.sim") === "1"
      );
    } catch {
      /* storage unavailable — flag stays off */
    }
  }, []);

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

  useEffect(() => {
    if (effectiveSystemId) setToolsRevealed(true);
  }, [effectiveSystemId]);

  useEffect(() => {
    let on = true;
    packActions()
      .then((a) => a.loadStudioPack("mitsubishi-electric"))
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
  }, []);

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
      return { ok: false, reason: "activate a system first", row: null };
    if (roomsServedBy(doc, effectiveSystemId).length === 0)
      return { ok: false, reason: "serve a room first", row: null };
    const sys = doc.systems.find((s) => s.id === effectiveSystemId);
    const placedIdu = doc.objects.find(
      (o) =>
        o.systemId === effectiveSystemId && o.type === "unit" && o.props.role === "idu"
    );
    const model = String(placedIdu?.props.model ?? sys?.settings.pairIdu ?? "");
    const row = (model && pack?.indoor_units.find((u) => u.model === model)) || null;
    if (!row || !isAirCapable(row))
      return { ok: false, reason: "needs an air-capable air handler", row: null };
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
      simRef.current = null;
      setSimOn(false);
      return;
    }
    if (!activeFloorId) return;
    simRef.current = new SimRuntime(doc, pack, activeFloorId, 5);
    setPlacing(null);
    setAirComp(null);
    setPaletteOpen(false);
    setTool("select");
    setSelectedId(null);
    setSimOn(true);
  }, [simOn, doc, pack, activeFloorId]);

  /* any doc/floor change while simulating re-derives the model in place —
     temps and controller settings carry across by id */
  useEffect(() => {
    if (simOn && simRef.current && activeFloorId)
      simRef.current.rebuild(doc, pack, activeFloorId);
  }, [simOn, doc, pack, activeFloorId]);

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
      mutate((d) => ({
        ...d,
        floors: d.floors.filter((f) => f.id !== id),
        objects: d.objects.filter((o) => o.floorId !== id),
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
      };
      const next = toolKeys[e.key.toLowerCase()];
      if (!next) return;
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
  }, [step, undo, redo, effectiveSystemId, airGate.ok, armComponent, changeTool]);

  return (
    <div className={`ds-editor${step === 1 && activeFloor ? " two-col" : ""}`}>
      <header className="ds-topbar">
        <button className="ds-back" onClick={onHome} aria-label="Back to studio home">
          <Icon name="chevL" size={17} />
        </button>
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
          {/* save status sits with the title now (Export removed, top-right freed) */}
          <span className={`ds-save ${saveState}`}>
            <span className="dot" />
            {saveState === "saving"
              ? "Saving…"
              : saveState === "local"
                ? "Saved locally"
                : "Saved"}
          </span>
        </div>
        <nav className="ds-steps" aria-label="Workflow">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              className={`ds-step${i === step ? " active" : ""}${
                i < step ? " done" : ""
              }`}
              onClick={() => onStep(i)}
            >
              <span className="ds-step-num">
                {i < step ? <Icon name="check" size={11} /> : i + 1}
              </span>
              {s.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Design (step 1) fills the viewport with a fixed canvas; the document-
         like steps (Plans/Materials/Job) scroll inside the locked page */}
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
            onFloor={setPickedFloorId}
            onAddFloor={addFloor}
            onDeleteFloor={deleteFloor}
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
            onRoomCreated={setEditingRoomId}
            remarkRoomId={remarkRoomId}
            onAddVariant={onAddVariant}
            onSwitchVariant={onSwitchVariant}
            onRenameVariant={onRenameVariant}
            undo={undo}
            redo={redo}
            hist={hist}
            onRemarkConsumed={() => setRemarkRoomId(null)}
            onOpenReference={hasReference ? () => setRefOpen(true) : undefined}
            layers={layers}
            onLayers={setLayers}
            grayscale={grayscale}
            onGrayscale={setGrayscale}
            legendOpen={legendOpen}
            onLegend={setLegendOpen}
            sim={simOn ? simRef.current : null}
            simFlag={simFlag}
            onToggleSim={toggleSim}
            onCalibrated={() => {
              const f = docRef.current.floors.find((x) => x.id === activeFloorId);
              if (f && !f.northPos) setNorthPrompt(true);
            }}
          />
        )}
        {step === 2 && <MaterialsView doc={doc} pack={pack} />}
        {step === 3 && <JobView doc={doc} pack={pack} onMutate={mutate} />}
      </div>

      {/* Cockpit lives at the editor level on the Design step so it spans the
          full height beside the header (see .ds-editor.two-col grid) */}
      {step === 1 && activeFloor && (
        <aside className="ds-sidecol">
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
            onDrawRoom={() => changeTool("room-rect")}
            floor={activeFloor}
          />
        </aside>
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

/* ═════════════ Design variations ═════════════ */

function VariantSwitcher({
  doc,
  onAdd,
  onSwitch,
  onRename,
}: {
  doc: DesignDocument;
  onAdd: () => void;
  onSwitch: (id: string) => void;
  onRename: (label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditing(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const label = doc.meta.variantLabel;
  const variants: DesignVariantRef[] =
    doc.variants.length > 0
      ? doc.variants
      : label
        ? [{ id: doc.id, label }]
        : [];

  if (variants.length === 0) {
    return (
      <button
        className="ds-tbbtn"
        onClick={onAdd}
        title="Branch this design into multiple options — Option 1, Option 2…"
      >
        <Icon name="layers" size={15} />
        Add option
      </button>
    );
  }

  return (
    <div className="ds-variant" ref={boxRef}>
      <button
        className="ds-tbbtn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="layers" size={15} />
        {label ?? "Option"}
        <Icon name="chevD" size={12} />
      </button>
      {open && (
        <div className="ds-variant-menu" role="menu">
          {variants.map((v) => (
            <button
              key={v.id}
              className={`ds-variant-item${v.id === doc.id ? " on" : ""}`}
              role="menuitemradio"
              aria-checked={v.id === doc.id}
              onClick={() => {
                setOpen(false);
                if (v.id !== doc.id) onSwitch(v.id);
              }}
            >
              {v.id === doc.id ? (
                <Icon name="check" size={12} />
              ) : (
                <span className="ds-variant-dot" />
              )}
              {v.label}
            </button>
          ))}
          <div className="ds-variant-sep" />
          {editing ? (
            <form
              className="ds-variant-rename"
              onSubmit={(e) => {
                e.preventDefault();
                onRename(draft);
                setEditing(false);
                setOpen(false);
              }}
            >
              <input
                autoFocus
                value={draft}
                aria-label="Rename current option"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => setEditing(false)}
              />
            </form>
          ) : (
            <button
              className="ds-variant-item"
              onClick={() => {
                setDraft(label ?? "");
                setEditing(true);
              }}
            >
              <Icon name="edit" size={12} />
              Rename current option
            </button>
          )}
          <button
            className="ds-variant-item"
            onClick={() => {
              setOpen(false);
              onAdd();
            }}
          >
            <Icon name="plus" size={12} />
            Add another option
          </button>
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

function DesignPanel({
  doc,
  activeFloorId,
  onFloor,
  onAddFloor,
  onDeleteFloor,
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
  onAddVariant,
  onSwitchVariant,
  onRenameVariant,
  undo,
  redo,
  hist,
  onOpenReference,
  layers,
  onLayers,
  grayscale,
  onGrayscale,
  legendOpen,
  onLegend,
  sim,
  simFlag,
  onToggleSim,
  onCalibrated,
}: {
  doc: DesignDocument;
  activeFloorId: string | null;
  onFloor: (id: string) => void;
  onAddFloor: () => void;
  onDeleteFloor: (id: string) => void;
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
  placing: PlacingUnit | null;
  onPlaced: () => void;
  onRoomCreated: (id: string) => void;
  remarkRoomId: string | null;
  onRemarkConsumed: () => void;
  /** variant switcher (Add option) + undo/redo relocated into ds-canvas-top */
  onAddVariant: () => void;
  onSwitchVariant: (id: string) => void;
  onRenameVariant: (label: string) => void;
  undo: () => void;
  redo: () => void;
  hist: { undo: boolean; redo: boolean };
  onOpenReference?: () => void;
  layers: LayerFlags;
  onLayers: (l: LayerFlags) => void;
  grayscale: boolean;
  onGrayscale: (v: boolean) => void;
  legendOpen: boolean;
  onLegend: (v: boolean) => void;
  /** simulation mode (Stage 12a): live runtime while simming, else null */
  sim: SimRuntime | null;
  /** dev flag — the Simulate pill only renders when it's on */
  simFlag: boolean;
  onToggleSim: () => void;
  onCalibrated: () => void;
}) {
  const floors = [...doc.floors].sort((a, b) => a.level - b.level);
  const floor = floors.find((f) => f.id === activeFloorId) ?? null;
  // two-step delete of the active floor — armed per floor id so switching
  // floors mid-arm can't delete the wrong one
  const [armedDelFloor, setArmedDelFloor] = useState<string | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [calibOpen, setCalibOpen] = useState(false);
  const [floorMenuOpen, setFloorMenuOpen] = useState(false);
  const [zoomApi, setZoomApi] = useState<ZoomApi | null>(null);
  const [zoomPct, setZoomPct] = useState(100);

  /* pack-row resolver the canvas uses for plenum specs / air capability —
     keyed to unit data, never system type (ducted spec §11.1) */
  const iduSpec = useCallback(
    (model: string) => pack?.indoor_units.find((u) => u.model === model) ?? null,
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
          ? `${t.label} — activate a system first`
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
        <div className="ds-canvas-top">
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
              <div className="ds-layers-menu ds-floor-menu" role="menu">
                {floors.map((f) => (
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
                      floors.length > 1 && (
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
          <div className="ds-canvas-toggles">
            {/* Calibrate — one pill folding scale + north: orange until both are
                set, green when complete; the popover edits either */}
            <div className="ds-layers-wrap">
              <button
                className={`ds-calib-pill${
                  floor.scaleMmPerUnit != null && floor.northPos ? " done" : ""
                }${
                  calibOpen ||
                  tool === "calibrate" ||
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
                {floor.scaleMmPerUnit != null && floor.northPos ? "Calibrated" : "Calibrate"}
                <Icon name="chevD" size={12} />
              </button>
              {calibOpen && (
                <div className="ds-layers-menu ds-calib-menu" role="menu">
                  <button
                    className="ds-calib-row"
                    onClick={() => {
                      onTool("calibrate");
                      setCalibOpen(false);
                    }}
                  >
                    <Icon name="ruler" size={13} />
                    <span className="k">Scale</span>
                    <span className="v">
                      {floor.scaleMmPerUnit != null
                        ? `${floor.scaleMmPerUnit.toFixed(1)} mm/px`
                        : "Set scale"}
                    </span>
                  </button>
                  <button
                    className="ds-calib-row"
                    onClick={() => {
                      onTool("set-north");
                      setCalibOpen(false);
                    }}
                  >
                    <Icon name="compass" size={13} />
                    <span className="k">North</span>
                    <span className="v">
                      {floor.northPos ? `${Math.round(floor.northDeg ?? 0)}°` : "Set north"}
                    </span>
                  </button>
                  {/* plan-prep tools relocated out of the drawing rail */}
                  <div className="ds-view-sep" />
                  <button
                    className={`ds-calib-row${tool === "crop" ? " on" : ""}`}
                    onClick={() => {
                      onTool("crop");
                      setCalibOpen(false);
                    }}
                  >
                    <Icon name="maximize" size={13} />
                    <span className="k">Crop</span>
                    <span className="v">Trim the plan</span>
                  </button>
                  <button
                    className={`ds-calib-row${tool === "arrange" ? " on" : ""}`}
                    onClick={() => {
                      onTool("arrange");
                      setCalibOpen(false);
                    }}
                  >
                    <Icon name="hand" size={13} />
                    <span className="k">Move plans</span>
                    <span className="v">Reposition</span>
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
                View
              </button>
              {layersOpen && (
                <div className="ds-layers-menu ds-view-menu" role="menu">
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
                className={`ds-ctl-btn ds-sim-go${sim ? " on" : ""}`}
                onClick={onToggleSim}
                title={
                  sim
                    ? "Exit the simulation"
                    : "Simulate this floor — read-only, nothing in the design changes"
                }
              >
                <span className="ds-sim-play" aria-hidden>
                  {sim ? "■" : "▶"}
                </span>
                {sim ? "Exit sim" : "Simulate"}
              </button>
            )}
          </div>
          <div className="ds-ctop-grp">
            {/* undo/redo relocated from the header, beside the zoom control */}
            <button
              className="ds-tbicon"
              onClick={undo}
              disabled={!hist.undo}
              aria-label="Undo"
              title="Undo (⌘Z)"
            >
              <Icon name="rotate" size={15} />
            </button>
            <button
              className="ds-tbicon flip"
              onClick={redo}
              disabled={!hist.redo}
              aria-label="Redo"
              title="Redo (⇧⌘Z)"
            >
              <Icon name="rotate" size={15} />
            </button>
            <div className="ds-zoomctl top" role="group" aria-label="Zoom">
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
          </div>
          <div className="ds-ctop-grp">
            {/* Add option relocated from the header, beside Reference sheets */}
            <VariantSwitcher
              doc={doc}
              onAdd={onAddVariant}
              onSwitch={onSwitchVariant}
              onRename={onRenameVariant}
            />
            {onOpenReference && (
              <button
                className="ds-ref-open"
                onClick={onOpenReference}
                title="Browse every uploaded page — heights, sections, details"
              >
                <Icon name="library" size={14} />
                Reference sheets
              </button>
            )}
          </div>
        </div>
        <div className="ds-canvas-body">
          {revealTools && (
          <div className="ds-toolrail" role="toolbar" aria-label="Canvas tools">
            {CANVAS_TOOLS.slice(0, 3).map(toolButton)}
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
            onRoomCreated={onRoomCreated}
            remarkRoomId={remarkRoomId}
            onRemarkConsumed={onRemarkConsumed}
            layers={layers}
            grayscale={grayscale}
            sim={null}
          />
        </div>
        {/* options HUD — floating pill strip, top-centre over the canvas,
            while a tool with options is armed (Step 2: the plenum variant) */}
        {tool === "component" && airComp?.kind === "plenum" && (
          <PlenumHud
            stream={airComp.stream}
            onStream={onAirStream}
            returnBuiltIn={airGate.row?.return_opening === "built-in"}
          />
        )}
        {sim && floor && (
          <SimPresentMode
            doc={doc}
            floor={floor}
            pack={pack}
            planImages={planImages}
            activeSystemId={activeSystemId}
            runtime={sim}
            onExit={onToggleSim}
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
