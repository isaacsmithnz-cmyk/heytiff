"use client";

import { useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { KB_CATEGORIES, filterKbDocs, type KbCategoryKey } from "./kb";
import { UploadDrawer } from "./upload-drawer";
import { auDayOf, fmtAuDayMonth } from "@/lib/au-dates";
import { deleteKbDoc, kbDocUrl, retryKbDoc, updateKbDocMeta } from "@/app/actions/kb";
import { writeAskHandoff } from "@/lib/tiff/ask-handoff";
import { useKbIngest, type KbIngestProgress } from "@/lib/tiff/use-kb-ingest";
import { useKbBackfill } from "@/lib/tiff/use-kb-backfill";
import type { KbDocRow } from "@/lib/tiff/query";
import type { KbQuota } from "@/lib/tiff/quota";

/* The library — what Tiff has read, and what it hasn't yet.

   A DOCUMENT'S STATE IS THE POINT OF THIS SCREEN, not a decoration on it. A
   row that isn't `ready` cannot be cited yet, so every row says where it is:
   how far through the reading it is, that it ran out of the month's pages, or
   why it failed and what to press. The brief's §4C distinction, made visible.

   THE LOOP RUNS FROM HERE. There is no queue on the server (Hobby allows one
   cron a day), so this page is what drives ingestion: it adopts anything the
   server still calls `processing` on mount and works through it one document
   at a time. Closing the page stops the asking, never the batch already in
   flight — the bookmark survives and the next visit picks it up.

   THE STAFF VARIANT IS ABSENT, NOT DISABLED. Without `tiff_manage` there is no
   Add button, no row actions and no quota line anywhere in the markup: a greyed
   control is an invitation to ask why, and this is a read surface for staff by
   design. Every action re-checks the capability server-side regardless. */

export type KbLibraryDoc = KbDocRow & { uploaderName?: string | null };

/* The quota as it crosses to the browser. `pagesAllowed` is Infinity on the
   unlimited tier, which is not a number a props payload should be asked to
   carry — the page nulls it out, and null IS the unlimited tier here. */
export type KbQuotaView = Omit<KbQuota, "pagesAllowed" | "pagesRemaining"> & {
  pagesAllowed: number | null;
};

const n = (v: number) => v.toLocaleString("en-AU");

const plural = (count: number, one: string, many = `${one}s`) => (count === 1 ? one : many);

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

function metaLine(d: KbLibraryDoc): string {
  const bits = [d.source, d.edition].filter(Boolean) as string[];
  const updated = fmtAuDayMonth(auDayOf(d.updatedAt));
  if (updated) bits.push(`Updated ${updated}`);
  if (d.uploaderName) bits.push(`Added by ${d.uploaderName}`);
  return bits.join(" · ");
}

/* ── the page ────────────────────────────────────────────────────────────── */

export function Library({
  docs,
  quota = null,
  canManage = false,
  isOwner = false,
  unembedded = 0,
  initialCategory = null,
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
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<KbCategoryKey | null>(initialCategory);
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState<KbLibraryDoc | null>(null);
  const [deleting, setDeleting] = useState<KbLibraryDoc | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const processing = useMemo(
    () => (canManage ? docs.filter((d) => d.status === "processing").map((d) => d.id) : []),
    [docs, canManage]
  );
  const ingest = useKbIngest(processing);

  const counts = useMemo(() => {
    const c = { install: 0, faults: 0, specs: 0, sops: 0 } as Record<KbCategoryKey, number>;
    for (const d of docs) c[d.category] += 1;
    return c;
  }, [docs]);

  const matches = useMemo(() => filterKbDocs(docs, query), [docs, query]);
  const visible = useMemo(() => (cat ? matches.filter((d) => d.category === cat) : matches), [matches, cat]);

  const sections = KB_CATEGORIES.filter((c) => (cat ? c.key === cat : visible.some((d) => d.category === c.key)));

  const setRowError = (id: string, message: string | null) =>
    setRowErrors((m) => {
      const next = { ...m };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });

  const openDoc = async (d: KbLibraryDoc) => {
    setRowError(d.id, null);
    // opened synchronously so the pop-up blocker sees the click; the signed
    // URL is a round trip away and would arrive too late to be trusted
    const tab = typeof window === "undefined" ? null : window.open("", "_blank");
    const res = await kbDocUrl(d.id);
    if (!res.ok) {
      tab?.close();
      setRowError(d.id, res.error);
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = res.url;
    } else if (typeof window !== "undefined") {
      window.open(res.url, "_blank", "noopener,noreferrer");
    }
  };

  /* "Ask Tiff about this document" (brief §4D) — a document hands the composer
     the opening of a sentence and gets out of the way. The prefill travels in
     session storage rather than the URL because it is the start of somebody's
     question, and a question doesn't belong in a link or a history entry. It
     is offered to anyone who can see the row: reading the library and asking
     about it are the same permission, and `tiff_manage` is about changing it. */
  const askAbout = (d: KbLibraryDoc) => {
    writeAskHandoff(d.title);
    router.push("/dashboard/tiff");
  };

  const zero = docs.length === 0;

  return (
    <div className="page in">
      <div className="wrap">
        <div className="tk-head">
          <div className="stg">
            <Link href="/dashboard/tiff" className="kbcrumb">
              <Icon name="chevL" size={14} />
              Tiff AI
            </Link>
            <h1 className="tk-h1">Library</h1>
            <p className="tk-sub">
              {zero
                ? "Nothing here yet — Tiff answers from what you upload."
                : `${n(docs.length)} ${plural(docs.length, "document")} Tiff can read`}
            </p>
            {canManage && quota && (
              <p className="tk-quota">
                <Icon name="layers" size={14} />
                {quota.pagesAllowed === null
                  ? "Unlimited pages"
                  : `${n(quota.pagesUsed)} of ${n(quota.pagesAllowed)} pages this month · resets ${fmtAuDayMonth(quota.resetsOn)}`}
              </p>
            )}
            {canManage && unembedded > 0 && <EmbedGap count={unembedded} />}
          </div>

          {/* on the empty library the CTA belongs to the sell below, which is
              the whole screen — two Add buttons on one page is one too many */}
          {canManage && !zero && (
            <button type="button" className="tk-btn primary" onClick={() => setDrawer(true)}>
              <Icon name="plus" size={16} />
              Add documents
            </button>
          )}
        </div>

        {!zero && (
          <div className="tk-tools">
            <div className="tk-search">
              <Icon name="search" size={18} />
              <input
                placeholder="Search documents…"
                aria-label="Search documents"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="tk-chips">
              <button
                type="button"
                className={`tk-chip${cat === null ? " on" : ""}`}
                aria-pressed={cat === null}
                onClick={() => setCat(null)}
              >
                All
                <em>{n(docs.length)}</em>
              </button>
              {KB_CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={`tk-chip${cat === c.key ? " on" : ""}`}
                  aria-pressed={cat === c.key}
                  style={{ "--tkc": c.color } as React.CSSProperties}
                  onClick={() => setCat(cat === c.key ? null : c.key)}
                >
                  <span className="tk-dot" style={{ background: c.color }} />
                  {c.label}
                  {/* `?? 0` so a shelf the caller's payload predates renders
                      as empty rather than crashing the library — the exact
                      seam the field shelf crossed when it arrived. */}
                  <em>{n(counts[c.key] ?? 0)}</em>
                </button>
              ))}
            </div>
          </div>
        )}

        {zero ? (
          <EmptyLibrary canManage={canManage} onAdd={() => setDrawer(true)} />
        ) : visible.length === 0 && query.trim() ? (
          <div className="tk-empty small">
            <h2>No documents match “{query.trim()}”</h2>
            <p>Search runs over titles and sources. Try the brand, or the model number.</p>
            <button type="button" className="tk-btn ghost" onClick={() => setQuery("")}>
              Clear the search
            </button>
          </div>
        ) : (
          <div className="tk-list stgp">
            {sections.map((c) => {
              const rows = visible.filter((d) => d.category === c.key);
              return (
                <section
                  key={c.key}
                  className="tk-cat spot"
                  style={{ "--sc": `${c.color}1f`, "--tkc": c.color } as React.CSSProperties}
                >
                  <span className="sglow" />
                  <div className="tk-cin">
                    <header className="tk-chd">
                      <div
                        className="tk-cic"
                        style={{
                          background: `${c.color}15`,
                          border: `1px solid ${c.color}30`,
                          color: c.color,
                        }}
                      >
                        <Icon name={c.icon} size={16} />
                      </div>
                      <div>
                        <h2>{c.label}</h2>
                        <p>
                          {counts[c.key] === 0
                            ? c.blurb
                            : `${n(rows.length)} ${plural(rows.length, "document")} · ${c.blurb}`}
                        </p>
                      </div>
                    </header>

                    {rows.length === 0 ? (
                      <div className="tk-note">
                        {counts[c.key] === 0 ? (
                          <>
                            <b>Nothing in this category yet.</b>
                            {/* The blurb is a description, not a noun phrase —
                                splicing it in produced "Tiff can't answer how
                                we do things here questions". */}
                            <span>
                              {canManage
                                ? "Tiff can't answer from this category until something lands in it."
                                : "Ask a manager to add the company's manuals for this category."}
                            </span>
                          </>
                        ) : (
                          <>
                            <b>No matches in {c.label}.</b>
                            <span>{n(counts[c.key])} here, none matching your search.</span>
                          </>
                        )}
                      </div>
                    ) : (
                      rows.map((d) => (
                        <DocRow
                          key={d.id}
                          doc={d}
                          state={rowState(d, ingest.progress[d.id], quota)}
                          colour={c.color}
                          canManage={canManage}
                          isOwner={isOwner}
                          error={rowErrors[d.id]}
                          onOpen={() => openDoc(d)}
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
                        />
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {drawer && canManage && (
        <UploadDrawer
          progress={ingest.progress}
          onIngest={(ids) => ingest.start(ids)}
          onClose={() => setDrawer(false)}
        />
      )}
      {editing && canManage && <EditModal doc={editing} onClose={() => setEditing(null)} />}
      {deleting && canManage && isOwner && (
        <DeleteModal doc={deleting} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}

/* ── the passages with no vector yet ─────────────────────────────────────── */

/* One quiet line, not a banner. Nothing is broken: these passages are stored,
   cited and found by keyword — they are only missing from the leg that matches
   what somebody MEANT, which is a thing to fix when convenient rather than an
   alarm. It sits under the quota line because it is the same kind of fact.

   THE RATE LIMIT IS NAMED, because it is the only version of this a person can
   act on: an account with no payment method on the Voyage billing page gets 3
   requests a minute, which is what left the passages behind in the first
   place. Saying "try again later" without saying why would guarantee a second
   afternoon of diagnosis. */
function EmbedGap({ count }: { count: number }) {
  const fill = useKbBackfill(count);
  const total = fill.done + fill.remaining;

  // finished: the page refresh that follows removes the line for good, and
  // "0 passages" in the gap between is a sentence nobody should ever read
  if (!fill.running && fill.remaining <= 0) return null;

  return (
    <p className="tk-gap">
      <Icon name="sparkles" size={14} />
      {fill.running ? (
        <span>{`Filling in… ${n(fill.done)} of ${n(total)}`}</span>
      ) : fill.stopped === "rate-limited" ? (
        <span>
          Voyage is rate-limiting — this account is capped at 3 requests a minute until a payment
          method is added. Try again later, or add one.
        </span>
      ) : fill.stopped === "unconfigured" ? (
        <span>Semantic search isn&rsquo;t switched on, so there&rsquo;s nothing to fill these in with.</span>
      ) : fill.stopped === "failed" ? (
        <span>That didn&rsquo;t finish — {n(fill.remaining)} still to go.</span>
      ) : (
        <span>
          {`${n(count)} ${plural(count, "passage")} ${count === 1 ? "isn't" : "aren't"} searchable by meaning yet`}
        </span>
      )}
      {!fill.running && fill.stopped !== "unconfigured" && (
        <button type="button" className="tk-gapb" onClick={fill.start}>
          {fill.stopped ? "Try again" : "Fill these in"}
        </button>
      )}
    </p>
  );
}

/* ── the day-1 state: sell the reason before the button ──────────────────── */

function EmptyLibrary({ canManage, onAdd }: { canManage: boolean; onAdd: () => void }) {
  return (
    <div className="tk-empty stgp">
      <div className="tk-eic">
        <Icon name="library" size={30} />
      </div>
      <h2>Tiff can only answer from what&rsquo;s here</h2>
      <p>
        Upload the manuals, fault-code books, datasheets and SOPs your team already relies on. Tiff
        reads every page, then answers questions with the page it read them from — so the answer is
        the manual&rsquo;s, not a guess.
      </p>
      <div className="tk-egrid">
        {KB_CATEGORIES.map((c) => (
          <div key={c.key} className="tk-ecard" style={{ "--tkc": c.color } as React.CSSProperties}>
            <span className="tk-dot" style={{ background: c.color }} />
            <b>{c.label}</b>
            <em>{c.blurb}</em>
          </div>
        ))}
      </div>
      {canManage ? (
        <button type="button" className="tk-btn primary" onClick={onAdd}>
          <Icon name="plus" size={16} />
          Add documents
        </button>
      ) : (
        <p className="tk-ehint">Ask a manager to add the company&rsquo;s manuals.</p>
      )}
    </div>
  );
}

/* ── one document ────────────────────────────────────────────────────────── */

function DocRow({
  doc,
  state,
  colour,
  canManage,
  isOwner,
  error,
  onOpen,
  onAsk,
  onEdit,
  onDelete,
  onRetry,
}: {
  doc: KbLibraryDoc;
  state: RowState;
  colour: string;
  canManage: boolean;
  isOwner: boolean;
  error?: string;
  onOpen: () => void;
  onAsk: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRetry: () => Promise<void>;
}) {
  const [busy, start] = useTransition();
  const ready = state.status === "ready";
  const meta = metaLine(doc);

  return (
    <div className={`tk-row${ready ? " ready" : ""}`}>
      <span className="tk-dot" style={{ background: ready ? colour : "#d1d5db" }} />

      <div className="tk-rmain">
        {ready ? (
          <button type="button" className="tk-rt" onClick={onOpen}>
            {doc.title}
            <Icon name="arrowUR" size={14} />
          </button>
        ) : (
          <span className="tk-rt flat">{doc.title}</span>
        )}
        {meta && <em className="tk-rmeta">{meta}</em>}
        {error && <p className="tk-rerr">{error}</p>}
      </div>

      {/* No kind badge, and no pill on a ready document.
          Every row in this library is a PDF and most of them are ready, so
          both were a column of identical labels saying nothing — and they
          were what the one row that IS stuck had to compete with. A pill now
          means "this needs you"; a row without one is working. */}
      <div className="tk-rstate">
        <StatusPill doc={doc} state={state} />
      </div>

      {/* only a READY document — Tiff can't be asked about pages it hasn't
          read yet, and an affordance that leads to a shrug is worse than none */}
      {ready && (
        <button
          type="button"
          className="tk-ask"
          aria-label={`Ask Tiff about ${doc.title}`}
          title="Ask Tiff about this document"
          onClick={onAsk}
        >
          <Icon name="sparkles" size={15} />
          Ask Tiff
        </button>
      )}

      {canManage && (
        <div className="tk-acts">
          {(state.status === "failed" || state.status === "paused") && (
            <button
              type="button"
              className="tk-abtn"
              disabled={busy}
              onClick={() => start(async () => onRetry())}
            >
              {state.status === "paused" ? "Resume" : "Retry"}
            </button>
          )}
          <button type="button" className="tk-abtn ico" title="Edit details" aria-label={`Edit ${doc.title}`} onClick={onEdit}>
            <Icon name="edit" size={15} />
          </button>
          {isOwner && (
            <button
              type="button"
              className="tk-abtn ico dan"
              title="Remove"
              aria-label={`Remove ${doc.title}`}
              onClick={onDelete}
            >
              <Icon name="x" size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function StatusPill({ doc, state }: { doc: KbLibraryDoc; state: RowState }) {
  if (state.status === "processing") {
    const known = state.pageCount !== null && state.pageCount > 0;
    return (
      <span className="tk-pill work">
        <span className="tk-spin" aria-hidden="true" />
        <span>
          {known
            ? `Reading… ${n(state.pagesDone)} of ${n(state.pageCount as number)} pages`
            : "Reading…"}
        </span>
        <span className={`tk-prog${known ? "" : " ind"}`} aria-hidden="true">
          <i style={known ? { width: `${Math.min(100, (state.pagesDone / (state.pageCount as number)) * 100)}%` } : undefined} />
        </span>
      </span>
    );
  }

  if (state.status === "paused") {
    return (
      <span className="tk-pill warn">
        <Icon name="clock" size={13} />
        {state.resetsOn
          ? `Out of pages — resumes ${fmtAuDayMonth(state.resetsOn)}`
          : "Out of pages this month"}
      </span>
    );
  }

  if (state.status === "failed") {
    return (
      <span className="tk-pill dan">
        <Icon name="alert" size={13} />
        {state.error || "Couldn't be read"}
      </span>
    );
  }

  if (state.status === "uploading") {
    return (
      <span className="tk-pill work">
        <span className="tk-spin" aria-hidden="true" />
        Uploading…
      </span>
    );
  }

  /* Ready is the state almost every row is in, so saying it earns nothing and
     costs the one row that needs attention its contrast. What survives is the
     part of "ready" that ISN'T good news: pages Tiff could not read. A caveat
     is amber, not green — the document is usable, but not all of it is. */
  if (doc.scannedPages > 0) {
    return (
      <span className="tk-pill warn">
        <Icon name="alert" size={13} />
        {`${n(doc.scannedPages)} ${plural(doc.scannedPages, "page")} unreadable — scanned images`}
      </span>
    );
  }

  return null;
}

/* ── metadata, and removal ───────────────────────────────────────────────── */

function EditModal({ doc, onClose }: { doc: KbLibraryDoc; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(doc.title);
  const [category, setCategory] = useState<string>(doc.category);
  const [source, setSource] = useState(doc.source ?? "");
  const [edition, setEdition] = useState(doc.edition ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const save = () =>
    start(async () => {
      const res = await updateKbDocMeta(doc.id, { title, category, source, edition });
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
            <em>What it&rsquo;s called, and which category it&rsquo;s in</em>
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
            <label className="fl-f">
              <span>Category</span>
              <select className="fl-i" value={category} onChange={(e) => setCategory(e.target.value)}>
                {KB_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
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

function DeleteModal({ doc, onClose }: { doc: KbLibraryDoc; onClose: () => void }) {
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

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fl-ov" onClick={onClose}>
      <div className="fl-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Remove document">
        <div className="fl-mh">
          <span>
            <b>Remove “{doc.title}”?</b>
            <em>Tiff stops quoting it from the moment it goes</em>
          </span>
          <button className="fl-x" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="fl-mb">
          {error && <div className="fl-err">{error}</div>}
          <p className="tk-confirm">
            The file and everything Tiff read out of it are deleted. Answers that used to cite this
            document will stop doing so — there is no undo.
          </p>
          <div className="fl-foot">
            <button className="fl-btn ghost" onClick={onClose}>
              Keep it
            </button>
            <button className="fl-btn danger arm" disabled={busy} onClick={remove}>
              Remove “{doc.title}”
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
