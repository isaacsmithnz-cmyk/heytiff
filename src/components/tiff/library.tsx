"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { Tooltip } from "@/components/parts/tooltip";
import { Button, IconButton } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { ConfirmDialog } from "@/components/parts/dialog";
import { Fade } from "@/components/parts/fade";
import { TextInput } from "@/components/parts/field";
import { Menu, type MenuItem } from "@/components/parts/menu";
import { Empty } from "@/components/parts/states";
import { StateWord, type Tone } from "@/components/parts/state";
import { TiffGlyph } from "@/components/notes/tiff-mark";
import { KB_CATEGORIES, filterKbDocs, type KbCategoryKey } from "./kb";
import { UploadDrawer } from "./upload-drawer";
import { TagPicker } from "./tag-picker";
import { TagManager } from "./tag-manager";
import { DocSearch } from "./doc-search";
import { allTools, toolBadge, toolMatches } from "@/components/toolbox/tools";
import { auDayOf, fmtAuDayMonth } from "@/lib/au-dates";
import { deleteKbDoc, retryKbDoc, updateKbDocMeta } from "@/app/actions/kb";
import { filterByTags, KB_TAG_PILLS_SHOWN, type KbTagRef } from "@/lib/tiff/tags";
import { writeAskQuestion, writeAskScope } from "@/lib/tiff/ask-handoff";
import { CvBox } from "@/components/conversations/box";
import { appendSpoken, useDictation } from "@/components/notes/dictation";
import { findUnits } from "@/app/actions/library-units";
import { SPEC_ROWS, differing, modelStem, squash, type UnitSpec } from "@/lib/library/unit-specs";
import { useKbIngest, type KbIngestProgress } from "@/lib/tiff/use-kb-ingest";
import { useKbOcr, type KbOcrProgress } from "@/lib/tiff/use-kb-ocr";
import { useKbBackfill } from "@/lib/tiff/use-kb-backfill";
import type { KbDocRow } from "@/lib/tiff/query";
import type { KbQuota } from "@/lib/tiff/quota";
import type { KbLargeAllowance } from "@/lib/tiff/files";

/* THE LIBRARY (v2, step 5; no board, so built from docs/design.md and the
   v2 screens already built: Jobs' list, a vehicle's page, Schedule). The
   head is the title, one grey line of facts and the buttons on the right;
   the views are soft tabs (rule 29), one per category with its count, and
   Toolbox, the field tools' shelf (6-revisions.md, 20); the search sits on
   the head's line as Jobs has it; then the documents as a table, a row per
   document (rule 39), its state as a word (rule 17).

   A DOCUMENT'S STATE IS THE POINT OF THIS SCREEN, not a decoration on it. A
   row that isn't `ready` cannot be cited yet, so every row says where it is:
   how far through the reading it is, that it ran out of the month's pages, or
   why it failed and what to press.

   THE LOOP RUNS FROM HERE. There is no queue on the server (Hobby allows one
   cron a day), so this page is what drives ingestion: it adopts anything the
   server still calls `processing` on mount and works through it one document
   at a time. Closing the page stops the asking, never the batch already in
   flight — the bookmark survives and the next visit picks it up.

   THE STAFF VARIANT IS ABSENT, NOT DISABLED. Without `tiff_manage` there is no
   Add button, no row actions and no quota line anywhere in the markup: a greyed
   control is an invitation to ask why, and this is a read surface for staff by
   design. Every action re-checks the capability server-side regardless.

   The view and the tags ride in the address (`?cat=`, `?view=toolbox`,
   `?tag=`), written with replaceState as they change, as Jobs does, so an
   open tab holds them and the links into the library still land. */

/* SHELVES (Isaac, 20 October; the board
   https://claude.ai/artifact/64ih5Hjdp74pcKhzKZ6c6h). The Library lands on
   Tiff's mark and her box, as Home does, and a button per shelf: its colour
   block, its name and its one line. A shelf opens on its own page: the
   search, its tags, and its documents as small cards (the title on up to
   two lines, the maker and the edition). Manufacturer specs' search also
   looks the model up in the data packs and shows its specs side by side,
   what differs in amber, the documents under them. The box hands the
   question to Conversations, where it is asked and kept. */

/* Both extras are attached by the page rather than by lib/tiff/query.ts, for
   the same reason: they are separate reads joined in TypeScript, and a row's
   shape shouldn't change because a nicety was added beside it. */
export type KbLibraryDoc = KbDocRow & { uploaderName?: string | null; tags?: KbTagRef[] };

/* The quota as it crosses to the browser. `pagesAllowed` is Infinity on the
   unlimited tier, which is not a number a props payload should be asked to
   carry — the page nulls it out, and null IS the unlimited tier here. */
export type KbQuotaView = Omit<KbQuota, "pagesAllowed" | "pagesRemaining"> & {
  pagesAllowed: number | null;
};

/** All, a category, or the field tools' shelf. */
export type LibraryView = "all" | KbCategoryKey | "toolbox";

const n = (v: number) => v.toLocaleString("en-AU");

const plural = (count: number, one: string, many = `${one}s`) => (count === 1 ? one : many);

const PANEL = "lb2-panel";

/** What a row says about itself right now — the live loop wins over the row
    the server rendered, which is a batch behind the moment work starts. */
type RowState = {
  status: string;
  pagesDone: number;
  pageCount: number | null;
  error: string | null;
  resetsOn: string | null;
};

function rowState(d: KbLibraryDoc, live: KbIngestProgress | undefined, quota: KbQuotaView | null): RowState {
  return {
    status: live?.status ?? d.status,
    pagesDone: live ? live.pagesDone : Math.max(0, d.nextPage - 1),
    pageCount: live?.pageCount ?? d.pageCount,
    error: live?.error ?? d.error,
    resetsOn: live?.resetsOn ?? quota?.resetsOn ?? null,
  };
}

