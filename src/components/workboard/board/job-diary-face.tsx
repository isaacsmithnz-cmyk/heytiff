"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { fmtAud } from "@/lib/workboard/project-money";
import {
  emptyStoryLine,
  filterStory,
  fmtStoryMinutes,
  groupStoryDays,
  storySince,
  type StoryEntry,
  type StoryFilter,
} from "@/lib/workboard/job-story";
import { FaceSwitch } from "@/components/me/face-switch";
import { NoteToken } from "@/components/notes/note-token";

/* THE DIARY — the whole story on its own tab, newest first, day-marked.

   Everything here was already fetched; the merge in job-story.ts only
   rearranged it. Money events say WHAT happened and are DOORS — a settled
   or raised claim opens the claim modal from #556 — and never repeat the
   ledger: the feed narrates, the block totals, the modal itemises.

   FILTERABLE, with a FaceSwitch INSIDE the face — the one place the house
   allows a second switch, because a card-edge strip cannot nest. The Money
   option exists only for a reader whose feed can hold money at all; for
   anyone else the server never sent those events and the filter would be a
   button to an empty room.

   THE PEN IS HERE (slice 5). The job is a capture scope now, so the token
   at the feed's head writes on THIS job: press the + and the words are a
   diary entry immediately — no round trip to wait on, because a diary you
   have to wait for is a form. The token's own sniff then decides whether
   what you wrote smells like work and offers to sort it out; that path is
   Tiff's review card, unchanged, and nothing is created until you say so.

   OUR NOTES AND SERVICEM8'S SIT IN ONE STREAM. They are the same act — a
   person wrote on this job — and only the entry's `origin` says which
   system holds the row. Ours can be taken back off; theirs cannot, and the
   feed says so by simply not offering. */

const FILTERS: { key: StoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "notes", label: "Notes" },
  { key: "photos", label: "Photos" },
  { key: "money", label: "Money" },
  { key: "visits", label: "Visits" },
];

