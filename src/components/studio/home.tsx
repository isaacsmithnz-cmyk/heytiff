"use client";

/* DESIGN, THE HOME (v2, 19 October; the board studio-home at
   https://claude.ai/artifact/JJX25x6p7UB4Fd4fHSrkMr). The title with how
   many designs there are, Import design file and New design on the right;
   a search and a sort; the designs as rows (a picture of the plan, the
   name, its job, floors, systems, when it changed) and the unit library in
   the rail. New design opens one dialog from the job to the canvas
   (new-design.tsx). */

import { useEffect, useRef, useState } from "react";
import { Button, IconButton } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { ConfirmDialog } from "@/components/parts/dialog";
import { Fade } from "@/components/parts/fade";
import { TextInput } from "@/components/parts/field";
import { Empty } from "@/components/parts/states";
import { Icon } from "@/components/shell/icon";
import { openDesignJson, DesignDocumentError } from "@/lib/studio/migrations";
import type { DesignDocument, Floor, PlanImport } from "@/lib/studio/document";
import type { JobPrefill } from "@/lib/studio/job-link";
import type { LibraryManifest } from "@/lib/studio/packs/library";
import type { PlanImages } from "@/lib/studio/plans";
import type { DesignSummary } from "@/lib/studio/store";
import type { JobSearch } from "./job-search";
import { LibraryDoor } from "./library-modal";
import { NewDesign } from "./new-design";

/* the list shows this many, then Show the rest in place */
export const RECENT_CAP = 12;