/** What a row knows about reading its own scanned pages. `left` is what the
    caveat says: a finished run's count wins over the row the server rendered,
    which is one press behind. */
type OcrView = {
  reading: boolean;
  /** Another document is being read — one allowance, one run at a time. */
  waiting: boolean;
  /** A run finished and recovered nothing: the pages are empty, not merely
      unread, so the offer is withdrawn rather than repeated. */
  spent: boolean;
  left: number;
  result?: KbOcrProgress;
};

function ocrView(d: KbLibraryDoc, run: KbOcrProgress | undefined, running: string | null): OcrView {
  return {
    reading: running === d.id,
    waiting: running !== null && running !== d.id,
    spent: run?.status === "ready" && run.pagesRead === 0,
    left: run ? run.scannedLeft : d.scannedPages,
    result: run,
  };
}

function metaLine(d: KbLibraryDoc): string {
  const bits = [d.source, d.edition].filter(Boolean) as string[];
  const updated = fmtAuDayMonth(auDayOf(d.updatedAt));
  if (updated) bits.push(`Updated ${updated}`);
  if (d.uploaderName) bits.push(`Added by ${d.uploaderName}`);
  return bits.join(", ");
}

/** The row's tags as words (pills are only for a person's name, rule 47):
    the first few, then how many more. */