export function JobDiaryFace({
  entries,
  loading,
  moneyVisible,
  focusFlagged = false,
  onOpenClaim,
  onPhotos,
  onWrite,
  onRemoveNote,
}: {
  entries: StoryEntry[];
  /** True while the detail read is still out — the feed can't say "empty"
      before it has looked. */
  loading: boolean;
  moneyVisible: boolean;
  /** Set when an attention row sent the reader here: the flagged notes light
      up and the newest scrolls into view. The strip says what the note SAID;
      the diary is where the rest of it is, and landing on the feed's head
      with no idea which note was meant is the version that wastes the trip. */
  focusFlagged?: boolean;
  onOpenClaim: (remoteId: string) => void;
  /** The "+N" on a photo cluster lands on the Photos tab. */
  onPhotos: () => void;
  /** Write a note on the job. Absent until the card knows which job it is —
      the pen waits rather than saving somewhere it has to guess. */
  onWrite?: (body: string) => void;
  /** Take one of OUR notes back off. Never offered for ServiceM8's. */
  onRemoveNote?: (id: string) => void;
}) {
  const [filter, setFilter] = useState<StoryFilter>("all");
  const [draft, setDraft] = useState("");
  const since = storySince(entries);
  const shown = filterStory(entries, filter);
  const days = groupStoryDays(shown);
  const filters = FILTERS.filter((f) => f.key !== "money" || moneyVisible);

  /* The newest flagged note in what is currently SHOWN — the key, not an
     index, because a filter change reshuffles the list underneath it. */
  const flagKey = focusFlagged
    ? (shown.find((e) => e.kind === "note" && e.actionRequired)?.key ?? null)
    : null;
  const flagRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    /* Optional-called: jsdom has no scrollIntoView, and a test that renders
       this face must not die of a missing browser method. */
    if (flagKey) flagRef.current?.scrollIntoView?.({ block: "center" });
  }, [flagKey]);

  return (
    <div className="wb2-jcdiary">
      <div className="wb2-jcdhead">
        <b>Diary</b>
        {since && <em>{`Since ${fmtAuWeekdayDayMonth(since)}`}</em>}
      </div>

      {onWrite && (
        <NoteToken
          as="strip"
          label="a note on this job"
          value={draft}
          onChange={setDraft}
          onCommit={() => {
            onWrite(draft);
            setDraft("");
          }}
          placeholder="Write on the job, or say it…"
        />
      )}

      {entries.length > 0 && (
        <FaceSwitch
          items={filters.map((f) => ({ key: f.key, label: f.label }))}
          active={filter}
          onGo={(k) => setFilter(k as StoryFilter)}
          ariaLabel="Diary filter"
          idPrefix="jcdf"
          panelPrefix="jcdfp"
        />
      )}

      <div id={`jcdfp-${filter}`} role="tabpanel" aria-labelledby={`jcdf-${filter}`}>
        {loading && entries.length === 0 ? (
          <p className="int-hint">Reading it from the mirror…</p>
        ) : entries.length === 0 ? (
          <p className="int-hint">{emptyStoryLine(moneyVisible)}</p>
        ) : shown.length === 0 ? (
          <p className="int-hint">Nothing of that kind in the diary.</p>
        ) : (
          days.map((day) => (
            <div key={day.day}>
              <div className="wb2-jcday">{fmtAuWeekdayDayMonth(day.day)}</div>
              {day.entries.map((e) => (
                <DiaryEntry
                  key={e.key}
                  entry={e}
                  flagged={focusFlagged && e.kind === "note" && e.actionRequired}
                  entryRef={e.key === flagKey ? flagRef : undefined}
                  onOpenClaim={onOpenClaim}
                  onPhotos={onPhotos}
                  onRemoveNote={onRemoveNote}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DiaryEntry({
  entry,
  flagged = false,
  entryRef,
  onOpenClaim,
  onPhotos,
  onRemoveNote,
}: {
  entry: StoryEntry;
  /** Lit because an attention row sent the reader looking for it. */
  flagged?: boolean;
  entryRef?: React.Ref<HTMLDivElement>;
  onOpenClaim: (remoteId: string) => void;
  onPhotos: () => void;
  onRemoveNote?: (id: string) => void;
}) {
  switch (entry.kind) {
    case "note":
      return (
        <Ev icon="edit" flag={flagged} innerRef={entryRef}>
          <div className="wb2-evhd">
            Note
            {entry.actionRequired && <i className="wb2-chip warn">Action required</i>}
            {entry.fromClaim && <i className="wb2-chip cat">{`#${entry.fromClaim}`}</i>}
            {/* NAMED, NOT BADGED, and only on ours: "in HeyTiff" answers the
                one question the merge raises — why this note is not in
                ServiceM8 — and every other entry in the feed is theirs, so
                labelling those would be a badge on the whole diary. */}
            {entry.origin === "heytiff" && <i className="wb2-chip blue">In HeyTiff</i>}
          </div>
          {entry.author && <div className="wb2-evmeta">{entry.author}</div>}
          <div className="wb2-evcard">{withMentions(entry.text)}</div>
          {entry.origin === "heytiff" && entry.id && onRemoveNote && (
            <button
              className="wb2-evdoor"
              onClick={() => onRemoveNote(entry.id!)}
              title="Take this note back off the job"
            >
              Remove
            </button>
          )}
        </Ev>
      );
    case "visit":
      return (
        <Ev icon="clock" tone="cy">
          <div className="wb2-evhd">{`Site visit — ${fmtStoryMinutes(entry.minutes)}`}</div>
          <div className="wb2-evmeta">{entry.crew.join(", ") || "Nobody named"}</div>
        </Ev>
      );
    case "photos":
      return (
        <Ev icon="cam">
          <div className="wb2-evhd">
            {entry.count === 1 ? "1 photo" : `${entry.count} photos`}
          </div>
          <div className="wb2-evphotos">
            {entry.shown.map((p) =>
              p.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={p.remoteId} src={p.url} alt={p.name} loading="lazy" />
              ) : (
                <span key={p.remoteId} className="pending" title={p.name}>
                  <Icon name="cam" size={13} />
                </span>
              )
            )}
            {entry.count > entry.shown.length && (
              <button
                className="more"
                onClick={onPhotos}
                title="Open the Photos tab"
              >{`+${entry.count - entry.shown.length}`}</button>
            )}
          </div>
        </Ev>
      );
    case "claim": {
      const amount = entry.amountCents !== null ? fmtAud(entry.amountCents) : null;
      return (
        <Ev icon={entry.event === "settled" ? "dollar" : "receipt"} tone={entry.event === "settled" ? "ok" : "cy"}>
          <div className="wb2-evhd">
            {`${entry.title} ${entry.event}`}
            {amount && (
              <>
                {" — "}
                <span className={entry.event === "settled" ? "wb2-evamt" : undefined}>{amount}</span>
              </>
            )}
          </div>
          <button className="wb2-evdoor" onClick={() => onOpenClaim(entry.remoteId)}>
            {entry.jobNumber ? `Invoice #${entry.jobNumber} — open it` : "Open the invoice"}
            <Icon name="chevR" size={13} />
          </button>
        </Ev>
      );
    }
    case "payment":
      return (
        <Ev icon="dollar" tone="ok">
          <div className="wb2-evhd">
            {entry.isDeposit ? "Deposit received" : "Payment received"}
            {entry.amountCents !== null && (
              <>
                {" — "}
                <span className="wb2-evamt">{fmtAud(entry.amountCents)}</span>
              </>
            )}
          </div>
          <div className="wb2-evmeta">
            {[entry.method, entry.takenBy].filter(Boolean).join(" · ") || "ServiceM8"}
          </div>
        </Ev>
      );
    case "tick":
      return (
        <Ev icon="check" tone="ok">
          <div className="wb2-evhd">{`Checked off — ${entry.name}`}</div>
          {entry.by && <div className="wb2-evmeta">{entry.by}</div>}
        </Ev>
      );
    case "design":
      return (
        <Ev icon="layers">
          <div className="wb2-evhd">{`Studio design — ${entry.name}`}</div>
          <div className="wb2-evmeta">edited</div>
        </Ev>
      );
    case "push":
      return (
        <Ev icon="listCheck">
          <div className="wb2-evhd">
            {`${entry.count} material ${entry.count === 1 ? "line" : "lines"} pushed from the Studio`}
          </div>
        </Ev>
      );
    case "milestone":
      return (
        <Ev icon={MILESTONE_ICON[entry.label]} tone={entry.label === "Job completed" ? "ok" : undefined}>
          <div className="wb2-evhd">{entry.label}</div>
        </Ev>
      );
  }
}

const MILESTONE_ICON: Record<string, string> = {
  "Job raised": "plus",
  "Quote sent": "file",
  "Became a work order": "wrench",
  "Job completed": "check",
  "Invoice raised": "receipt",
};

/** One entry's frame: the dot on the day's thread, then whatever it says.
    No clock on the rows — the day marker carries the when, and the entries
    inside a day already stand in clock order. */
function Ev({
  icon,
  tone,
  flag = false,
  innerRef,
  children,
}: {
  icon: string;
  tone?: "ok" | "cy";
  flag?: boolean;
  innerRef?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}) {
  return (
    <div className={"wb2-ev" + (flag ? " flag" : "")} ref={innerRef}>
      <span className={"wb2-evdot" + (tone ? ` ${tone}` : "")} aria-hidden>
        <Icon name={icon} size={12} />
      </span>
      <div className="wb2-evb">{children}</div>
    </div>
  );
}

/** ServiceM8 @mentions, worn the way the diary mock wears them — the handle
    is lower(first+last), so the string itself is the join key slice 5 will
    resolve; here it only needs to read as a callout. */
export function withMentions(text: string): React.ReactNode {
  const parts = text.split(/(@[a-z0-9_]+)/gi);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    /^@[a-z0-9_]+$/i.test(part) ? (
      <span key={i} className="wb2-mention">
        {part}
      </span>
    ) : (
      part
    )
  );
}