type Sort = "new" | "name" | "job";
const SORTS = [
  { value: "new", label: "Newest first" },
  { value: "name", label: "Name, A to Z" },
  { value: "job", label: "Job number" },
];

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs === 1 ? "1 hour ago" : `${hrs} hours ago`;
  const days = Math.round(hrs / 24);
  if (days < 14) return days === 1 ? "Yesterday" : `${days} days ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 9) return `${weeks} weeks ago`;
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

const jobWord = (r: DesignSummary) => [r.jobNumber?.trim(), r.client?.trim()].filter(Boolean).join(" ");

function sorted(rows: DesignSummary[], sort: Sort) {
  if (sort === "name") return [...rows].sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "job") {
    return [...rows].sort((a, b) => {
      const ja = a.jobNumber?.trim() ?? "";
      const jb = b.jobNumber?.trim() ?? "";
      if (!ja !== !jb) return ja ? -1 : 1;
      return jb.localeCompare(ja, undefined, { numeric: true });
    });
  }
  return rows; // the store answers newest first
}

/* A design's picture: its first plan, signed when it comes into view. */
function Thumb({ refId, planImages, mode }: { refId?: string; planImages: PlanImages; mode: DesignSummary["mode"] }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!refId) return;
    let live = true;
    planImages
      .url(refId)
      .then((u) => {
        if (live) setUrl(u);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [refId, planImages]);
  return (
    <span className="ds2-thumb" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" /> : <Icon name={mode === "plan" ? "file" : "square"} size={20} />}
    </span>
  );
}

export function DesignHome({
  recents,
  autoNew,
  sm8Jobs,
  jobSearch,
  openFailed,
  library,
  planImages,
  onBlank,
  onPlans,
  onOpen,
  onDelete,
  onImport,
}: {
  /** null while the list is still being fetched */
  recents: DesignSummary[] | null;
  autoNew?: boolean;
  sm8Jobs?: boolean;
  jobSearch: JobSearch;
  openFailed?: boolean;
  library?: LibraryManifest;
  planImages: PlanImages;
  onBlank: (name: string, job?: JobPrefill) => void;
  onPlans: (name: string, job: JobPrefill | undefined, floors: Floor[], planImport: PlanImport) => Promise<void>;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onImport: (doc: DesignDocument) => void;
}) {
  const [creating, setCreating] = useState(Boolean(autoNew));
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("new");
  const [showAll, setShowAll] = useState(false);
  const [deleting, setDeleting] = useState<DesignSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loading = recents === null;
  const known = recents ?? [];
  const q = query.trim().toLowerCase();
  const matches = sorted(
    known.filter((r) => !q || [r.name, r.jobNumber, r.client].some((v) => (v ?? "").toLowerCase().includes(q))),
    sort,
  );
  const beyond = Math.max(0, matches.length - RECENT_CAP);
  const visible = showAll ? matches : matches.slice(0, RECENT_CAP);

  const importFile = async (file: File) => {
    setImportError(null);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setImportError("Couldn't read that file");
      return;
    }
    let doc: DesignDocument;
    try {
      doc = openDesignJson(text).doc;
    } catch (e) {
      setImportError(
        e instanceof DesignDocumentError
          ? `${e.message}. Import takes design files exported from HeyTiff (.heytiff-design.json).`
          : "Couldn't read that file",
      );
      return;
    }
    onImport(doc);
  };

  return (
    <div className="ds2">
      <header className="ds2-head">
        <div className="ds2-title">
          <h1>Design</h1>
          {!loading && <span className="ds2-fact">{known.length === 1 ? "1 design" : `${known.length} designs`}</span>}
        </div>
        <div className="ds2-acts">
          <Button icon="upload" onClick={() => fileRef.current?.click()}>
            Import design file
          </Button>
          <Button kind="main" icon="plus" onClick={() => setCreating(true)}>
            New design
          </Button>
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
      </header>

      <div className="ds2-body">
        <section className="ds2-list ds-recent" aria-labelledby="ds2-list-h">
          <h2 id="ds2-list-h" className="ds2-sr">
            Recent designs
          </h2>
          <div className="ds2-bar">
            <div className="ds2-search" role="search">
              <span className="ds2-search-icon" aria-hidden="true">
                <Icon name="search" size={16} />
              </span>
              <TextInput
                className="ds2-search-input"
                aria-label="Search designs"
                placeholder="Search designs, jobs or streets"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && <IconButton glyph="clear" label="Clear the search box" size={32} className="ds2-search-clear" onClick={() => setQuery("")} />}
            </div>
            <Chooser aria-label="Sort" className="ds2-sort" options={SORTS} value={sort} onChange={(v) => setSort(v as Sort)} />
          </div>

          {openFailed && (
            <p className="ds2-wrong" role="alert">
              That design is no longer here: it may have been deleted. Anything still saved is in the list below.
            </p>
          )}
          {importError && (
            <p className="ds2-wrong" role="alert">
              {importError}
            </p>
          )}

          {loading ? (
            <div className="ds2-rows" aria-busy="true">
              <span className="ds2-sr" role="status">
                Loading your designs
              </span>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="ds2-row ds2-row--skel" aria-hidden="true">
                  <span className="ds2-thumb ds2-skel" />
                  <span className="ds2-skel ds2-skel--line" />
                </div>
              ))}
            </div>
          ) : visible.length > 0 ? (
            <>
              <div className="ds2-row ds2-row--head" aria-hidden="true">
                <span />
                <span>Design</span>
                <span>Job</span>
                <span>Floors</span>
                <span>Systems</span>
                <span>Changed</span>
              </div>
              <ul className="ds2-rows">
                {visible.map((r) => (
                  <li key={r.id} className="ds2-item">
                    <button type="button" className="ds2-row" onClick={() => onOpen(r.id)}>
                      <Thumb refId={r.thumbRef} planImages={planImages} mode={r.mode} />
                      <Fade className="ds2-name">{r.name}</Fade>
                      {jobWord(r) ? <Fade className="ds2-job">{jobWord(r)}</Fade> : <span className="ds2-quiet">Not on a job</span>}
                      <span className="ds2-num">{r.floorCount === 1 ? "1 floor" : `${r.floorCount} floors`}</span>
                      <span className="ds2-num">{r.systemCount === 1 ? "1 system" : `${r.systemCount} systems`}</span>
                      <span className="ds2-quiet">{timeAgo(r.updatedAt)}</span>
                    </button>
                    <Button kind="quiet" size={32} className="ds2-del" aria-label={`Delete ${r.name}`} onClick={() => setDeleting(r)}>
                      Delete
                    </Button>
                  </li>
                ))}
              </ul>
              {beyond > 0 && (
                <button type="button" className="pt-link ds2-more" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Show fewer designs" : `Show ${beyond} more ${beyond === 1 ? "design" : "designs"}`}
                </button>
              )}
            </>
          ) : known.length ? (
            <Empty what="No matches" line="Nothing matches that search." action={<Button onClick={() => setQuery("")}>Clear the search</Button>} />
          ) : (
            <Empty what="No designs yet" line="New design starts one from a job's plans, or on a blank canvas." action={null} />
          )}
        </section>

        {library && (
          <aside className="ds2-rail" aria-labelledby="ds2-rail-h">
            <h2 id="ds2-rail-h" className="ds2-rail-h">
              Unit library
            </h2>
            <p className="ds2-rail-line">
              {library.brands.length === 1 ? "1 brand" : `${library.brands.length} brands`}: {library.brands.map((b) => b.name).join(", ")}.
            </p>
            <LibraryDoor library={library} />
          </aside>
        )}
      </div>

      {creating && (
        <NewDesign
          sm8Jobs={sm8Jobs}
          jobSearch={jobSearch}
          planImages={planImages}
          onBlank={onBlank}
          onPlans={onPlans}
          onClose={() => setCreating(false)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        heading={deleting ? `Delete ${deleting.name}?` : ""}
        confirm="Delete design"
        onConfirm={() => {
          if (deleting) onDelete(deleting.id);
          setDeleting(null);
        }}
        onClose={() => setDeleting(null)}
      >
        The design, its floors and its systems go for good.
      </ConfirmDialog>
    </div>
  );
}
