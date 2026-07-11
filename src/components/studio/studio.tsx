"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import {
  createDesign,
  newId,
  type DesignDocument,
  type DesignObject,
  type DesignVariantRef,
  type Floor,
} from "@/lib/studio/document";
import { openDesignJson, DesignDocumentError } from "@/lib/studio/migrations";
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
  areaUnitsToM2,
  formatArea,
  polygonArea,
} from "@/lib/studio/geometry";
import { StudioCanvas, type CanvasTool, type PlacingUnit } from "./canvas";
import { PlansPanel } from "./plans-panel";
import { floorDisplayName, RemotePlanImages, type PlanImages } from "@/lib/studio/plans";
import {
  SystemsPanel,
  SystemObjectInspector,
  RoomUnitsSection,
  MaterialsView,
  JobView,
  roomLoadKw,
} from "./split-panel";
import type { SizingBasis } from "@/lib/studio/loads";
import type { RoomObj } from "@/lib/studio/loads-room";
import { RoomModal } from "./room-modal";
import type { DataPack } from "@/lib/studio/packs/schema";
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

/** Suffix a design's export filename with its variant label, e.g.
    "14-harbour-view-rd-option-2.heytiff-design.json". */
function variantFileName(doc: DesignDocument): string {
  const base = designFileName(doc).replace(/\.heytiff-design\.json$/, "");
  if (!doc.meta.variantLabel) return `${base}.heytiff-design.json`;
  const suffix = doc.meta.variantLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base}-${suffix}.heytiff-design.json`;
}

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

  const refreshRecents = useCallback(() => {
    void getStore().list().then(setRecents);
  }, [getStore]);

  useEffect(() => {
    refreshRecents();
  }, [refreshRecents]);

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

  const goHome = useCallback(async () => {
    if (doc) {
      // flush the debounce before leaving; local buffer already has it
      await getStore()
        .save(doc)
        .catch(() => {});
    }
    setDoc(null);
    refreshRecents();
  }, [doc, getStore, refreshRecents]);

  return (
    <div className="page in">
      <div className={`dstudio${doc ? " editing" : ""}`}>
        {doc ? (
          <Editor
            doc={doc}
            step={step}
            saveState={saveState}
            onStep={setStep}
            onMutate={mutate}
            onReplace={replaceDoc}
            onHome={goHome}
            onAddVariant={addVariant}
            onSwitchVariant={switchVariant}
            onRenameVariant={renameVariant}
            onLoadVariant={(id) => getStore().load(id)}
            planImages={planImagesInst}
          />
        ) : (
          <Home
            recents={recents}
            onCreate={async (name, mode) => {
              const d = createDesign({ name, mode });
              await getStore().save(d);
              openDesign(d);
            }}
            onOpen={async (id) => {
              const d = await getStore().load(id);
              if (d) openDesign(d);
            }}
            onDelete={async (id) => {
              await getStore()
                .remove(id)
                .catch(() => {});
              refreshRecents();
            }}
            onImport={async (d) => {
              await getStore().save(d);
              openDesign(d);
            }}
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
    <div className="ds-home stgp">
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
                  Bring in PDF or image plans, calibrate the scale and design to
                  size on the real drawing.
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
        {importError && <div className="ds-ierr">{importError}</div>}
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
                  <Icon name={r.mode === "plan" ? "file" : "square"} size={19} />
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
                  {armedDelete === r.id ? "Delete?" : <Icon name="x" size={15} />}
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
  onLoadVariant,
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
  onLoadVariant: (id: string) => Promise<DesignDocument | null>;
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

  /* ── systems (Stage 4): product pack, active system, armed placement ── */
  const [pack, setPack] = useState<DataPack | null>(null);
  const [packVersion, setPackVersion] = useState<string>("2026.1");
  const [activeSystemId, setActiveSystemId] = useState<string | null>(null);
  const [placing, setPlacing] = useState<PlacingUnit | null>(null);
  /* room being configured in the heat-load modal (Slice 2) */
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  /* room whose external walls the canvas should re-mark (from the modal) */
  const [remarkRoomId, setRemarkRoomId] = useState<string | null>(null);

  /* the effective active system: the picked one, else the first system. The
     canvas scopes rooms/objects to this; room tools require it (type-first). */
  const effectiveSystemId =
    activeSystemId && doc.systems.some((s) => s.id === activeSystemId)
      ? activeSystemId
      : (doc.systems[0]?.id ?? null);

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
            plans: [],
          },
        ],
      };
    });
  }, [mutate]);

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
      const toolKeys: Record<string, CanvasTool> = {
        v: "select",
        r: "room-rect",
        g: "room-poly",
        c: "calibrate",
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
      setTool(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, undo, redo, effectiveSystemId]);

  const downloadDoc = (d: DesignDocument, filename: string) => {
    const blob = new Blob([exportDesignJson(d)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: filename,
    });
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJson = () => downloadDoc(doc, designFileName(doc));

  const exportAllVariants = async () => {
    const targets =
      doc.variants.length > 0
        ? doc.variants
        : [{ id: doc.id, label: doc.meta.variantLabel ?? "" }];
    for (const v of targets) {
      const d = v.id === doc.id ? doc : await onLoadVariant(v.id);
      if (d) downloadDoc(d, variantFileName(d));
    }
  };

  return (
    <div className="ds-editor">
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
          <span className="ds-job">{MODE_LABEL[doc.meta.mode]}</span>
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
        <div className="ds-tb-right">
          <VariantSwitcher
            doc={doc}
            onAdd={onAddVariant}
            onSwitch={onSwitchVariant}
            onRename={onRenameVariant}
          />
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
          <span className={`ds-save ${saveState}`}>
            <span className="dot" />
            {saveState === "saving"
              ? "Saving…"
              : saveState === "local"
                ? "Saved locally"
                : "Saved"}
          </span>
          <ExportMenu
            hasVariants={doc.variants.length > 1}
            onExportOne={exportJson}
            onExportAll={exportAllVariants}
          />
        </div>
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
            onGoPlans={() => onStep(0)}
            tool={tool}
            onTool={setTool}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMutate={mutate}
            planImages={planImages}
            pack={pack}
            packVersion={packVersion}
            activeSystemId={effectiveSystemId}
            onActivateSystem={setActiveSystemId}
            placing={placing}
            onArmPlace={armPlace}
            onPlaced={onPlaced}
            onRoomCreated={setEditingRoomId}
            onEditRoom={setEditingRoomId}
            remarkRoomId={remarkRoomId}
            onRemarkConsumed={() => setRemarkRoomId(null)}
          />
        )}
        {step === 2 && <MaterialsView doc={doc} pack={pack} />}
        {step === 3 && <JobView doc={doc} pack={pack} onMutate={mutate} />}
      </div>

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

function ExportMenu({
  hasVariants,
  onExportOne,
  onExportAll,
}: {
  hasVariants: boolean;
  onExportOne: () => void;
  onExportAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!hasVariants) {
    return (
      <button className="ds-tbbtn" onClick={onExportOne}>
        <Icon name="download" size={15} />
        Export
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
        <Icon name="download" size={15} />
        Export
        <Icon name="chevD" size={12} />
      </button>
      {open && (
        <div className="ds-variant-menu" role="menu">
          <button
            className="ds-variant-item"
            onClick={() => {
              setOpen(false);
              onExportOne();
            }}
          >
            Export this option
          </button>
          <button
            className="ds-variant-item"
            onClick={() => {
              setOpen(false);
              onExportAll();
            }}
          >
            Export all options
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
  { key: "pipe", icon: "activity", label: "Refrigerant run", kbd: "P", needsSystem: true },
  { key: "riser", icon: "arrowUp", label: "Riser (joins floors)", kbd: "I", needsSystem: true },
  { key: "calibrate", icon: "ruler", label: "Calibrate scale", kbd: "C" },
  { key: "arrange", icon: "hand", label: "Move plans", kbd: "M" },
  { key: "erase", icon: "x", label: "Eraser", kbd: "E" },
];

function DesignPanel({
  doc,
  activeFloorId,
  onFloor,
  onAddFloor,
  onGoPlans,
  tool,
  onTool,
  selectedId,
  onSelect,
  onMutate,
  planImages,
  pack,
  packVersion,
  activeSystemId,
  onActivateSystem,
  placing,
  onArmPlace,
  onPlaced,
  onRoomCreated,
  onEditRoom,
  remarkRoomId,
  onRemarkConsumed,
}: {
  doc: DesignDocument;
  activeFloorId: string | null;
  onFloor: (id: string) => void;
  onAddFloor: () => void;
  onGoPlans: () => void;
  tool: CanvasTool;
  onTool: (t: CanvasTool) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  planImages: PlanImages;
  pack: DataPack | null;
  packVersion: string;
  activeSystemId: string | null;
  onActivateSystem: (id: string | null) => void;
  placing: PlacingUnit | null;
  onArmPlace: (p: PlacingUnit | null) => void;
  onPlaced: () => void;
  onRoomCreated: (id: string) => void;
  onEditRoom: (id: string) => void;
  remarkRoomId: string | null;
  onRemarkConsumed: () => void;
}) {
  const floors = [...doc.floors].sort((a, b) => a.level - b.level);
  const floor = floors.find((f) => f.id === activeFloorId) ?? null;

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

  return (
    <div className="ds-design">
      <div className="ds-toolrail" role="toolbar" aria-label="Canvas tools">
        {CANVAS_TOOLS.map((t) => (
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
        ))}
      </div>

      <div className="ds-canvas-col">
        <div className="ds-canvas-top">
          <div className="ds-floortabs">
            {floors.map((f) => (
              <button
                key={f.id}
                className={`ds-floortab${f.id === floor.id ? " on" : ""}`}
                onClick={() => onFloor(f.id)}
              >
                {floorDisplayName(f)}
              </button>
            ))}
            <button className="ds-floortab add" onClick={onAddFloor} title="Add floor">
              <Icon name="plus" size={13} />
            </button>
          </div>
          {floor.scaleMmPerUnit == null && (
            <span className="ds-calib-warn">
              <Icon name="ruler" size={13} />
              Not calibrated — sizes are arbitrary
            </span>
          )}
        </div>
        <StudioCanvas
          key={floor.id}
          doc={doc}
          floor={floor}
          tool={tool}
          selectedId={selectedId}
          onSelect={onSelect}
          onMutate={onMutate}
          onToolDone={() => onTool("select")}
          planImages={planImages}
          activeSystemId={activeSystemId}
          placing={placing}
          onPlaced={onPlaced}
          onRoomCreated={onRoomCreated}
          remarkRoomId={remarkRoomId}
          onRemarkConsumed={onRemarkConsumed}
        />
      </div>

      <aside className="ds-sidecol">
        <SystemsPanel
          doc={doc}
          pack={pack}
          packVersion={packVersion}
          activeSystemId={activeSystemId}
          onActivate={onActivateSystem}
          onMutate={onMutate}
          selectedRoomId={
            doc.objects.find((o) => o.id === selectedId && o.type === "room")
              ? selectedId
              : null
          }
          onSelectRoom={onSelect}
        />
        {(() => {
          const sysObj = doc.objects.find(
            (o) =>
              o.id === selectedId &&
              (o.type === "unit" || o.type === "riser" || o.type === "pipe-run")
          );
          if (sysObj)
            return (
              <SystemObjectInspector
                doc={doc}
                obj={sysObj}
                floor={floor}
                onMutate={onMutate}
                onSelect={onSelect}
              />
            );
          return (
            <RoomInspector
              key={selectedId ?? "none"}
              doc={doc}
              floor={floor}
              selectedId={selectedId}
              onSelect={onSelect}
              onMutate={onMutate}
              onEditRoom={onEditRoom}
              pack={pack}
              activeSystemId={activeSystemId}
              onArmPlace={onArmPlace}
            />
          );
        })()}
      </aside>
    </div>
  );
}

/* a small to-scale thumbnail of the room's polygon for the Configure card */
function RoomThumb({ points }: { points: { x: number; y: number }[] }) {
  if (points.length < 3) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX || 1;
  const h = Math.max(...ys) - minY || 1;
  const pad = Math.max(w, h) * 0.12;
  return (
    <svg
      className="ds-cfg-thumb"
      viewBox={`${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <polygon points={points.map((p) => `${p.x},${p.y}`).join(" ")} />
    </svg>
  );
}

