"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import {
  libraryChanges,
  librarySnapshot,
  modelKey,
  modelOfKey,
  type LibraryChange,
  type LibraryManifest,
  type LibrarySnapshot,
} from "@/lib/studio/packs/library";

/* Design Studio — the library on the start screen.

   What the studio can design with, as a directory: brand, then the kind of
   system, then each series with its form factor, its count and its model
   codes. The three system groups open on a press and start shut — the
   whole pack is a hundred series, and the card sits beside the Recent list,
   not under a heading of its own.

   And what has changed. The browser keeps a snapshot of what it last saw
   (`heytiff.studio.library`, beside the design index); the fresh manifest is
   compared against it, and a difference — a new version, a series that
   grew, a brand that arrived, a model no longer offered — is said at the top
   of the card until it is dismissed, which is when the snapshot catches up.
   A browser that has never looked simply records what it saw: nothing is
   "new" to someone with nothing to compare it with, and nobody opening the
   studio for the first time is told the whole pack just landed.

   The snapshot is read the way the hints setting is (hints.ts): an external
   store, so the card never sets state from an effect — a change of snapshot,
   from Dismiss here or from another tab, simply re-renders it. */

const SNAPSHOT_KEY = "heytiff.studio.library";

/* Plain functions, not compiled: kept outside the component so the
   try/catch blocks never meet the React Compiler, which gives up on a whole
   component at a value block inside one (see studio.tsx). */
function readRaw(): string | null {
  try {
    return window.localStorage.getItem(SNAPSHOT_KEY);
  } catch {
    return null; // storage unavailable — nothing to compare with
  }
}
/* localStorage does not exist on the server: the markup that hydrates
   carries no notice, and only then becomes what this browser remembers */
const serverRaw = () => null;

const listeners = new Set<() => void>();
function writeSnapshot(json: string): void {
  try {
    window.localStorage.setItem(SNAPSHOT_KEY, json);
  } catch {
    /* storage unavailable — the notice simply shows again next time */
  }
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function parseSnapshot(raw: string | null): LibrarySnapshot | null {
  if (!raw) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const brands = (parsed as { brands?: unknown }).brands;
  if (!brands || typeof brands !== "object") return null;
  return { brands: brands as LibrarySnapshot["brands"] };
}

export function LibraryCard({
  library,
  admin,
}: {
  library: LibraryManifest;
  /** this person may open the Data Library page (admin+) — offer the door */
  admin?: boolean;
}) {
  const raw = useSyncExternalStore(subscribe, readRaw, serverRaw);
  const changes = useMemo(() => libraryChanges(library, parseSnapshot(raw)), [library, raw]);
  /** `${brand}:${system}` → open */
  const [open, setOpen] = useState<Record<string, boolean>>({});

  /* nothing to say: record what was seen, so the NEXT difference has a base.
     This is also the first visit's silent write. Guarded on the text so a
     snapshot that already says this is left alone. */
  useEffect(() => {
    if (changes.length > 0) return;
    const next = JSON.stringify(librarySnapshot(library));
    if (next !== raw) writeSnapshot(next);
  }, [library, changes, raw]);

  const dismiss = () => writeSnapshot(JSON.stringify(librarySnapshot(library)));

  const newKeys = new Set<string>();
  for (const c of changes) for (const k of c.newKeys) newKeys.add(k);
  const isNew = (side: "indoor" | "outdoor", model: string) => newKeys.has(modelKey(side, model));

  return (
    <section className="ds-lib" aria-label="Library">
      <div className="ds-lib-head">
        <span className="ds-cardt">Library</span>
        {admin && (
          <Link className="ds-lib-link" href="/dashboard/studio/data-library">
            Data Library
          </Link>
        )}
      </div>

      {changes.length > 0 && <Updated changes={changes} onDismiss={dismiss} />}

      {library.brands.length === 0 ? (
        <p className="ds-lib-none">No product data is installed yet.</p>
      ) : (
        library.brands.map((b) => (
          <div className="ds-lib-brand" key={b.id}>
            <div className="ds-lib-bl">
              <span className="ds-lib-bn">{b.name}</span>
              <span className="ds-lib-bv">Version {b.version}</span>
            </div>
            {b.systems.map((g) => {
              if (g.series.length === 0) return null;
              const key = `${b.id}:${g.system}`;
              const isOpen = Boolean(open[key]);
              const fresh = g.series.filter((s) => s.models.some((m) => isNew(s.side, m))).length;
              return (
                <div className="ds-lib-sys" key={g.system}>
                  <button
                    type="button"
                    className="ds-lib-sum"
                    aria-expanded={isOpen}
                    onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
                  >
                    <span className={`ds-lib-chev${isOpen ? " open" : ""}`} aria-hidden="true">
                      <Icon name="chevD" size={14} />
                    </span>
                    <span className="ds-lib-sn">{g.label}</span>
                    <span className="ds-lib-sc">
                      {g.series.length} series{fresh > 0 ? `, ${fresh} new` : ""}
                    </span>
                  </button>
                  {isOpen && (
                    <ul className="ds-lib-rows">
                      {g.series.map((s) => {
                        const news = s.models.filter((m) => isNew(s.side, m)).length;
                        return (
                          <li className="ds-lib-row" key={`${s.side}:${s.series}`}>
                            <span className="ds-lib-ser">{s.series}</span>
                            <span className="ds-lib-kind">{s.form ?? "Outdoor"}</span>
                            <span className="ds-lib-n">
                              {s.models.length} {s.models.length === 1 ? "model" : "models"}
                              {news > 0 && (
                                <b className="ds-lib-mark">
                                  {news === s.models.length ? "New" : `${news} new`}
                                </b>
                              )}
                            </span>
                            <span className="ds-lib-models">{s.models.join(", ")}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}
    </section>
  );
}

/* What arrived. One notice for however many brands changed; the person
   reads it and dismisses it once. */
function Updated({
  changes,
  onDismiss,
}: {
  changes: LibraryChange[];
  onDismiss: () => void;
}) {
  return (
    <div className="ds-lib-upd" role="status">
      <div className="ds-lib-upd-t">Library updated</div>
      {changes.map((c) => {
        const n = c.newKeys.length;
        return (
          <div className="ds-lib-upd-b" key={c.brand}>
            {c.from === null ? (
              <p>
                {c.name} has been added, version {c.to}.
              </p>
            ) : c.from !== c.to ? (
              <p>
                {c.name} is now version {c.to}, from {c.from}.
              </p>
            ) : null}
            {n > 0 && (
              <p>
                {n} {n === 1 ? "model" : "models"} added.
              </p>
            )}
            {c.added.length > 0 && (
              <ul className="ds-lib-upd-l">
                {c.added.map((a) => (
                  <li key={`${a.side}:${a.series}`}>
                    <span className="ds-lib-upd-s">{a.series}</span>
                    {a.whole ? ", new series" : ""}: {a.models.join(", ")}
                  </li>
                ))}
              </ul>
            )}
            {c.removed.length > 0 && (
              <p>No longer offered: {c.removed.map(modelOfKey).join(", ")}.</p>
            )}
          </div>
        );
      })}
      <button type="button" className="ds-lib-dismiss" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