function tagLine(tags: readonly KbTagRef[]): string {
  if (tags.length === 0) return "";
  const shown = tags.slice(0, KB_TAG_PILLS_SHOWN).map((t) => t.label);
  const more = tags.length - shown.length;
  if (more > 0) return `Tagged ${shown.join(", ")} and ${more} more`;
  if (shown.length === 1) return `Tagged ${shown[0]}`;
  return `Tagged ${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

/** The state of a document as a word in its colour (rule 17). */
function stateOf(state: RowState, ocr: OcrView): { tone: Tone; word: string } {
  if (state.status === "processing") {
    const known = state.pageCount !== null && state.pageCount > 0;
    return {
      tone: "info",
      word: known
        ? `Reading ${n(state.pagesDone)} of ${n(state.pageCount as number)} pages`
        : "Reading the document",
    };
  }
  if (state.status === "paused")
    return {
      tone: "look",
      word: state.resetsOn ? `Out of pages — resumes ${fmtAuDayMonth(state.resetsOn)}` : "Out of pages this month",
    };
  if (state.status === "failed") return { tone: "wrong", word: state.error || "Couldn't be read" };
  if (state.status === "uploading") return { tone: "info", word: "Uploading the document" };

  /* A vision run in flight says so where the caveat was, rather than beside
     it: the word is the row's one status line. */
  if (ocr.reading) return { tone: "info", word: `Reading ${n(ocr.left)} scanned ${plural(ocr.left, "page")}` };
  if (ocr.result?.status === "failed") return { tone: "wrong", word: ocr.result.error || "Those pages couldn't be read." };
  if (ocr.result?.status === "paused")
    return {
      tone: "look",
      word: ocr.result.resetsOn
        ? `Out of pages — try again ${fmtAuDayMonth(ocr.result.resetsOn)}`
        : "Out of pages this month",
    };

  /* A run that read the pages and found nothing on them. Said out loud,
     because the alternative is the caveat coming back unchanged with no sign
     anything happened — and against the real library this is the COMMON
     outcome: most pages with no text layer are a divider, a full-bleed photo
     or a blank back cover. */
  if (ocr.result?.status === "ready" && ocr.result.pagesRead === 0 && ocr.left > 0)
    return {
      tone: "look",
      word: `${n(ocr.left)} ${plural(ocr.left, "page")} with nothing readable on ${plural(ocr.left, "it", "them")}`,
    };

  /* Usable, but not all of it: a caveat needs a look, it isn't good news. */
  if (ocr.left > 0) return { tone: "look", word: `${n(ocr.left)} ${plural(ocr.left, "page")} unreadable — scanned images` };

  if (ocr.result && ocr.result.pagesRead > 0)
    return { tone: "good", word: `Read ${n(ocr.result.pagesRead)} scanned ${plural(ocr.result.pagesRead, "page")}` };

  return { tone: "good", word: "Ready" };
}

/** Each shelf's colour block and glyph (solid, ink on it), and its line. */
const CATEGORY_LOOK: Record<Exclude<LibraryView, "all">, { hue: string; icon: string }> = {
  install: { hue: "green", icon: "wrench" },
  faults: { hue: "purple", icon: "gauge" },
  specs: { hue: "yellow", icon: "file" },
  sops: { hue: "pink", icon: "shield" },
  field: { hue: "grey", icon: "edit" },
  toolbox: { hue: "orange", icon: "calc" },
};
const TOOLBOX_CATEGORY = { key: "toolbox" as const, label: "Toolbox", blurb: "Calculators and references for site" };
const said = (blurb: string) => blurb.replace(/ & /g, " and ");

/** A document card's second line: the maker, then its edition, or the day it came in. */
function cardLine(d: KbLibraryDoc): string {
  const added = fmtAuDayMonth(auDayOf(d.uploadedAt ?? d.updatedAt));
  return [d.source, d.edition || (added ? `Added ${added}` : null)].filter(Boolean).join(", ");
}

/** The Library's box: Tiff's, as Home has it. A question goes to
    Conversations, asked there at once and kept. */
function LibraryBox({ voice }: { voice: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [ranOut, setRanOut] = useState(false);
  const dict = useDictation({
    onTranscript: (spoken, { capped }) => {
      setVoiceError(null);
      setRanOut(capped);
      setText((prev) => appendSpoken(prev, spoken));
    },
    onError: setVoiceError,
  });
  const send = () => {
    const q = text.trim();
    if (!q) return;
    writeAskQuestion(q);
    router.push("/dashboard/conversations");
  };
  return (
    <CvBox
      value={text}
      onChange={setText}
      onSubmit={send}
      label="Ask the Library anything"
      placeholder="Ask the Library anything"
      sendWord="Send"
      dict={voice ? dict : null}
      voiceError={voiceError}
      ranOut={ranOut}
    />
  );
}

/** A model typed into Manufacturer specs' search, looked up in the data
    packs: its specs side by side, what differs in amber. */
function ModelSpecs({ query }: { query: string }) {
  const [found, setFound] = useState<{ q: string; units: UnitSpec[] } | null>(null);
  const q = query.trim();
  useEffect(() => {
    if (q.length < 3) return;
    let live = true;
    const t = setTimeout(() => {
      void findUnits(q).then((res) => {
        if (live) setFound({ q, units: res.ok ? res.units : [] });
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  const units = q.length >= 3 && found ? found.units : [];
  if (units.length === 0) return null;
  const diff = differing(units);
  return (
    <section className="lb2-specs-sec" aria-label="Models">
      <p className="lb2-subh">{units.length === 1 ? "The model" : "These models match. What differs is in amber."}</p>
      <div className="lb2-specs">
        {units.map((u) => (
          <article key={u.key} className="lb2-spec">
            <h3 className="lb2-spec-h">{u.model}</h3>
            <p className="lb2-spec-q">
              {u.brand}, {u.kind}
            </p>
            <dl className="lb2-spec-kv">
              {SPEC_ROWS.filter((r) => u[r.key]).map((r) => (
                <div key={r.key}>
                  <dt>{r.label}</dt>
                  <dd className={diff.has(r.key) ? "lb2-diff" : undefined}>{u[r.key]}</dd>
                </div>
              ))}
            </dl>
            {u.source && <p className="lb2-spec-q">From {u.source}</p>}
          </article>
        ))}
      </div>
      <p className="lb2-subh">Documents</p>
    </section>
  );
}

/** The view and the tags, into the address, as Jobs writes its own. */
function writeAddress(view: LibraryView, tagSlugs: readonly string[]) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("cat");
  url.searchParams.delete("view");
  url.searchParams.delete("tag");
  if (view === "toolbox") url.searchParams.set("view", "toolbox");
  else if (view !== "all") url.searchParams.set("cat", view);
  for (const s of tagSlugs) url.searchParams.append("tag", s);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/* ── the page ────────────────────────────────────────────────────────────── */

export function Library({
  docs,
  quota = null,
  canManage = false,
  isOwner = false,
  unembedded = 0,
  initialCategory = null,
  initialView = null,
  tags = [],
  tagUsage = {},
  initialTagIds = [],
  initialDocId = null,
  large = null,
  toolbox = null,
  voice = false,
}: {
  docs: KbLibraryDoc[];
  quota?: KbQuotaView | null;
  canManage?: boolean;
  isOwner?: boolean;
  /** Stored passages with no vector yet. Zero where no key is configured — in
      that deployment every chunk is null by design and there is nothing to
      say. */
  unembedded?: number;
  initialCategory?: KbCategoryKey | null;
  /** From `?view=toolbox`: the field tools' shelf, for someone who holds it. */
  initialView?: "toolbox" | null;
  /** Every tag the org has, including ones nothing wears yet — the picker
      offers those, and the filter hides them. */
  tags?: KbTagRef[];
  /** tagId → documents wearing it. Only the manage sheet needs it. */
  tagUsage?: Record<string, number>;
  /** From `?tag=` — a filtered library is a link somebody can send. */
  initialTagIds?: string[];
  /** From `?doc=` — the document to open on arrival, already checked to be one
      of `docs`. A journal chip naming a knowledge entry lands here. */
  initialDocId?: string | null;
  /** What this person may bring in over 50 MB this month (null: nothing). */
  large?: KbLargeAllowance;
  /** The Toolbox shelf, for a viewer who holds `toolbox`: the yard's date
      ages the tools' New out. Null: no shelf. */
  toolbox?: { today: string } | null;
  /** The microphone in the box, where this deployment can hear. */
  voice?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [view, setViewState] = useState<LibraryView>(
    initialView === "toolbox" && toolbox ? "toolbox" : (initialCategory ?? "all"),
  );
  const [tagIds, setTagIds] = useState<string[]>(initialTagIds);
  const [drawer, setDrawer] = useState(false);
  const [managing, setManaging] = useState(false);
  const [tagMenu, setTagMenu] = useState(false);
  const tagRef = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState<KbLibraryDoc | null>(null);
  const [deleting, setDeleting] = useState<KbLibraryDoc | null>(null);
  /* `?doc=` opens the document's own search panel on arrival — the same panel
     its row opens, so a link from elsewhere in the app lands exactly where a
     click here would. Seeded in the initialiser rather than an effect: the
     panel is open on the first paint, not after one without it. */
  const [searching, setSearching] = useState<KbLibraryDoc | null>(
    () => docs.find((d) => d.id === initialDocId) ?? null,
  );
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  /* PARKED DOCUMENTS RESUME THEMSELVES, which is what the screens have
     always said they do ("Out of pages — resumes 1 Oct"). The allowance is the
     condition, not the date: `pagesRemaining` is what the ingest loop itself
     checks, so queueing on anything else would park them again on the first
     batch. */
  const hasPages = quota ? quota.pagesAllowed === null || quota.pagesUsed < quota.pagesAllowed : false;
  const processing = useMemo(
    () =>
      canManage
        ? docs
            .filter((d) => d.status === "processing" || (d.status === "paused" && hasPages))
            .map((d) => d.id)
        : [],
    [docs, canManage, hasPages]
  );
  const ingest = useKbIngest(processing);
  const ocr = useKbOcr();

  /* Seeded FROM `KB_CATEGORIES` rather than by hand: a literal of four keys
     beside a list of five once made the field notes' count read "NaN". */
  const counts = useMemo(() => {
    const c = Object.fromEntries(KB_CATEGORIES.map((k) => [k.key, 0])) as Record<KbCategoryKey, number>;
    for (const d of docs) c[d.category] = (c[d.category] ?? 0) + 1;
    return c;
  }, [docs]);

  /* Tag counts are over the WHOLE library, like the views' counts — a number
     that changed every time another filter went on would be unreadable while
     you were using it. */
  const tagCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of docs) for (const t of d.tags ?? []) c[t.id] = (c[t.id] ?? 0) + 1;
    return c;
  }, [docs]);

  /* THE FILTER IS NOT THE TAG LIST. An org starts with fifty seeded tags and a
     library with six documents; a tag nothing wears is offered in the PICKER
     and hidden here — unless it's on, because a tag that removed itself the
     moment it emptied the list could never be pressed again to undo. */
  const filterTags = useMemo(
    () => tags.filter((t) => (tagCounts[t.id] ?? 0) > 0 || tagIds.includes(t.id)),
    [tags, tagCounts, tagIds]
  );

  /* on Manufacturer specs a model also finds the documents its family is
     named in: a data book says "PUMY-SP", never every model in it */
  const matches = useMemo(() => {
    const hits = filterKbDocs(docs, query);
    const stem = view === "specs" ? modelStem(query) : null;
    if (!stem) return hits;
    const ids = new Set(hits.map((d) => d.id));
    return [...hits, ...docs.filter((d) => !ids.has(d.id) && squash(d.title).includes(stem))];
  }, [docs, query, view]);
  const tagged = useMemo(() => filterByTags(matches, tagIds), [matches, tagIds]);
  /* a model's family finds its documents wherever they are filed: the PUMY
     manuals sit under Installation and Service documents, and belong under
     its specs all the same (Isaac's walk, 20 October) */
  const visible = useMemo(() => {
    if (view === "all" || view === "toolbox") return tagged;
    const stem = view === "specs" ? modelStem(query) : null;
    return tagged.filter((d) => d.category === view || (stem !== null && squash(d.title).includes(stem)));
  }, [tagged, view, query]);

  const tools = useMemo(() => (toolbox ? allTools() : []), [toolbox]);
  const shownTools = tools.filter(({ tool }) => toolMatches(tool, query));

  const slugsOf = (ids: readonly string[]) =>
    ids.map((id) => tags.find((t) => t.id === id)?.slug).filter(Boolean) as string[];

  const setView = (next: LibraryView) => {
    setViewState(next);
    writeAddress(next, slugsOf(tagIds));
  };
  const setTags = (next: string[]) => {
    setTagIds(next);
    writeAddress(view, slugsOf(next));
  };
  const toggleTag = (id: string) => setTags(tagIds.includes(id) ? tagIds.filter((v) => v !== id) : [...tagIds, id]);

  const filtering = query.trim().length > 0 || tagIds.length > 0;
  const clearFilters = () => {
    setQuery("");
    setTags([]);
  };

  const setRowError = (id: string, message: string | null) =>
    setRowErrors((m) => {
      const next = { ...m };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });

  /* "Ask Tiff about this document" — a document hands the composer itself and
     gets out of the way. The scope travels in session storage rather than the
     URL because it is the start of somebody's question, and a question
     doesn't belong in a link or a history entry. Offered to anyone who can
     see the row: reading the library and asking about it are the same
     permission, and `tiff_manage` is about changing it. */
  const askAbout = (d: KbLibraryDoc) => {
    writeAskScope({ docId: d.id, title: d.title });
    router.push("/dashboard/tiff");
  };

  const zero = docs.length === 0;
  const inToolbox = view === "toolbox";

  /* the shelves, and the one open: none is the landing */
  const categories: { key: Exclude<LibraryView, "all">; label: string; blurb: string }[] = [
    ...KB_CATEGORIES.map((c) => ({ key: c.key, label: c.label, blurb: c.blurb })),
    ...(toolbox ? [TOOLBOX_CATEGORY] : []),
  ];
  const opened = view === "all" ? null : (categories.find((x) => x.key === view) ?? null);

  const tagWord =
    tagIds.length === 0
      ? "Tags"
      : tagIds.length === 1
        ? (tags.find((t) => t.id === tagIds[0])?.label ?? "1 tag")
        : `${tagIds.length} tags`;
  const tagItems: MenuItem[] = filterTags.map((t) => ({
    key: t.id,
    label: t.label,
    lead: tagIds.includes(t.id) ? <Icon name="check" size={16} /> : <span className="lb2-nolead" />,
    count: n(tagCounts[t.id] ?? 0),
  }));

  /* for a manager, the month's pages */
  const pages =
    canManage && quota
      ? quota.pagesAllowed === null
        ? "Unlimited pages"
        : `${n(quota.pagesUsed)} of ${n(quota.pagesAllowed)} pages this month, resets ${fmtAuDayMonth(quota.resetsOn)}`
      : null;

  return (
    <div className="page in">
      <div className="wrap lb2">
        {opened === null ? (
          <header className="lb2-head">
            <div className="lb2-id">
              <h1 className="lb2-title">Library</h1>
              {pages && <p className="lb2-fact">{pages}</p>}
            </div>
            {/* on the empty library the main button belongs to the empty
                state, which is the whole screen: two Adds on one page is one
                too many */}
            {canManage && !zero && (
              <div className="lb2-acts">
                <Button kind="second" icon="plus" onClick={() => setDrawer(true)}>
                  Add a document
                </Button>
              </div>
            )}
          </header>
        ) : (
          <>
            <Button kind="quiet" size={32} className="lb2-back" onClick={() => setView("all")}>
              ‹ Library
            </Button>
            <header className="lb2-head">
              <div className="lb2-cath">
                <span className={`hm-blk hm-blk--${CATEGORY_LOOK[opened.key].hue}`} aria-hidden="true">
                  <Icon name={CATEGORY_LOOK[opened.key].icon} size={18} />
                </span>
                <h1 className="lb2-title">{opened.label}</h1>
              </div>
              {canManage && !inToolbox && !zero && (
                <div className="lb2-acts">
                  {/* Edit tags renames the tags documents carry (Ducted, VRF, a maker) */}
                  <Button kind="quiet" icon="tag" onClick={() => setManaging(true)}>
                    Edit tags
                  </Button>
                  <Button kind="second" icon="plus" onClick={() => setDrawer(true)}>
                    Add a document
                  </Button>
                </div>
              )}
            </header>
          </>
        )}

        {canManage && unembedded > 0 && <EmbedGap count={unembedded} />}

        {opened === null && (
          <>
            <div className="hm-ask lb2-ask">
              <TiffGlyph size={96} alive label="Tiff" />
              <LibraryBox voice={voice} />
            </div>
            {zero && !toolbox ? null : (
            <nav className="lb2-cats" aria-label="Categories">
              {categories.map((sh) => (
                <button key={sh.key} type="button" className="lb2-cat" onClick={() => setView(sh.key)}>
                  <span className={`hm-blk hm-blk--${CATEGORY_LOOK[sh.key].hue}`} aria-hidden="true">
                    <Icon name={CATEGORY_LOOK[sh.key].icon} size={18} />
                  </span>
                  <span className="lb2-cat-t">
                    <b>{sh.label}</b>
                    <span>{said(sh.blurb)}</span>
                  </span>
                  <span className="lb2-cat-go" aria-hidden="true">
                    <Icon name="chevR" size={18} />
                  </span>
                </button>
              ))}
            </nav>
            )}
            {zero && (
              <Empty
                what="Tiff can only answer from what’s here"
                line={
                  canManage
                    ? "Upload the manuals, fault-code books, datasheets and SOPs your team already relies on: Installation documents, Service documents, Manufacturer specs and Company SOPs. Tiff reads every page, then answers with the page she read it from."
                    : "Ask a manager to add the company’s manuals: Installation documents, Service documents, Manufacturer specs and Company SOPs."
                }
                action={
                  canManage ? (
                    <Button kind="main" icon="plus" onClick={() => setDrawer(true)}>
                      Add a document
                    </Button>
                  ) : null
                }
              />
            )}
          </>
        )}

        {opened !== null && (!zero || inToolbox) && (
          <div className="lb2-bar">
            <div className="lb2-tools">
              {!inToolbox && filterTags.length > 0 && (
                <>
                  <Button
                    ref={tagRef}
                    kind="second"
                    size={36}
                    icon="tag"
                    aria-haspopup="menu"
                    aria-expanded={tagMenu}
                    aria-label={tagIds.length ? `Tags: ${tagWord}` : "Tags"}
                    onClick={() => setTagMenu((o) => !o)}
                  >
                    {tagWord}
                    <span className="lb2-chev" aria-hidden="true">
                      <Icon name="chevD" size={16} />
                    </span>
                  </Button>
                  <Menu
                    open={tagMenu}
                    anchor={tagRef}
                    onClose={() => setTagMenu(false)}
                    onSelect={(key) => toggleTag(key)}
                    items={tagItems}
                    label="Narrow by tag"
                    filter={tagItems.length > 8}
                    align="end"
                  />
                  {tagIds.length > 0 && (
                    <Button kind="quiet" onClick={() => setTags([])}>
                      Clear tags
                    </Button>
                  )}
                </>
              )}
              {(!zero || inToolbox) && (
                <div className="lb2-search" role="search">
                  <span className="lb2-search-icon" aria-hidden="true">
                    <Icon name="search" size={16} />
                  </span>
                  <TextInput
                    className="lb2-search-input"
                    aria-label={inToolbox ? "Search tools" : view === "specs" ? "Search a model or a document" : "Search documents"}
                    placeholder={inToolbox ? "Search tools" : view === "specs" ? "Search a model or a document, e.g. PUMY-SP140" : "Search documents"}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape" && query) setQuery("");
                    }}
                  />
                  {query && (
                    <IconButton glyph="clear" label="Clear the search box" size={32} className="lb2-search-clear" onClick={() => setQuery("")} />
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {view === "specs" && <ModelSpecs query={query} />}

        {opened !== null && (
        <div id={`${PANEL}-${view}`} className="lb2-panel">
          {inToolbox && toolbox ? (
            shownTools.length === 0 ? (
              <Empty
                what={`No tools match “${query.trim()}”`}
                action={
                  <Button kind="second" onClick={() => setQuery("")}>
                    Clear the search
                  </Button>
                }
              />
            ) : (
              <ul className="lb2-cards" aria-label="Toolbox">
                {shownTools.map(({ tool }) => {
                  const badge = toolBadge(tool, toolbox.today);
                  return (
                    <li key={tool.href} className="lb2-card">
                      <Link href={tool.href} className="lb2-card-t lb2-hit">
                        {tool.name}
                      </Link>
                      <span className="lb2-card-m">{tool.desc}</span>
                      {badge && <StateWord tone="info">{badge}</StateWord>}
                    </li>
                  );
                })}
              </ul>
            )
          ) : zero ? (
            <Empty
              what="Tiff can only answer from what’s here"
              line={
                canManage
                  ? "Upload the manuals, fault-code books, datasheets and SOPs your team already relies on: Installation documents, Service documents, Manufacturer specs and Company SOPs. Tiff reads every page, then answers with the page she read it from."
                  : "Ask a manager to add the company’s manuals: Installation documents, Service documents, Manufacturer specs and Company SOPs."
              }
              action={
                canManage ? (
                  <Button kind="main" icon="plus" onClick={() => setDrawer(true)}>
                    Add a document
                  </Button>
                ) : null
              }
            />
          ) : visible.length === 0 && view !== "all" && counts[view as KbCategoryKey] === 0 ? (
            /* a category with nothing in it says what belongs in it (rule 40) */
            <Empty
              what={`Nothing in ${KB_CATEGORIES.find((c) => c.key === view)?.label ?? "this category"} yet`}
              line={
                canManage
                  ? `${KB_CATEGORIES.find((c) => c.key === view)?.blurb ?? ""}. Tiff can't answer from this category until something lands in it.`
                  : "Ask a manager to add the company’s manuals for this category."
              }
              action={
                canManage && view !== "field" ? (
                  <Button kind="main" icon="plus" onClick={() => setDrawer(true)}>
                    Add a document
                  </Button>
                ) : null
              }
            />
          ) : visible.length === 0 && filtering ? (
            /* One empty state for both filters, because they combine: "Daikin"
               AND "VRV" AND the word "chiller" can each be perfectly good on
               their own and find nothing together. */
            <Empty
              what={
                query.trim() && tagIds.length > 0
                  ? `Nothing matches “${query.trim()}” with those tags`
                  : query.trim()
                    ? `No documents match “${query.trim()}”`
                    : "No documents wear all of those tags"
              }
              line={!query.trim() && tagIds.length > 1 ? "Tags narrow together: a document has to wear every one you’ve picked." : undefined}
              action={
                <Button kind="second" onClick={clearFilters}>
                  {query.trim() && tagIds.length > 0 ? "Clear the filters" : query.trim() ? "Clear the search" : "Clear the tags"}
                </Button>
              }
            />
          ) : (
            <div className="lb2-docs">
              <ul className="lb2-cards" aria-label={opened?.label ?? "Documents"}>
                {visible.map((d) => (
                  <DocRow
                    key={d.id}
                    doc={d}
                    showKind={false}
                    layout="card"
                    state={rowState(d, ingest.progress[d.id], quota)}
                    ocr={ocrView(d, ocr.progress[d.id], ocr.running)}
                    canManage={canManage}
                    isOwner={isOwner}
                    error={rowErrors[d.id]}
                    onOpen={() => setSearching(d)}
                    onAsk={() => askAbout(d)}
                    onEdit={() => setEditing(d)}
                    onDelete={() => setDeleting(d)}
                    onRetry={async () => {
                      setRowError(d.id, null);
                      const res = await retryKbDoc(d.id);
                      if (!res.ok) {
                        setRowError(d.id, res.error);
                        return;
                      }
                      ingest.start([d.id]);
                      router.refresh();
                    }}
                    onRead={() => ocr.read(d.id)}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
        )}
      </div>

      {drawer && canManage && (
        <UploadDrawer
          tags={tags}
          large={large}
          progress={ingest.progress}
          onIngest={(ids) => ingest.start(ids)}
          onClose={() => setDrawer(false)}
        />
      )}
      {managing && canManage && (
        <TagManager tags={tags} usage={tagUsage} onClose={() => setManaging(false)} />
      )}
      {editing && canManage && (
        <EditModal doc={editing} tags={tags} onClose={() => setEditing(null)} />
      )}
      {deleting && canManage && isOwner && (
        <DeleteDialog doc={deleting} onClose={() => setDeleting(null)} />
      )}
      {/* No `canManage` — searching a document is reading it, and the whole
          library is a read surface for staff. */}
      {searching && <DocSearch doc={searching} onClose={() => setSearching(null)} />}
    </div>
  );
}

