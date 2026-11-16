"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { searchManuals } from "@/app/actions/library-search";
import { kbDocUrl } from "@/app/actions/kb";
import type { LibrarySearch } from "@/lib/mobile/library-search";
import type { CoverReading } from "@/lib/tiff/covers";
import type { KbDocRow } from "@/lib/tiff/query";
import { KB_CATEGORIES } from "./kb";
import "./library-covers.css";

/* THE WEB LIBRARY IN THE PHONE'S DRESS (Isaac, 16 November 2026: "make
   library web version look more like mobile", then "Yep looks good" to
   https://claude.ai/artifact/1CuFEACnPf9L8gwUGpsziw). The phone's Library at
   desktop size: one search that also asks Tiff, Toolbox and Data pack as two
   big tiles under it, the manuals opened lately as covers, and a card per
   brand in its colour, which opens to that brand's shelves. What a cover and
   a shelf say is read off the documents' own tags and titles
   (lib/tiff/shelves), as the phone's are. */

export type CoveredDoc = Pick<KbDocRow, "id" | "title" | "category" | "status" | "released"> & {
  reading?: CoverReading | null;
};

/** What kind of document a cover says it is. */
const KIND: Record<string, string> = { install: "Install", faults: "Service", specs: "Specs", sops: "SOP", field: "Field note" };

/** The cover's kind: what the title says the document is (a brochure, a flyer), else its kind. Pure. */
export function kindOf(doc: Pick<CoveredDoc, "title" | "category">): string {
  const said = doc.title.match(/\b(brochure|flyer|leaflet|catalogue|data ?sheet)s?\b/i)?.[1];
  return said ? said.charAt(0).toUpperCase() + said.slice(1).toLowerCase() : (KIND[doc.category] ?? "Document");
}

/** Ink on a light colour, white on a dark one, so a cover's words always read. Pure. */
export function wordsOn(hex: string | null | undefined): "ink" | "white" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return "white";
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // the colour white reads on at 4.5:1 or better, else ink
  return 1.05 / (l + 0.05) >= 4.5 ? "white" : "ink";
}

const yearOf = (d: CoveredDoc) => (d.released ? Number(d.released.slice(0, 4)) : null);

/** One brand, or one kind of document with no brand, as the front's card says it. */
export type BrandCard<T extends CoveredDoc = CoveredDoc> = { key: string; name: string; color: string | null; docs: T[]; systems: string[]; brand: boolean; category: string };

/** The brands, the most manuals first; then each kind of document with no brand. Pure. */
export function brandsOf<T extends CoveredDoc>(docs: readonly T[]): BrandCard<T>[] {
  const by = new Map<string, BrandCard<T>>();
  for (const d of docs) {
    const s = d.reading;
    const key = s?.maker ? `brand:${s.maker}` : (s?.group ?? `kind:${d.category}`);
    let b = by.get(key);
    if (!b) {
      b = {
        key,
        name: s?.maker ?? s?.groupName ?? KB_CATEGORIES.find((c) => c.key === d.category)?.label ?? "Other documents",
        color: s?.color ?? null,
        docs: [],
        systems: [],
        brand: !!s?.maker,
        category: d.category,
      };
      by.set(key, b);
    }
    b.docs.push(d);
    if (s?.maker && s.systems && !b.systems.includes(s.systems)) b.systems.push(s.systems);
  }
  return [...by.values()].sort((a, b) => Number(b.brand) - Number(a.brand) || b.docs.length - a.docs.length || a.name.localeCompare(b.name));
}

/** A brand's shelves: its documents by the kind of system they're for, covers in name order. Pure. */
export function rowsOfBrand<T extends CoveredDoc>(b: BrandCard<T>): { name: string; docs: T[] }[] {
  const by = new Map<string, T[]>();
  for (const d of b.docs) {
    const name = d.reading?.systems || "Other documents";
    by.set(name, [...(by.get(name) ?? []), d]);
  }
  return [...by.entries()]
    .map(([name, docs]) => ({
      name,
      docs: docs.sort((x, y) => (x.reading?.name ?? x.title).localeCompare(y.reading?.name ?? y.title) || (yearOf(y) ?? 0) - (yearOf(x) ?? 0)),
    }))
    .sort((a, b) => b.docs.length - a.docs.length || a.name.localeCompare(b.name));
}

