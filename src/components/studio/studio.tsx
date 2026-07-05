"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import {
  createDesign,
  type DesignDocument,
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

export function Studio({ store }: { store?: DesignStore }) {
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
            onHome={goHome}
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
  onHome,
}: {
  doc: DesignDocument;
  step: number;
  saveState: "saved" | "saving" | "local";
  onStep: (i: number) => void;
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void;
  onHome: () => void;
}) {
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
              onMutate((d) => ({
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
        {step === 0 && <PlansPanel doc={doc} />}
        {step === 1 && <DesignPanel />}
        {step === 2 && <MaterialsPanel />}
        {step === 3 && <JobPanel />}
      </div>
    </div>
  );
}

/* ═════════════ Stage panels — Stage-0 empty states ═════════════ */

function PlansPanel({ doc }: { doc: DesignDocument }) {
  return (
    <div className="ds-panel-card">
      {doc.floors.length > 0 ? (
        <>
          <span className="ds-cardt">Floors</span>
          <div className="ds-floors">
            {[...doc.floors]
              .sort((a, b) => a.level - b.level)
              .map((f) => (
                <div key={f.id} className="ds-floor">
                  <span className="ds-floor-lvl">L{f.level}</span>
                  <span className="ds-floor-nm">{f.name}</span>
                  <span
                    className={`ds-floor-scale${
                      f.scaleMmPerUnit == null ? " none" : ""
                    }`}
                  >
                    {f.scaleMmPerUnit == null
                      ? "Not calibrated"
                      : `${f.scaleMmPerUnit} mm/unit`}
                  </span>
                </div>
              ))}
          </div>
          <div className="ds-empty">
            <div className="ds-empty-s">
              Floor management, plan pages and 2-point calibration are on the
              way.
            </div>
            <span className="ds-empty-soon">Coming next</span>
          </div>
        </>
      ) : (
        <div className="ds-empty">
          <span className="ds-empty-ic">
            <Icon name="file" size={22} />
          </span>
          <div className="ds-empty-t">No floor plans yet</div>
          <div className="ds-empty-s">
            Drop in a PDF or image, pick the pages that matter, assign them to
            floors and calibrate the scale — everything you design is measured
            off that calibration.
          </div>
          <span className="ds-empty-soon">Coming next</span>
        </div>
      )}
    </div>
  );
}

function DesignPanel() {
  return (
    <div className="ds-canvas-well">
      <div className="ds-empty">
        <span className="ds-empty-ic">
          <Icon name="layers" size={22} />
        </span>
        <div className="ds-empty-t">Your canvas is waiting</div>
        <div className="ds-empty-s">
          Draw rooms, drag units in from the palette and route pipe and duct to
          scale. The canvas engine is the next piece of the studio to land.
        </div>
        <span className="ds-empty-soon">Coming next</span>
      </div>
    </div>
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