/* ── the passages with no vector yet ─────────────────────────────────────── */

/* One quiet line, not a banner. Nothing is broken: these passages are stored,
   cited and found by keyword — they are only missing from the leg that matches
   what somebody MEANT, which is a thing to fix when convenient rather than an
   alarm.

   THE RATE LIMIT IS NAMED, because it is the only version of this a person can
   act on: an account with no payment method on the Voyage billing page gets 3
   requests a minute. Saying "try again later" without saying why would
   guarantee a second afternoon of diagnosis. */
function EmbedGap({ count }: { count: number }) {
  const fill = useKbBackfill(count);
  const total = fill.done + fill.remaining;

  // finished: the page refresh that follows removes the line for good, and
  // "0 passages" in the gap between is a sentence nobody should ever read
  if (!fill.running && fill.remaining <= 0) return null;

  return (
    <p className="lb2-gap">
      {fill.running ? (
        <span>{`Filling in ${n(fill.done)} of ${n(total)} passages`}</span>
      ) : fill.stopped === "rate-limited" ? (
        <span>
          Voyage is rate-limiting: this account is capped at 3 requests a minute until a payment
          method is added. Try again later, or add one.
        </span>
      ) : fill.stopped === "unconfigured" ? (
        <span>Semantic search isn&rsquo;t switched on, so there&rsquo;s nothing to fill these in with.</span>
      ) : fill.stopped === "failed" ? (
        <span>That didn&rsquo;t finish. {n(fill.remaining)} still to go.</span>
      ) : (
        <span>
          {`${n(count)} ${plural(count, "passage")} ${count === 1 ? "isn't" : "aren't"} searchable by meaning yet`}
        </span>
      )}
      {!fill.running && fill.stopped !== "unconfigured" && (
        <Button kind="quiet" size={32} onClick={fill.start}>
          {fill.stopped ? "Try again" : "Fill these in"}
        </Button>
      )}
    </p>
  );
}

