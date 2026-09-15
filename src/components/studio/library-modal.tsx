"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "@/components/shell/icon";
import { fmtDay } from "@/lib/format/day";
import { SummaryModal } from "./summary/summary-modal";
import {
  indoorByForm,
  libraryChanges,
  librarySnapshot,
  libraryUpdatedOn,
  modelOfKey,
  type LibraryBrand,
  type LibraryChange,
  type LibraryManifest,
  type LibrarySnapshot,
  type LibrarySystemGroup,
} from "@/lib/studio/packs/library";

/* Design Studio — the library's door on the start screen, and the dialog
   behind it.

   On the page: one control, top right — "Library, updated 18 Aug 2026", and
   the word "New" when something has arrived since this browser last looked.
   It reads like a software update's badge, and the dialog it opens reads like
   its release notes: what's new first, then the lineup — brand, each kind of
   system, the series by form ("Wall-mounted: MSZ-AP, MSZ-EF, MSZ-GS") — and
   nothing more. No counts, no model codes: that detail is the unit browser's,
   on the canvas, when a room is asking for a unit. (Isaac, 2026-09-14: the
   lineup on the page itself was too much; a card of it read like the back
   end.)

   "What's new" is what this browser has not seen. It keeps a snapshot of the
   library (`heytiff.studio.library`, beside the design index); the fresh
   manifest is compared against it, and a new version, a series that arrived,
   one that grew by a size or a model no longer offered is what the dialog
   opens on. Opening it is reading it: the snapshot is written then, so the
   badge clears, while the dialog keeps the list it opened with. A browser
   that has never looked simply records what it saw — nobody opening the
   studio for the first time is told the whole pack just landed.

   The snapshot is read the way the hints setting is (hints.ts): an external
   store, so nothing here sets state from an effect. */

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
   carries no badge, and only then becomes what this browser remembers */
const serverRaw = () => null;

const listeners = new Set<() => void>();
function writeSnapshot(json: string): void {
  try {
    window.localStorage.setItem(SNAPSHOT_KEY, json);
  } catch {
    /* storage unavailable — the badge simply shows again next time */
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

/** The door: the control at the top right of the start screen. */
export function LibraryDoor({ library }: { library: LibraryManifest }) {
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

  /* the list the dialog opened with — null while it is shut. Frozen at the
     press, because opening writes the snapshot and the live diff empties. */
  const [shown, setShown] = useState<LibraryChange[] | null>(null);
  const open = () => {
    setShown(changes);
    if (changes.length > 0) writeSnapshot(JSON.stringify(librarySnapshot(library)));
  };
  const close = useCallback(() => setShown(null), []);

  const updated = libraryUpdatedOn(library);

  return (
    <>
      <button type="button" className="ds-lib-door" onClick={open} aria-haspopup="dialog">
        <Icon name="library" size={15} />
        <span className="ds-lib-door-t">Library</span>
        {updated && <span className="ds-lib-door-s">Updated {fmtDay(updated)}</span>}
        {changes.length > 0 && <span className="ds-lib-door-new">New</span>}
      </button>
      {shown && <LibraryModal library={library} changes={shown} onClose={close} />}
    </>
  );
}

/* The dialog: the Summary step's shell, wearing the library. */
function LibraryModal({
  library,
  changes,
  onClose,
}: {
  library: LibraryManifest;
  changes: LibraryChange[];
  onClose: () => void;
}) {
  /* a series that arrived whole is the one thing marked in the lineup; a
     series that grew by a size is said under What's new and left alone */
  const arrived = new Set<string>();
  for (const c of changes) for (const a of c.added) if (a.whole) arrived.add(seriesKey(a.side, a.series));
  const several = library.brands.length > 1;

  return (
    <SummaryModal title="Library" icon="library" onClose={onClose}>
      {library.brands.length === 0 && (
        <p className="ds-libm-none">No product data is installed yet.</p>
      )}
      {library.brands.map((b) => (
        <div className="ds-libm-brand" key={b.id}>
          <span className="ds-libm-bn">
            {b.name} {b.version}
          </span>
          {b.updated && <span className="ds-libm-bu">Updated {fmtDay(b.updated)}</span>}
        </div>
      ))}

      {changes.length > 0 && (
        <section className="ds-libm-sec ds-libm-new" aria-label="What's new">
          <h3>What&rsquo;s new</h3>
          {changes.map((c) => (
            <div className="ds-libm-new-b" key={c.brand}>
              {c.from === null ? (
                <p>{c.name} has been added.</p>
              ) : c.from !== c.to ? (
                <p>
                  {c.name} is now on {c.to}.
                </p>
              ) : null}
              {c.added.length > 0 && (
                <ul>
                  {c.added.map((a) => (
                    <li key={`${a.side}:${a.series}`}>
                      <b>{a.series}</b> {a.form ? a.form.toLowerCase() : "outdoor"},{" "}
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
        </section>
      )}

      {library.brands.map((b) =>
        b.systems.map((g) =>
          g.series.length === 0 ? null : (
            <Lineup key={`${b.id}:${g.system}`} brand={b} group={g} arrived={arrived} several={several} />
          )
        )
      )}
    </SummaryModal>
  );
}

/** the series names in a run, the ones that just arrived marked */
function Run({
  series,
  arrived,
}: {
  series: { series: string; side: "indoor" | "outdoor" }[];
  arrived: Set<string>;
}) {
  const parts: ReactNode[] = [];
  series.forEach((s, i) => {
    if (i > 0) parts.push(", ");
    parts.push(
      arrived.has(seriesKey(s.side, s.series)) ? (
        <span className="ds-libm-arrived" key={s.series}>
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
  several,
}: {
  brand: LibraryBrand;
  group: LibrarySystemGroup;
  arrived: Set<string>;
  /** more than one brand in the library — the heading names it */
  several: boolean;
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
    <section className="ds-libm-sec">
      <h3>{several ? `${brand.name} ${group.label.toLowerCase()}` : group.label}</h3>
      <dl className="ds-libm-lineup">
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
            <div className="ds-libm-form" key={f.form}>
              <dt>{f.form}</dt>
              <dd>
                <Run series={f.series} arrived={arrived} />
              </dd>
            </div>
          ))
        )}
      </dl>
    </section>
  );
}
