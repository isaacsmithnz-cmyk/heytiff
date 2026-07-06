"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import {
  createDesign,
  newId,
  type DesignDocument,
  type DesignObject,
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
  boundingRect,
  formatArea,
  isAxisAlignedRect,
  polygonArea,
} from "@/lib/studio/geometry";
import { StudioCanvas, type CanvasTool } from "./canvas";
import { PlansPanel } from "./plans-panel";
import { RemotePlanImages, type PlanImages } from "@/lib/studio/plans";
import "./studio.css";

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
    setStep(0);
  }, []);

  /* undo/redo restores an exact prior document — no updatedAt bump */
  const replaceDoc = useCallback((d: DesignDocument) => {
    setSaveState("saving");
    setDoc(d);
  }, []);

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
      <div className="dstudio">
        {doc ? (
          <Editor
            doc={doc}
            step={step}
            saveState={saveState}
            onStep={setStep}
            onMutate={mutate}
            onReplace={replaceDoc}
            onHome={goHome}
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
  const [choosing, setChoosing] = useState(false);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const visible = recents.filter((r) =>
    r.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  const create = (mode: "plan" | "blank") =>
    onCreate(name.trim() || "Untitled design", mode);

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
        {choosing ? (
          <>
            <h3 className="ds-hero-etitle">Start a new design</h3>
            <p className="ds-hero-esub">
              Name the job, then pick how you want to work.
            </p>
            <input
              className="ds-name-input"
              placeholder="Design name — e.g. 14 Harbour View Rd"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setChoosing(false)}
            />
            <div className="ds-opts">
              <button className="ds-opt" onClick={() => create("plan")}>
                <span className="ds-opt-ic">
                  <Icon name="file" size={20} />
                </span>
                <span className="ds-opt-n">Floor plans</span>
                <span className="ds-opt-d">
                  Upload PDF or image plans, calibrate the scale and design to
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
            <button className="ds-hero-back" onClick={() => setChoosing(false)}>
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
            <button className="ds-cta" onClick={() => setChoosing(true)}>
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
  planImages,
}: {
  doc: DesignDocument;
  step: number;
  saveState: "saved" | "saving" | "local";
  onStep: (i: number) => void;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onReplace: (d: DesignDocument) => void;
  onHome: () => void;
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
      };
      const next = toolKeys[e.key.toLowerCase()];
      if (next) setTool(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, undo, redo]);

  const exportJson = () => {
    const blob = new Blob([exportDesignJson(doc)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: designFileName(doc),
    });
    a.click();
    URL.revokeObjectURL(url);
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
          <button className="ds-tbbtn" onClick={exportJson}>
            <Icon name="download" size={15} />
            Export
          </button>
        </div>
      </header>

      <div className="ds-panel">
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
          />
        )}
        {step === 2 && <MaterialsPanel />}
        {step === 3 && <JobPanel />}
      </div>
    </div>
  );
}

/* ═════════════ Stage panels — Stage-0 empty states ═════════════ */

const CANVAS_TOOLS: { key: CanvasTool; icon: string; label: string; kbd: string }[] = [
  { key: "select", icon: "cursor", label: "Select", kbd: "V" },
  { key: "room-rect", icon: "square", label: "Room (rectangle)", kbd: "R" },
  { key: "room-poly", icon: "hexagon", label: "Room (polygon)", kbd: "G" },
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
            title={`${t.label} (${t.kbd})`}
            aria-label={t.label}
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
                {f.name}
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
        />
      </div>

      <RoomInspector
        doc={doc}
        floor={floor}
        selectedId={selectedId}
        onSelect={onSelect}
        onMutate={onMutate}
      />
    </div>
  );
}

function RoomInspector({
  doc,
  floor,
  selectedId,
  onSelect,
  onMutate,
}: {
  doc: DesignDocument;
  floor: Floor;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
}) {
  const obj: DesignObject | undefined = doc.objects.find(
    (o) => o.id === selectedId && o.type === "room"
  );

  if (!obj || obj.geometry.kind !== "polygon") {
    return (
      <aside className="ds-inspector">
        <span className="ds-cardt">Inspector</span>
        <div className="ds-insp-hint">
          Select a room to edit it — or draw one with the rectangle (R) or
          polygon (G) tool. Full load inputs arrive with the loads engine.
        </div>
      </aside>
    );
  }

  const areaU = polygonArea(obj.geometry.points);
  return (
    <aside className="ds-inspector">
      <span className="ds-cardt">Room</span>
      <label className="ds-insp-field">
        <span>Name</span>
        <input
          value={String(obj.props.name ?? "")}
          onChange={(e) =>
            onMutate((d) => ({
              ...d,
              objects: d.objects.map((o) =>
                o.id === obj.id
                  ? { ...o, props: { ...o.props, name: e.target.value } }
                  : o
              ),
            }))
          }
        />
      </label>
      <div className="ds-insp-row">
        <span>Area</span>
        <b>
          {floor.scaleMmPerUnit
            ? formatArea(areaUnitsToM2(areaU, floor.scaleMmPerUnit))
            : "not calibrated"}
        </b>
      </div>
      <div className="ds-insp-row">
        <span>Floor</span>
        <b>{floor.name}</b>
      </div>
      <div className="ds-insp-row">
        <span>Vertices</span>
        <b>{obj.geometry.points.length}</b>
      </div>
      {(isAxisAlignedRect(obj.geometry.points) || Boolean(obj.props.freeEdit)) && (
        <label
          className="ds-insp-toggle"
          title="Locked: corners drag whole sides, and re-locking snaps the shape back to a perfect rectangle. Unlocked: move one corner alone."
        >
          <input
            type="checkbox"
            checked={!obj.props.freeEdit}
            onChange={(e) => {
              const lock = e.target.checked;
              onMutate((d) => ({
                ...d,
                objects: d.objects.map((o) =>
                  o.id === obj.id
                    ? {
                        ...o,
                        props: { ...o.props, freeEdit: !lock },
                        // locking transforms the shape back to a true rectangle
                        geometry:
                          lock && o.geometry.kind === "polygon"
                            ? {
                                kind: "polygon",
                                points: boundingRect(o.geometry.points),
                              }
                            : o.geometry,
                      }
                    : o
                ),
              }));
            }}
          />
          <span>Lock rectangle</span>
        </label>
      )}
      <button
        className="ds-insp-delete"
        onClick={() => {
          onMutate((d) => ({
            ...d,
            objects: d.objects.filter((o) => o.id !== obj.id),
          }));
          onSelect(null);
        }}
      >
        <Icon name="x" size={14} />
        Delete room
      </button>
    </aside>
  );
}

function MaterialsPanel() {
  return (
    <div className="ds-panel-card">
      <div className="ds-empty">
        <span className="ds-empty-ic">
          <Icon name="receipt" size={22} />
        </span>
        <div className="ds-empty-t">An empty design is an empty schedule</div>
        <div className="ds-empty-s">
          The takeoff builds itself from what you draw — units, pipe by size,
          fittings, grilles and accessories, grouped per system. Nothing here
          is ever typed in by hand.
        </div>
      </div>
    </div>
  );
}

function JobPanel() {
  return (
    <div className="ds-panel-card">
      <div className="ds-empty">
        <span className="ds-empty-ic">
          <Icon name="box" size={22} />
        </span>
        <div className="ds-empty-t">The job pack comes last</div>
        <div className="ds-empty-s">
          Job details, sheet selection and a print-ready PDF export — overview,
          per-system pipework and the materials schedule — once there&apos;s a
          design to package.
        </div>
      </div>
    </div>
  );
}