/* ── one document ────────────────────────────────────────────────────────── */

function DocRow({
  doc,
  showKind,
  layout = "row",
  state,
  ocr,
  canManage,
  isOwner,
  error,
  onOpen,
  onAsk,
  onEdit,
  onDelete,
  onRetry,
  onRead,
}: {
  doc: KbLibraryDoc;
  showKind: boolean;
  /** "card": a shelf's small card, the title on up to two lines */
  layout?: "row" | "card";
  state: RowState;
  ocr: OcrView;
  canManage: boolean;
  isOwner: boolean;
  error?: string;
  onOpen: () => void;
  onAsk: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRetry: () => Promise<void>;
  onRead: () => void;
}) {
  const [busy, start] = useTransition();
  const [menu, setMenu] = useState(false);
  const actRef = useRef<HTMLButtonElement>(null);
  const ready = state.status === "ready";
  const meta = metaLine(doc);
  const tagsSaid = tagLine(doc.tags ?? []);
  const said = stateOf(state, ocr);
  const kind = KB_CATEGORIES.find((c) => c.key === doc.category)?.label ?? "";
  const added = fmtAuDayMonth(auDayOf(doc.uploadedAt ?? doc.updatedAt));

  /* OFFERED WHERE THE PROBLEM IS SAID, and only there. Reading scanned pages
     appears at the moment somebody has just been told there are pages Tiff
     couldn't read, and waits its turn while another document is being read:
     one allowance, one run. Retry and Resume sit beside the word that says
     why. Each is a manager's: staff read the library, managers spend it. */
  const offerRead = canManage && ready && ocr.left > 0 && !ocr.reading && !ocr.spent;
  const readBtn = (
    <Button kind="second" size={32} disabled={ocr.waiting} onClick={onRead}>
      Read pages
    </Button>
  );
  const fix =
    canManage && (state.status === "failed" || state.status === "paused") ? (
      <Button kind="second" size={32} disabled={busy} onClick={() => start(async () => onRetry())}>
        {state.status === "paused" ? "Resume" : "Retry"}
      </Button>
    ) : offerRead ? (
      ocr.waiting ? (
        <Tooltip label="Reading another document first">{readBtn}</Tooltip>
      ) : (
        readBtn
      )
    ) : null;

  /* A manager's other doings sit in one Actions menu; staff have one thing to
     do to a document, ask about it, so it is their row's one button. Asking
     is only for a READY document: Tiff can't be asked about pages she hasn't
     read yet. */
  const actions: MenuItem[] = [
    ...(ready ? [{ key: "ask", label: "Ask Tiff about it" }] : []),
    { key: "edit", label: "Edit details" },
    ...(isOwner ? [{ key: "remove", label: "Remove document", danger: true }] : []),
  ];

  const actionsMenu = canManage ? (
    <>
      <Button
        ref={actRef}
        kind="quiet"
        size={32}
        aria-haspopup="menu"
        aria-expanded={menu}
        aria-label={`Actions on ${doc.title}`}
        onClick={() => setMenu((o) => !o)}
      >
        Actions
        <span className="lb2-chev" aria-hidden="true">
          <Icon name="chevD" size={16} />
        </span>
      </Button>
      <Menu
        open={menu}
        anchor={actRef}
        onClose={() => setMenu(false)}
        onSelect={(key) => {
          if (key === "ask") onAsk();
          else if (key === "edit") onEdit();
          else if (key === "remove") onDelete();
        }}
        items={actions}
        label={`Actions on ${doc.title}`}
        align="end"
      />
    </>
  ) : ready ? (
    <Button kind="quiet" size={32} icon={<TiffGlyph quiet />} aria-label={`Ask Tiff about ${doc.title}`} onClick={onAsk}>
      Ask Tiff
    </Button>
  ) : null;

  /* A SHELF'S CARD (Isaac, 20 October): the title on up to two lines, fading
     only past that (Edit details renames a long one), the maker and the
     edition, the state, and the one door. */
  if (layout === "card")
    return (
      <li className={`lb2-card${ready ? " lb2-card--open" : ""}`}>
        {ready ? (
          <button type="button" className="lb2-card-t lb2-hit" onClick={onOpen}>
            {doc.title}
          </button>
        ) : (
          <span className="lb2-card-t">{doc.title}</span>
        )}
        {cardLine(doc) && <span className="lb2-card-m">{cardLine(doc)}</span>}
        <StateWord tone={said.tone}>{said.word}</StateWord>
        {error && <span className="lb2-err">{error}</span>}
        {(fix || actionsMenu) && (
          <span className="lb2-card-foot">
            {fix}
            {actionsMenu}
          </span>
        )}
      </li>
    );

  return (
    <li className={`lb2-row${ready ? " lb2-row--open" : ""}`}>
      <span className="lb2-cell lb2-name">
        {/* THE NAME OPENS THE DOCUMENT'S OWN PANEL, not the raw file: a place
            that can be searched, with the PDF one press further on. Nothing
            is indexed until the document has been read, so until then it is
            not a thing to press. */}
        {ready ? (
          <button type="button" className="lb2-hit" onClick={onOpen}>
            <Fade className="lb2-doc">{doc.title}</Fade>
          </button>
        ) : (
          <Fade className="lb2-doc">{doc.title}</Fade>
        )}
        {meta && <Fade className="lb2-sub">{meta}</Fade>}
        {tagsSaid && <Fade className="lb2-sub">{tagsSaid}</Fade>}
        {error && <span className="lb2-err">{error}</span>}
      </span>
      {showKind && (
        <span className="lb2-cell lb2-q">
          <Fade>{kind}</Fade>
        </span>
      )}
      <span className="lb2-cell lb2-q lb2-num">{added}</span>
      <span className="lb2-cell lb2-state">
        <StateWord tone={said.tone}>{said.word}</StateWord>
      </span>
      <span className="lb2-cell lb2-end">
        {fix}
        {canManage ? (
          <>
            <Button
              ref={actRef}
              kind="quiet"
              size={32}
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-label={`Actions on ${doc.title}`}
              onClick={() => setMenu((o) => !o)}
            >
              Actions
              <span className="lb2-chev" aria-hidden="true">
                <Icon name="chevD" size={16} />
              </span>
            </Button>
            <Menu
              open={menu}
              anchor={actRef}
              onClose={() => setMenu(false)}
              onSelect={(key) => {
                if (key === "ask") onAsk();
                else if (key === "edit") onEdit();
                else if (key === "remove") onDelete();
              }}
              items={actions}
              label={`Actions on ${doc.title}`}
              align="end"
            />
          </>
        ) : (
          ready && (
            <Button kind="quiet" size={32} icon={<TiffGlyph quiet />} aria-label={`Ask Tiff about ${doc.title}`} onClick={onAsk}>
              Ask Tiff
            </Button>
          )
        )}
      </span>
    </li>
  );
}