/** "16 manuals, 2020 to 2026" */
export function brandLine(b: BrandCard): string {
  const n = `${b.docs.length} ${b.docs.length === 1 ? "manual" : "manuals"}`;
  const years = b.docs.map(yearOf).filter((y): y is number => y != null);
  if (!years.length) return n;
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  return lo === hi ? `${n}, ${lo}` : `${n}, ${lo} to ${hi}`;
}

/* ── a cover ─────────────────────────────────────────────────────────────── */

/** A manual's cover: its brand's colour, its brand (left off on the brand's own page), its name, its kind and year. */
export function Cover({ doc, showMaker = true, onOpen }: { doc: CoveredDoc; showMaker?: boolean; onOpen?: () => void }) {
  const s = doc.reading;
  const year = yearOf(doc);
  const body = (
    <>
      <span className="lb3-spine" aria-hidden="true" />
      <span className="lb3-cv">
        {showMaker && s?.maker ? <span className="lb3-maker">{s.maker}</span> : <span />}
        <span className="lb3-cname">{s?.name || doc.title}</span>
        <span className="lb3-cfoot">
          <span className="lb3-ckind">{kindOf(doc)}</span>
          {year && <span className="lb3-year">{year}</span>}
        </span>
      </span>
    </>
  );
  const style = { "--c": s?.color ?? "var(--ink)" } as React.CSSProperties;
  const on = `lb3-cover lb3-on-${wordsOn(s?.color)}`;
  return onOpen ? (
    <button type="button" className={on} style={style} onClick={onOpen} aria-label={doc.title}>
      {body}
    </button>
  ) : (
    <span className={on} style={style} aria-label={doc.title}>
      {body}
    </span>
  );
}

/* ── the two tools ───────────────────────────────────────────────────────── */

export type DataPackSummary = { units: number; brands: number };

/** Toolbox and Data pack, the two big tiles under the search. */
export function ToolTiles({ onToolbox, dataPack }: { onToolbox: (() => void) | null; dataPack: DataPackSummary | null }) {
  if (!onToolbox && !dataPack) return null;
  return (
    <nav className="lb3-tools" aria-label="Tools">
      {onToolbox && (
        <button type="button" className="lb3-tool lb3-tool--orange" onClick={onToolbox}>
          <span className="lb3-ti" aria-hidden="true">
            <Icon name="briefcase" size={24} />
          </span>
          <span className="lb3-tw">
            <b>Toolbox</b>
            <span>Heat Load, Running Pressures, Fault Finder</span>
          </span>
          <Icon name="chevR" size={20} />
        </button>
      )}
      {dataPack && (
        <Link href="/dashboard/tiff/library/data-pack" className="lb3-tool lb3-tool--yellow">
          <span className="lb3-ti" aria-hidden="true">
            <Icon name="unit" size={24} />
          </span>
          <span className="lb3-tw">
            <b>Data pack</b>
            <span>
              {dataPack.units.toLocaleString("en-AU")} units from {dataPack.brands} brands’ data books: compare and combine
            </span>
          </span>
          <Icon name="chevR" size={20} />
        </Link>
      )}
    </nav>
  );
}

/* ── the brands ──────────────────────────────────────────────────────────── */

