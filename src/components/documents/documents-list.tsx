"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { Button, IconButton } from "@/components/parts/button";
import { Chooser, type ChooserOption } from "@/components/parts/chooser";
import { Empty } from "@/components/parts/states";
import { Fade } from "@/components/parts/fade";
import { TextInput } from "@/components/parts/field";
import { Initials } from "@/components/parts/initials";
import { Dot, StateWord } from "@/components/parts/state";
import { ViewTabs } from "@/components/parts/tabs";
import { MakeDocument } from "./make-document";
import type { DocumentsData } from "@/lib/documents/made-query";
import {
  ANYONE,
  DOC_SORTS,
  KIND_LABEL,
  dayWord,
  peopleOf,
  rowsFor,
  sortRows,
  viewsFor,
  withDocsState,
  type DocKind,
  type DocRow,
  type DocSort,
  type DocView,
  type DocsState,
} from "@/lib/documents/made";

/* DOCUMENTS (v2, step 5; the board 5-documents). The title with what's
   been made beside it, the search and Make a document on the right; the
   kinds as soft tabs (rule 29) with By and Sort beside them; then the
   table, a row per document (rule 39). Templates live in Settings, not
   here (Isaac, 20 October: "The templates probably shouldn't be in there").

   All shows each kind as a group, its newest few with Show all; a kind's
   own view is the whole of it. A row opens the document where today's
   screens open it: a SWMS on its sign-on, a letter in its editor, a
   certificate and a handover sheet as paper in a tab of their own.

   The state is the address (`?view=`, `?by=`, `?sort=`, `?q=`), written
   with replaceState as it changes, as Jobs does. */

const PANEL = "dc2-panel";
/** How many of a kind All shows before Show all. */
const GROUP_CAP = 3;

const KIND_ICON: Record<DocKind, string> = { swms: "shield", certificate: "check", letter: "mail", handover: "listCheck" };

function DocLine({ row, today }: { row: DocRow; today: string }) {
  const body = (
    <>
      <span className="dc2-cell dc2-doc">
        <span className="dc2-ic" aria-hidden="true">
          <Icon name={KIND_ICON[row.kind]} size={16} />
        </span>
        <Fade className="dc2-name">{row.name}</Fade>
      </span>
      <span className="dc2-cell dc2-job">
        {row.job ? (
          <>
            {row.job.hue && <Dot hue={row.job.hue} />}
            <Fade>{row.job.label}</Fade>
          </>
        ) : (
          <span className="dc2-quiet">No job</span>
        )}
      </span>
      <span className="dc2-cell dc2-state">
        <StateWord tone={row.tone}>
          <Fade lines={2}>{row.state}</Fade>
        </StateWord>
      </span>
      <span className="dc2-cell dc2-day">{dayWord(row.day, today)}</span>
      <span className="dc2-cell dc2-by">{row.by && <Initials name={row.by} size={24} />}</span>
    </>
  );
  return (
    <li>
      {row.newTab ? (
        <a className="dc2-row" href={row.href} target="_blank" rel="noreferrer">
          {body}
        </a>
      ) : (
        <Link className="dc2-row" href={row.href}>
          {body}
        </Link>
      )}
    </li>
  );
}

function Rows({ rows, today, label }: { rows: readonly DocRow[]; today: string; label: string }) {
  return (
    <ul className="dc2-rows" aria-label={label}>
      {rows.map((r) => (
        <DocLine key={r.key} row={r} today={today} />
      ))}
    </ul>
  );
}

/** What an empty view says (rule 40): what's missing, and the way on. */
function Nothing({ state, inView, go, canWriteLetters }: { state: DocsState; inView: number; go: (next: Partial<DocsState>) => void; canWriteLetters: boolean }) {
  if (inView > 0 && state.q)
    return (
      <Empty
        what={`No documents here match "${state.q}"`}
        action={
          <Button kind="second" onClick={() => go({ q: "" })}>
            Clear the search
          </Button>
        }
      />
    );
  if (inView > 0)
    return (
      <Empty
        what="Nothing here for this person"
        action={
          <Button kind="second" onClick={() => go({ by: ANYONE })}>
            Show everyone&apos;s documents
          </Button>
        }
      />
    );
  const words: Record<DocView, { what: string; line?: string }> = {
    all: { what: "No documents yet", line: "Make one with Make a document." },
    swms: { what: "No SWMS yet", line: "A SWMS is made on its job, with Make a document or the job's Add." },
    certificate: { what: "No certificates yet", line: "A certificate is made on its job, with Make a document or the job's Add." },
    letter: { what: "No letters yet", line: canWriteLetters ? "Write one with Make a document." : undefined },
    handover: { what: "No handover sheets yet", line: "Each project prints one. Make a job a project from the projects." },
  };
  const w = words[state.view];
  return <Empty what={w.what} line={w.line} action={null} />;
}