/* ── metadata, and removal ───────────────────────────────────────────────── */

/* Today's edit form, kept as it is (its tag picker is styled for this modal),
   with the category picked from the app's own chooser rather than a native
   select. */
function EditModal({
  doc,
  tags,
  onClose,
}: {
  doc: KbLibraryDoc;
  tags: KbTagRef[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(doc.title);
  const [category, setCategory] = useState<string>(doc.category);
  const [source, setSource] = useState(doc.source ?? "");
  const [edition, setEdition] = useState(doc.edition ?? "");
  const [tagIds, setTagIds] = useState<string[]>((doc.tags ?? []).map((t) => t.id));
  /* A tag created from inside the picker exists on the server before this
     modal closes, and the list it was handed came from the page's last render
     — so the new one is added here rather than waiting for a refresh that
     hasn't happened yet. */
  const [known, setKnown] = useState<KbTagRef[]>(tags);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  /* Written from somebody's note rather than uploaded: no shelf to move to,
     and no file behind it. The server refuses to file anything else as one,
     so offering the other four would make every save fail. */
  const isFieldNote = doc.category === "field";

  const save = () =>
    start(async () => {
      const res = await updateKbDocMeta(doc.id, { title, category, source, edition, tagIds });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fl-ov" onClick={onClose}>
      <div className="fl-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Edit document">
        <div className="fl-mh">
          <span>
            <b>Edit document</b>
            <em>What it&rsquo;s called, where it sits, and what it&rsquo;s about</em>
          </span>
          <button className="fl-x" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="fl-mb">
          {error && <div className="fl-err">{error}</div>}
          <div className="fl-grid">
            <label className="fl-f span">
              <span>
                Title<i>*</i>
              </span>
              <input className="fl-i" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            {!isFieldNote && (
              <div className="fl-f">
                <span>Category</span>
                <Chooser
                  aria-label="Category"
                  value={category}
                  onChange={setCategory}
                  options={KB_CATEGORIES.filter((c) => c.key !== "field").map((c) => ({ value: c.key, label: c.label }))}
                />
              </div>
            )}
            <label className="fl-f">
              <span>Source</span>
              <input
                className="fl-i"
                placeholder="Mitsubishi Electric"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            </label>
            <label className="fl-f span">
              <span>Edition</span>
              <input
                className="fl-i"
                placeholder="2026 revision B"
                value={edition}
                onChange={(e) => setEdition(e.target.value)}
              />
            </label>
          </div>
          <TagPicker
            variant="modal"
            tags={known}
            value={tagIds}
            onChange={setTagIds}
            onCreated={(tag) => setKnown((list) => (list.some((t) => t.id === tag.id) ? list : [...list, tag]))}
          />
          <div className="fl-foot">
            <button className="fl-btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="fl-btn primary" disabled={busy || !title.trim()} onClick={save}>
              <Icon name="save" size={15} />
              Save details
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* Are you sure (rules 25 and 36): the red block only here, both buttons
   naming what they do, and Keep it taking focus. */
function DeleteDialog({ doc, onClose }: { doc: KbLibraryDoc; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const remove = () =>
    start(async () => {
      const res = await deleteKbDoc(doc.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });

  return (
    <ConfirmDialog
      heading={`Remove “${doc.title}”?`}
      confirm={`Remove “${doc.title}”`}
      cancel="Keep it"
      busy={busy}
      onConfirm={remove}
      onClose={onClose}
    >
      <p className="lb2-confirm">
        {doc.category === "field"
          ? "This note and everything Tiff read out of it are deleted. Answers that used to cite it will stop doing so, and there is no undo."
          : "The file and everything Tiff read out of it are deleted. Answers that used to cite this document will stop doing so, and there is no undo."}
      </p>
      {error && <p className="lb2-confirm lb2-err">{error}</p>}
    </ConfirmDialog>
  );
}