/** A card per brand in its colour, four to a row; a kind with no brand wears ink. */
export function BrandCards({ brands, onOpen, lookOver }: { brands: readonly BrandCard[]; onOpen: (b: BrandCard) => void; lookOver: boolean }) {
  return (
    <div className="lb3-brands">
      {brands.map((b) => (
        <button
          key={b.key}
          type="button"
          className={`lb3-brand lb3-on-${wordsOn(b.color)}`}
          style={{ "--c": b.color ?? "var(--ink)" } as React.CSSProperties}
          onClick={() => onOpen(b)}
        >
          <span className="lb3-bn">{b.name}</span>
          <span className="lb3-bc">
            {b.docs.length} {b.brand ? (b.docs.length === 1 ? "manual" : "manuals") : b.docs.length === 1 ? "document" : "documents"}
          </span>
          {b.systems.length > 0 && <span className="lb3-bs">{b.systems.join(", ")}</span>}
          {!b.brand && b.category === "field" && lookOver && (
            <span className="lb3-bs lb3-look">
              <span className="lb3-dot" aria-hidden="true" />
              To look over
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ── the search ──────────────────────────────────────────────────────────── */

/** A page's words, the ones typed in bold. */
function Said({ segments }: { segments: { text: string; hit: boolean }[] }) {
  return (
    <>
      {segments.map((s, i) => (s.hit ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>))}
    </>
  );
}

/** What the one search finds as you type: Ask Tiff first, then the manuals
    whose names say it, then the pages that say it, each opening at its page. */
export function SearchBoard({
  query,
  docs,
  onAsk,
  onOpenDoc,
}: {
  query: string;
  docs: readonly CoveredDoc[];
  onAsk: () => void;
  onOpenDoc: (id: string) => void;
}) {
  const q = query.trim();
  const [found, setFound] = useState<{ q: string; found: LibrarySearch | null; error: string | null } | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  useEffect(() => {
    if (q.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      void searchManuals(q).then((res) => {
        if (live) setFound({ q, found: res.ok ? res.found : null, error: res.ok ? null : res.error });
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  const now = found && found.q === q ? found : null;
  const byId = new Map(docs.map((d) => [d.id, d]));
  const manuals = (now?.found?.manuals ?? []).map((id) => byId.get(id)).filter((d): d is CoveredDoc => !!d);
  const pages = now?.found?.pages ?? [];

  /* the page opens in a new tab at its page, the tab opened on the click so
     the pop-up blocker sees it (doc-search.tsx does the same) */
  const openAt = async (id: string, page: number) => {
    setOpenError(null);
    const tab = window.open("", "_blank");
    const res = await kbDocUrl(id);
    if (!res.ok) {
      tab?.close();
      setOpenError(res.error);
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = `${res.url}#page=${page}`;
    }
  };

  return (
    <section className="lb3-board" aria-label="Search">
      <div className="lb3-group">
        <button type="button" className="lb3-cell" onClick={onAsk}>
          <span className="lb3-blk lb3-blk--ink" aria-hidden="true">
            <Icon name="message" size={18} />
          </span>
          <span className="lb3-cw">
            <b>Ask Tiff</b>
            <span>“{q}”</span>
          </span>
          <Icon name="chevR" size={16} />
        </button>
      </div>
      {now?.error && <p className="lb3-err">{now.error}</p>}
      {openError && <p className="lb3-err">{openError}</p>}
      {manuals.length > 0 && (
        <>
          <h2 className="lb3-sh">Manuals</h2>
          <div className="lb3-covers lb3-wrap">
            {manuals.map((d) => (
              <Cover key={d.id} doc={d} onOpen={() => onOpenDoc(d.id)} />
            ))}
          </div>
        </>
      )}
      {pages.length > 0 && (
        <>
          <h2 className="lb3-sh">Pages</h2>
          <div className="lb3-group">
            {pages.map((p) => (
              <button key={`${p.documentId}-${p.pageFrom}`} type="button" className="lb3-cell lb3-cell--page" onClick={() => void openAt(p.documentId, p.pageFrom)}>
                <span className="lb3-cw">
                  <b>
                    {p.title}, p. {p.pageFrom}
                    {p.pageTo > p.pageFrom ? ` to ${p.pageTo}` : ""}
                  </b>
                  <span>
                    <Said segments={p.segments} />
                  </span>
                </span>
                <Icon name="chevR" size={16} />
              </button>
            ))}
          </div>
        </>
      )}
      {now && !now.error && manuals.length === 0 && pages.length === 0 && (
        <p className="lb3-none">No manual says “{q}”</p>
      )}
    </section>
  );
}
