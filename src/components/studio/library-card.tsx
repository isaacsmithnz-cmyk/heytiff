"use client";

import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  indoorByForm,
  libraryChanges,
  librarySnapshot,
  modelOfKey,
  type LibraryBrand,
  type LibraryChange,
  type LibraryManifest,
  type LibrarySnapshot,
  type LibrarySystemGroup,
} from "@/lib/studio/packs/library";

/* Design Studio — the library on the start screen.

   What the studio can design with, the way a brochure says it: the brand,
   then each kind of system, then the series by form — "Wall-mounted: MSZ-AP,
   MSZ-EF, MSZ-GS" — and nothing else. No counts, no model codes, no rows to
   open: that detail is the unit browser's, on the canvas, when a room is
   asking for a unit. This is the lineup, read at a glance.

   And what has changed. The browser keeps a snapshot of what it last saw
   (`heytiff.studio.library`, beside the design index); the fresh manifest is
   compared against it, and a difference — a new version, a series that
   arrived, one that grew by a size, a model no longer offered — is said at
   the top of the card until it is dismissed, which is when the snapshot
   catches up. A browser that has never looked simply records what it saw:
   nothing is "new" to someone with nothing to compare it with, and nobody
   opening the studio for the first time is told the whole pack just landed.

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

const seriesKey = (side: "indoor" | "outdoor", series: string) => `${side}:${series}`;

export function LibraryCard({ library }: { library: LibraryManifest }) {
  const raw = useSyncExternalStore(subscribe, readRaw, serverRaw);
  const changes = useMemo(() => libraryChanges(library, parseSnapshot(raw)), [library, raw]);

  /* nothing to say: record what was seen, so the NEXT difference has a base.
     This is also the first visit's silent write. Guarded on the text so a
     snapshot that already says this is left alone. */
  useEffect(() => {
    if (changes.length > 0) return;
    const next = JSON.stringify(librarySnapshot(library));
    if (next !== raw) writeSnapshot(next);
  }, [library, changes, raw]);

  const dismiss = () => writeSnapshot(JSON.stringify(librarySnapshot(library)));

  /* a series that arrived whole is the one thing marked in the lineup; a
     series that grew by a size is said in the notice and left alone below */
  const arrived = new Set<string>();
  for (const c of changes) for (const a of c.added) if (a.whole) arrived.add(seriesKey(a.side, a.series));

  return (
    <section className="ds-lib" aria-label="Library">
      <span className="ds-cardt">Library</span>

      {changes.length > 0 && <Updated changes={changes} onDismiss={dismiss} />}

      {library.brands.length === 0 ? (
        <p className="ds-lib-none">No product data is installed yet.</p>
      ) : (
        library.brands.map((b) => (
          <div className="ds-lib-brand" key={b.id}>
            <h3 className="ds-lib-bn">
              {b.name} <span className="ds-lib-bv">{b.version}</span>
            </h3>
            {b.systems.map((g) =>
              g.series.length === 0 ? null : (
                <Lineup key={g.system} brand={b} group={g} arrived={arrived} />
              )
            )}
          </div>
        ))
      )}
    </section>
  );
}

/** the series names in a run, the ones that just arrived in paper white */
function Run({ series, arrived }: { series: { series: string; side: "indoor" | "outdoor" }[]; arrived: Set<string> }) {
  const parts: ReactNode[] = [];
  series.forEach((s, i) => {
    if (i > 0) parts.push(", ");
    const isNew = arrived.has(seriesKey(s.side, s.series));
    parts.push(
      isNew ? (
        <span className="ds-lib-new" key={s.series}>
          {s.series} <b>new</b>
        </span>
      ) : (
        <span key={s.series}>{s.series}</span>
      )
    );
  });
  return <>{parts}</>;
}

/* One kind of system. A split is chosen by its indoor unit and the outdoor
   comes with the pair, so the split lineup is indoor by form and nothing
   else. A multi or VRF system IS its outdoor unit, so that is named first.
   And a multi's indoor units are, on this pack, exactly the split and VRF
   ranges already listed — so they are said in a phrase rather than printed
   a second time; a brand whose multi takes indoor units of its own would
   have them listed by form like the rest. */
function Lineup({
  brand,
  group,
  arrived,
}: {
  brand: LibraryBrand;
  group: LibrarySystemGroup;
  arrived: Set<string>;
}) {
  const outdoor = group.series.filter((s) => s.side === "outdoor");
  const indoor = group.series.filter((s) => s.side === "indoor");

  let indoorNote: string | null = null;
  if (group.system === "multi" && indoor.length > 0) {
    const elsewhere = (system: "split" | "vrf") =>
      new Set(
        (brand.systems.find((g) => g.system === system)?.series ?? [])
          .filter((s) => s.side === "indoor")
          .map((s) => s.series)
      );
    const inSplit = elsewhere("split");
    const inVrf = elsewhere("vrf");
    const fromSplit = indoor.some((s) => inSplit.has(s.series));
    const fromVrf = indoor.some((s) => inVrf.has(s.series));
    const ownOnly = indoor.every((s) => inSplit.has(s.series) || inVrf.has(s.series));
    if (ownOnly && (fromSplit || fromVrf)) {
      indoorNote =
        fromSplit && fromVrf
          ? "The split and VRF indoor ranges"
          : fromSplit
            ? "The split indoor ranges"
            : "The VRF indoor ranges";
    }
  }

  return (
    <div className="ds-lib-sys">
      <h4 className="ds-lib-sn">{group.label}</h4>
      <dl className="ds-lib-lineup">
        {group.system !== "split" && outdoor.length > 0 && (
          <>
            <dt>Outdoor</dt>
            <dd>
              <Run series={outdoor} arrived={arrived} />
            </dd>
          </>
        )}
        {indoorNote ? (
          <>
            <dt>Indoor</dt>
            <dd>{indoorNote}</dd>
          </>
        ) : (
          indoorByForm(indoor).map((f) => (
            <div className="ds-lib-form" key={f.form}>
              <dt>{f.form}</dt>
              <dd>
                <Run series={f.series} arrived={arrived} />
              </dd>
            </div>
          ))
        )}
      </dl>
    </div>
  );
}

/* What arrived. One notice for however many brands changed; the person
   reads it and dismisses it once. Said the way the lineup is said — a
   series and what it is — never as a list of model codes. */
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
      {changes.map((c) => (
        <div className="ds-lib-upd-b" key={c.brand}>
          {c.from === null ? (
            <p>{c.name} has been added.</p>
          ) : c.from !== c.to ? (
            <p>
              {c.name} is now on {c.to}.
            </p>
          ) : null}
          {c.added.length > 0 && (
            <ul className="ds-lib-upd-l">
              {c.added.map((a) => (
                <li key={`${a.side}:${a.series}`}>
                  <span className="ds-lib-upd-s">{a.series}</span>{" "}
                  {a.form ? a.form.toLowerCase() : "outdoor"},{" "}
                  {a.whole
                    ? "new series"
                    : `${a.models.length} new ${a.models.length === 1 ? "size" : "sizes"}`}
                </li>
              ))}
            </ul>
          )}
          {c.removed.length > 0 && (
            <p>No longer offered: {c.removed.map(modelOfKey).join(", ")}.</p>
          )}
        </div>
      ))}
      <button type="button" className="ds-lib-dismiss" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