export function DocumentsList({ data, initial }: { data: DocumentsData; initial: DocsState }) {
  const [state, setState] = useState<DocsState>(initial);

  const go = (next: Partial<DocsState>) => {
    const s = { ...state, ...next };
    setState(s);
    if (typeof window !== "undefined") window.history.replaceState(null, "", withDocsState(window.location.href, s));
  };

  const views = viewsFor(data.kinds);
  const shown = sortRows(rowsFor(data.rows, state), state.sort);
  const inView = rowsFor(data.rows, { view: state.view, by: ANYONE, q: "" }).length;
  const viewLabel = views.find((v) => v.key === state.view)?.label ?? "All";

  const byOptions: ChooserOption[] = [{ value: ANYONE, label: "Anyone" }, ...peopleOf(data.rows)];
  if (!byOptions.some((o) => o.value === state.by)) byOptions.push({ value: state.by, label: state.by });
  const sortOptions: ChooserOption[] = DOC_SORTS.map((s) => ({ value: s.key, label: s.label }));

  return (
    <div className="dc2">
      <header className="dc2-head">
        <div className="dc2-title">
          <h1>Documents</h1>
        </div>
        <div className="dc2-tools">
          <div className="dc2-search" role="search">
            <span className="dc2-search-icon" aria-hidden="true">
              <Icon name="search" size={16} />
            </span>
            <TextInput
              className="dc2-search-input"
              aria-label="Search documents"
              placeholder="Search documents"
              value={state.q}
              onChange={(e) => go({ q: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Escape" && state.q) go({ q: "" });
              }}
            />
            {state.q && <IconButton glyph="clear" label="Clear the search box" size={32} className="dc2-search-clear" onClick={() => go({ q: "" })} />}
          </div>
          <MakeDocument canWriteLetters={data.canWriteLetters} />
        </div>
      </header>

      <div className="dc2-bar">
        <ViewTabs
          ariaLabel="Kinds of document"
          idPrefix="dc2-view"
          panelPrefix={PANEL}
          current={state.view}
          onGo={(key) => go({ view: key as DocView })}
          items={views.map((v) => ({ key: v.key, label: v.label }))}
        />
        <div className="dc2-picks">
          <div className="dc2-pick">
            <span className="dc2-pick-word" aria-hidden="true">
              By
            </span>
            <Chooser aria-label="By" className="dc2-pick-ch" options={byOptions} value={state.by} onChange={(v) => go({ by: v })} />
          </div>
          <div className="dc2-pick">
            <span className="dc2-pick-word" aria-hidden="true">
              Sort
            </span>
            <Chooser aria-label="Sort" className="dc2-pick-ch dc2-pick-ch--sort" options={sortOptions} value={state.sort} onChange={(v) => go({ sort: v as DocSort })} />
          </div>
        </div>
      </div>

      <div className="dc2-body">
        <div role="tabpanel" id={`${PANEL}-${state.view}`} aria-labelledby={`dc2-view-${state.view}`} className="dc2-panel">
          {shown.length === 0 ? (
            <Nothing state={state} inView={inView} go={go} canWriteLetters={data.canWriteLetters} />
          ) : (
            <div className="dc2-table">
              <div className="dc2-row dc2-row--head" aria-hidden="true">
                <span className="dc2-cell">Document</span>
                <span className="dc2-cell">Job</span>
                <span className="dc2-cell">Where it&apos;s up to</span>
                <span className="dc2-cell">Updated</span>
                <span className="dc2-cell">By</span>
              </div>
              {state.view === "all" ? (
                data.kinds.map((k) => {
                  const of = shown.filter((r) => r.kind === k);
                  if (of.length === 0) return null;
                  return (
                    <section key={k} className="dc2-group" aria-labelledby={`dc2-group-${k}`}>
                      <div className="dc2-group-head">
                        <h2 id={`dc2-group-${k}`} className="dc2-group-h">
                          {KIND_LABEL[k]}
                        </h2>
                        {of.length > GROUP_CAP && (
                          <button type="button" className="dc2-showall" onClick={() => go({ view: k })}>
                            Show all {of.length}
                          </button>
                        )}
                      </div>
                      <Rows rows={of.slice(0, GROUP_CAP)} today={data.today} label={`${KIND_LABEL[k]}, newest ${Math.min(of.length, GROUP_CAP)}`} />
                    </section>
                  );
                })
              ) : (
                <Rows rows={shown} today={data.today} label={`${viewLabel}, ${shown.length} ${shown.length === 1 ? "document" : "documents"}`} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