function RoomInspector({
  doc,
  floor,
  selectedId,
  onSelect,
  onMutate,
  onEditRoom,
  pack,
  activeSystemId,
  onArmPlace,
}: {
  doc: DesignDocument;
  floor: Floor;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onEditRoom: (id: string) => void;
  pack: DataPack | null;
  activeSystemId: string | null;
  onArmPlace: (p: PlacingUnit | null) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const obj: DesignObject | undefined = doc.objects.find(
    (o) => o.id === selectedId && o.type === "room"
  );

  if (!obj || obj.geometry.kind !== "polygon") {
    return (
      <aside className="ds-inspector">
        <span className="ds-cardt">Inspector</span>
        <div className="ds-insp-hint">
          Select a room to edit it — or draw one with the rectangle (R) or
          polygon (G) tool. Configuring a room opens its heat-load inputs.
        </div>
      </aside>
    );
  }

  const configured = Boolean(obj.props.configured);
  const loadKw =
    obj.geometry.kind === "polygon"
      ? roomLoadKw(doc, obj as Parameters<typeof roomLoadKw>[1])
      : null;

  const areaU = polygonArea(obj.geometry.points);
  const activeSystem = doc.systems.find((s) => s.id === activeSystemId) ?? null;
  const name = String(obj.props.name ?? "Room");
  const deleteRoom = () => {
    onMutate((d) => ({ ...d, objects: d.objects.filter((o) => o.id !== obj.id) }));
    onSelect(null);
  };
  const commitName = () => {
    const v = draftName.trim() || "Room";
    onMutate((d) => ({
      ...d,
      objects: d.objects.map((o) =>
        o.id === obj.id ? { ...o, props: { ...o.props, name: v } } : o
      ),
    }));
    setRenaming(false);
  };

  return (
    <aside className="ds-inspector">
      <div className="ds-insp-head">
        <span className="ds-cardt">Configure</span>
        <button
          className="ds-rp-del"
          title="Delete room"
          aria-label="Delete room"
          onClick={deleteRoom}
        >
          <Icon name="x" size={15} />
        </button>
      </div>

      {/* room name + inline rename pencil */}
      <div className="ds-cfg-name">
        {renaming ? (
          <input
            className="ds-cfg-nameinput"
            autoFocus
            autoComplete="off"
            value={draftName}
            aria-label="Room name"
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <>
            <b className="ds-cfg-roomname">{name}</b>
            <button
              className="ds-cfg-pencil"
              aria-label="Rename room"
              title="Rename"
              onClick={() => {
                setDraftName(name);
                setRenaming(true);
              }}
            >
              <Icon name="edit" size={13} />
            </button>
          </>
        )}
      </div>

      {/* facts + a compact viewport, with Edit → load inputs */}
      <div className="ds-cfg-block">
        <div className="ds-cfg-top">
          <div className="ds-cfg-facts">
            <div className="ds-cfg-fact">
              <span>Area</span>
              <b>
                {floor.scaleMmPerUnit
                  ? formatArea(areaUnitsToM2(areaU, floor.scaleMmPerUnit))
                  : "—"}
              </b>
            </div>
            <div className="ds-cfg-fact">
              <span>Heat load</span>
              <b>
                {loadKw != null ? `${loadKw.toFixed(1)} kW` : "—"}
                {loadKw != null && !configured && (
                  <em className="ds-insp-est"> · est</em>
                )}
              </b>
            </div>
            <div className="ds-cfg-fact">
              <span>Floor</span>
              <b>{floor.name}</b>
            </div>
          </div>
          <RoomThumb points={obj.geometry.points} />
        </div>
        <button className="ds-cfg-edit" onClick={() => onEditRoom(obj.id)}>
          <Icon name="edit" size={12} />
          Edit
        </button>
      </div>

      {/* units for this room, on the active system (relocated from the panel) */}
      {activeSystem ? (
        <RoomUnitsSection
          doc={doc}
          pack={pack}
          system={activeSystem}
          room={obj as RoomObj}
          basis={doc.settings.sizingBasis as SizingBasis}
          onMutate={onMutate}
          onArmPlace={onArmPlace}
        />
      ) : (
        <div className="ds-insp-hint">
          Add a system (top of the panel) to select units for this room.
        </div>
      )}
    </aside>
  );
}
