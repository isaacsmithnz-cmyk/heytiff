"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { fmtAud } from "@/lib/workboard/project-money";
import {
  emptyStoryLine,
  filterStory,
  fmtStoryMinutes,
  groupStoryDays,
  storySince,
  threadReplies,
  type StoryEntry,
  type StoryFilter,
} from "@/lib/workboard/job-story";
import { FaceSwitch } from "@/components/me/face-switch";
import { NoteToken } from "@/components/notes/note-token";
import { mentionedHandles } from "@/lib/workboard/sm8-mentions";
import { mintPressId } from "@/lib/workboard/press-id";
import { fillWords, NOTE_WORDS } from "@/lib/integrations/sm8-note-words";
import type { FlagState, NoteState } from "@/lib/integrations/sm8-note-plan";
import type { SendHold } from "@/lib/integrations/sm8-write-plan";
import type { NoteSender } from "@/lib/integrations/links";
import { StateLine } from "./state-line";

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
   feed says so by simply not offering.

   AND, WHERE NOTES ARE OFFERED (two-way phase 2), THE DIARY TALKS BACK. A
   ServiceM8 note that mentions you offers Reply, and the reply sits under
   it, yours, with where it stands with ServiceM8 in that state's words
   (lib/integrations/sm8-note-plan's noteState — this face never words a
   state itself). Your own entry can go to ServiceM8 too, from the pen's
   Also in ServiceM8 or its own Send to ServiceM8, and Undo (Remove, on an
   entry) takes it back whatever state it is in. A flagged note says so,
   and offers Mark done, as you. Every door on a note of ours is its
   sender's alone: the line's `acts` already say whose. Where notes aren't
   offered the doors to send are gone, and a note that already has a state
   still shows it. */

const FILTERS: { key: StoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "notes", label: "Notes" },
  { key: "photos", label: "Photos" },
  { key: "money", label: "Money" },
  { key: "visits", label: "Visits" },
];

/** Where the pen's tick box is remembered, per person, in this browser. */
const ALSO_KEY = "heytiff.diary.alsoSm8";

/** No flag has a press out. */
const NONE_BUSY: ReadonlySet<string> = new Set();

/** What notes to ServiceM8 hand the diary (two-way phase 2). */
export type DiaryNotesSm8 = { trial: boolean; hold: SendHold; owner: boolean };

type NoteEntry = Extract<StoryEntry, { kind: "note" }>;

/** The handlers a note's doors call — each is the card's, which asks the
    server and answers with what now stands. */
type Doors = {
  sender: NoteSender | null;
  notesSm8: DiaryNotesSm8 | null;
  flags: Record<string, FlagState>;
  /** Resolves with the refusal's words, or null once the reply is saved. */
  onReply?: (input: { sourceNoteUuid: string; words: string; spoken: boolean; composeId: string }) => Promise<string | null>;
  onSendCopy?: (noteId: string) => void;
  onTakeBack?: (noteId: string) => void;
  onMarkDone?: (noteUuid: string, seenEditDate: string | null) => void;
  onUndoDone?: (noteUuid: string) => void;
  /** The flags a Mark done or its Undo is out on: their doors are off. */
  flagsBusy: ReadonlySet<string>;
  /** The answer to "Is <name> you?"; `thenSend` is the row a line's Yes
      then sends. Resolves with the refusal's words, or null. */
  onConfirm?: (answer: "yes" | "no", thenSend?: string) => Promise<string | null>;
  onRemoveNote?: (id: string) => void;
};

export function JobDiaryFace({
  entries,
  loading,
  moneyVisible,
  focusFlagged = false,
  onOpenClaim,
  onPhotos,
  onWrite,
  onRemoveNote,
  sender = null,
  notesSm8 = null,
  flags,
  replyFor = null,
  onReplyShown,
  onReply,
  onSendCopy,
  onTakeBack,
  onMarkDone,
  onUndoDone,
  flagsBusy,
  onConfirm,
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
      the pen waits rather than saving somewhere it has to guess. `alsoSm8`
      is the Also in ServiceM8 tick; `composeId` is the pen's own id, so the
      same words pressed twice are one entry. Resolves once the save lands. */
  onWrite?: (body: string, alsoSm8: boolean, composeId: string) => void | Promise<unknown>;
  /** Take one of OUR notes back off. Never offered for ServiceM8's. */
  onRemoveNote?: (id: string) => void;
  /* ── notes to ServiceM8 (two-way phase 2): all absent where the
     deployment sends none, and the diary is exactly what it was ── */
  /** Who the viewer would send a note as. */
  sender?: NoteSender | null;
  /** Set only while notes are offered here. */
  notesSm8?: DiaryNotesSm8 | null;
  /** ServiceM8's flagged notes, with our marks on them, by uuid. */
  flags?: Record<string, FlagState>;
  /** Open the reply box on this note (by its ServiceM8 uuid) and bring it
      into view — the strip's Reply sends the reader here. */
  replyFor?: string | null;
  /** Told when the reader opens or closes a box here after the strip sent
      them, so the same Reply on the strip can open it again later. */
  onReplyShown?: () => void;
  onReply?: Doors["onReply"];
  onSendCopy?: Doors["onSendCopy"];
  onTakeBack?: Doors["onTakeBack"];
  onMarkDone?: Doors["onMarkDone"];
  onUndoDone?: Doors["onUndoDone"];
  /** The flags a press is out on, whose doors wait for its answer. */
  flagsBusy?: ReadonlySet<string>;
  onConfirm?: Doors["onConfirm"];
}) {
  const [filter, setFilter] = useState<StoryFilter>("all");
  const [draft, setDraft] = useState("");
  const since = storySince(entries);
  const shown = filterStory(entries, filter);
  /* REPLIES SIT UNDER WHAT THEY ANSWER, when that is drawn; otherwise in
     the day, as entries of their own — never lost */
  const { children, threaded } = useMemo(() => threadReplies(shown), [shown]);
  const days = groupStoryDays(shown.filter((e) => !threaded.has(e.key)));
  const filters = FILTERS.filter((f) => f.key !== "money" || moneyVisible);
  const doors: Doors = {
    sender,
    notesSm8,
    flags: flags ?? {},
    onReply,
    onSendCopy,
    onTakeBack,
    onMarkDone,
    onUndoDone,
    flagsBusy: flagsBusy ?? NONE_BUSY,
    onConfirm,
    onRemoveNote,
  };

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

  /* WHICH NOTE HAS ITS REPLY BOX OPEN. One at a time. The strip's Reply
     opens it on the note it named (`replyFor`), as the flag does, and
     scrolls there; the first open or close here hands the choice back to
     the diary, so the strip can ask again later. */
  const [replying, setReplying] = useState<string | null>(null);
  const replyKey = replyFor
    ? (shown.find((e) => e.kind === "note" && e.sm8Uuid === replyFor)?.key ?? null)
    : null;
  const openKey = replyKey ?? replying;
  const openReply = (key: string | null) => {
    setReplying(key);
    if (replyFor) onReplyShown?.();
  };
  const replyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (replyKey) replyRef.current?.scrollIntoView?.({ block: "center" });
  }, [replyKey]);

  const refOf = (key: string) => (key === flagKey ? flagRef : key === replyKey ? replyRef : undefined);

  const entry = (e: StoryEntry): React.ReactNode => (
    <DiaryEntry
      key={e.key}
      entry={e}
      flagged={focusFlagged && e.kind === "note" && e.actionRequired}
      entryRef={refOf(e.key)}
      onOpenClaim={onOpenClaim}
      onPhotos={onPhotos}
      doors={doors}
      replyOpen={openKey === e.key}
      onReplyOpen={(on) => openReply(on ? e.key : null)}
      thread={children.get(e.key)?.map(entry)}
    />
  );

  return (
    <div className="wb2-jcdiary">
      <div className="wb2-jcdhead">
        <b>Diary</b>
        {since && <em>{`Since ${fmtAuWeekdayDayMonth(since)}`}</em>}
      </div>

      {onWrite && (
        <Pen draft={draft} setDraft={setDraft} onWrite={onWrite} sender={sender} notesSm8={notesSm8} onConfirm={onConfirm} />
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
              {day.entries.map(entry)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ── the pen ── */

/** The pen at the diary's head. Where notes are offered it gains the Also
    in ServiceM8 tick box, remembered per person in this browser; while the
    viewer can't send yet the box is off with the reason beside it (and an
    owner gets Link people). THE PEN'S OWN ID is minted when it opens and
    again once a save lands, so the same words submitted twice before then
    are one entry — and one note, if it goes. */
function Pen({
  draft,
  setDraft,
  onWrite,
  sender,
  notesSm8,
  onConfirm,
}: {
  draft: string;
  setDraft: (v: string) => void;
  onWrite: (body: string, alsoSm8: boolean, composeId: string) => void | Promise<unknown>;
  sender: NoteSender | null;
  notesSm8: DiaryNotesSm8 | null;
  onConfirm?: Doors["onConfirm"];
}) {
  /* the card is drawn in the browser only (a portal), so storage is there
     to read at once; blocked storage starts the box unticked */
  const [also, setAlso] = useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(ALSO_KEY) === "1";
    } catch {
      return false;
    }
  });
  const tick = (on: boolean) => {
    setAlso(on);
    try {
      window.localStorage.setItem(ALSO_KEY, on ? "1" : "0");
    } catch {
      /* not remembered, still ticked */
    }
  };
  /* the id and the words it was last pressed with */
  const pen = useRef<{ id: string; words: string | null } | null>(null);

  const ready = sender?.state === "ready";
  const why = notesSm8 && sender && !ready ? senderSentence(sender) : null;
  const sending = !!notesSm8 && ready && also;

  const commit = () => {
    const words = draft.trim();
    if (!words) return;
    if (!pen.current || (pen.current.words !== null && pen.current.words !== words)) {
      pen.current = { id: mintPressId(), words: null };
    }
    pen.current.words = words;
    const id = pen.current.id;
    const landed = onWrite(draft, sending, id);
    setDraft("");
    void Promise.resolve(landed).then(() => {
      /* saved: the next words are the next note */
      if (pen.current?.id === id) pen.current = null;
    });
  };

  return (
    <>
      <NoteToken
        as="strip"
        label="a note on this job"
        value={draft}
        onChange={setDraft}
        onCommit={commit}
        placeholder="Write on the job, or say it…"
      />
      {notesSm8 && (
        <div className="wb2-evreply">
          <label className="wb2-flcheck">
            <input type="checkbox" checked={ready && also} disabled={!ready} onChange={(e) => tick(e.target.checked)} />
            {NOTE_WORDS.door.alsoInSm8}
          </label>
          {why && (
            <div className="wb2-jcattsave">
              <span className="wb2-evmeta">{why}</span>
              {sender?.state === "confirm" && onConfirm && <ConfirmDoors onConfirm={onConfirm} />}
              {notesSm8.owner && (
                <a className="wb2-evdoor" href="/dashboard/admin/integrations/servicem8">
                  {NOTE_WORDS.door.linkPeople}
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Why the viewer can't send yet, in the press sentence for it. */
function senderSentence(s: NoteSender): string | null {
  switch (s.state) {
    case "ready":
      return null;
    case "unlinked":
      return s.noCard ? NOTE_WORDS.press.noCard : NOTE_WORDS.press.unlinked;
    case "confirm":
      return fillWords(NOTE_WORDS.press.confirm, { sm8Name: s.sm8Name });
    case "denied":
      return fillWords(NOTE_WORDS.press.denied, { sm8Name: s.sm8Name });
    case "inactive":
      return fillWords(NOTE_WORDS.press.inactive, { sm8Name: s.sm8Name });
    case "bad_link":
      return NOTE_WORDS.press.badLink;
    default:
      return NOTE_WORDS.press.unknown;
  }
}

/** Yes and Not me, for "Is <name> you?". Yes never sends by itself: the
    caller decides what follows (`thenSend`). */
function ConfirmDoors({ onConfirm, thenSend }: { onConfirm: NonNullable<Doors["onConfirm"]>; thenSend?: string }) {
  const [busy, setBusy] = useState(false);
  const answer = (a: "yes" | "no") => {
    setBusy(true);
    void onConfirm(a, a === "yes" ? thenSend : undefined).finally(() => setBusy(false));
  };
  return (
    <>
      <button className="wb2-evdoor" disabled={busy} onClick={() => answer("yes")}>
        {NOTE_WORDS.door.yes}
      </button>
      <button className="wb2-evdoor" disabled={busy} onClick={() => answer("no")}>
        {NOTE_WORDS.door.notMe}
      </button>
    </>
  );
}

/* ── a reply ── */

/** The box under a note: the words, said or typed (no Tiff offer — a reply
    is a reply), and Send reply. While the viewer hasn't said who they are
    in ServiceM8, the question stands where Send reply would. A refusal
    keeps the words in the box; a save closes it. */
function ReplyBox({
  sourceNoteUuid,
  doors,
  onClose,
}: {
  sourceNoteUuid: string;
  doors: Doors;
  onClose: () => void;
}) {
  const [words, setWords] = useState("");
  const [spoken, setSpoken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* the box's own id: one reply however many presses, a new one per reply */
  const [composeId, setComposeId] = useState(mintPressId);

  const send = () => {
    if (!doors.onReply || busy) return;
    setBusy(true);
    setError(null);
    void doors
      .onReply({ sourceNoteUuid, words, spoken, composeId })
      .then((refused) => {
        if (refused) {
          setError(refused);
          return;
        }
        setWords("");
        setSpoken(false);
        setComposeId(mintPressId());
        onClose();
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="wb2-evreply">
      <NoteToken
        as="field"
        label="a reply"
        offer={false}
        rows={2}
        value={words}
        onChange={setWords}
        onSpoken={() => setSpoken(true)}
        placeholder={NOTE_WORDS.door.replyPlaceholder}
        disabled={busy}
      />
      <div className="wb2-jcattsave">
        {doors.sender?.state === "confirm" && doors.onConfirm ? (
          <>
            <span className="wb2-evmeta">{fillWords(NOTE_WORDS.press.confirm, { sm8Name: doors.sender.sm8Name })}</span>
            <ConfirmDoors onConfirm={doors.onConfirm} />
          </>
        ) : (
          <button className="wb2-evdoor" disabled={busy || !words.trim()} onClick={send}>
            {NOTE_WORDS.door.sendReply}
          </button>
        )}
        <button className="wb2-evdoor" disabled={busy} onClick={onClose}>
          {NOTE_WORDS.door.cancel}
        </button>
      </div>
      {error && (
        <div className="wb2-evmeta">
          <StateLine as="span" line={{ word: error, tone: "bad" }} />
        </div>
      )}
    </div>
  );
}

/* ── one entry ── */

function DiaryEntry({
  entry,
  flagged = false,
  entryRef,
  onOpenClaim,
  onPhotos,
  doors,
  replyOpen = false,
  onReplyOpen,
  thread,
}: {
  entry: StoryEntry;
  /** Lit because an attention row sent the reader looking for it. */
  flagged?: boolean;
  entryRef?: React.Ref<HTMLDivElement>;
  onOpenClaim: (remoteId: string) => void;
  onPhotos: () => void;
  doors: Doors;
  replyOpen?: boolean;
  onReplyOpen?: (on: boolean) => void;
  /** Our replies to this note, drawn under it. */
  thread?: React.ReactNode[];
}) {
  switch (entry.kind) {
    case "note":
      return (
        <NoteEv
          entry={entry}
          flagged={flagged}
          entryRef={entryRef}
          doors={doors}
          replyOpen={replyOpen}
          onReplyOpen={onReplyOpen}
          thread={thread}
        />
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
            {[entry.method, entry.takenBy].filter(Boolean).join(", ") || "ServiceM8"}
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

/** A flag line's tone, in the chip's own words for it. */
const CHIP_TONE: Record<string, string> = { ok: "ok", warn: "warn", bad: "dan" };

/** One note: ServiceM8's or ours, with whatever doors it offers the viewer. */
function NoteEv({
  entry,
  flagged,
  entryRef,
  doors,
  replyOpen,
  onReplyOpen,
  thread,
}: {
  entry: NoteEntry;
  flagged: boolean;
  entryRef?: React.Ref<HTMLDivElement>;
  doors: Doors;
  replyOpen: boolean;
  onReplyOpen?: (on: boolean) => void;
  thread?: React.ReactNode[];
}) {
  const ours = entry.origin === "heytiff";
  const state: NoteState | null = ours ? (entry.state ?? null) : null;
  const flag = !ours && entry.sm8Uuid ? (doors.flags[entry.sm8Uuid] ?? null) : null;
  /* a Mark done or its Undo is out on this flag: one press, one answer */
  const flagBusy = !!entry.sm8Uuid && doors.flagsBusy.has(entry.sm8Uuid);
  const { sender, notesSm8 } = doors;

  /* REPLY: only on a mention of you, never on your own note, and only when
     you can send (or be asked who you are). One of ours can be answered
     only once its copy is in ServiceM8, and never once its author took it
     back: a withdrawn row is drawn only to say it is on its way out. */
  const canAnswer = !!notesSm8 && !!sender && (sender.state === "ready" || sender.state === "confirm");
  const you = sender && "handle" in sender ? sender.handle : null;
  const mentionsYou = !!you && mentionedHandles(entry.text, [you]).length > 0;
  const replyable =
    canAnswer &&
    mentionsYou &&
    !!entry.sm8Uuid &&
    !entry.removed &&
    !!doors.onReply &&
    (ours ? !entry.mine : !(sender && "remoteId" in sender && entry.authorSm8Uuid && entry.authorSm8Uuid === sender.remoteId));

  const acts = state?.acts ?? [];
  const flagActs = flag?.acts ?? [];
  /* one of yours that never left HeyTiff, where notes are offered */
  const sendable = ours && !state && !!entry.mine && !entry.hasCreate && canAnswer && !!doors.onSendCopy;
  const remove = ours && entry.id && doors.onRemoveNote && (
    <button
      className="wb2-evdoor"
      onClick={() => doors.onRemoveNote!(entry.id!)}
      title="Take this note back off the job"
    >
      Remove
    </button>
  );

  return (
    <Ev icon="edit" flag={flagged} innerRef={entryRef}>
      <div className="wb2-evhd">
        Note
        {flag ? (
          <i className={"wb2-chip" + (flag.tone ? ` ${CHIP_TONE[flag.tone]}` : "")}>{flag.text}</i>
        ) : (
          entry.actionRequired && <i className="wb2-chip warn">Action required</i>
        )}
        {entry.fromClaim && <i className="wb2-chip cat">{`#${entry.fromClaim}`}</i>}
        {/* NAMED, NOT BADGED, and only on ours: "in HeyTiff" answers the
            one question the merge raises — why this note is not in
            ServiceM8 — and every other entry in the feed is theirs, so
            labelling those would be a badge on the whole diary. Once one of
            ours has a state, its line says where it is instead. */}
        {ours && !state && <i className="wb2-chip blue">In HeyTiff</i>}
      </div>
      {entry.author && <div className="wb2-evmeta">{entry.author}</div>}
      <div className="wb2-evcard">{withMentions(entry.text)}</div>
      {state?.text && (
        <div className="wb2-evmeta">
          <StateLine as="span" line={{ word: state.text, tone: state.tone }} />
        </div>
      )}

      {/* ── ours with a state: the sender's doors, from its line ── */}
      {ours && entry.id && state && acts.length > 0 && (
        <div className="wb2-jcattsave">
          {acts.includes("confirm") && sender?.state === "confirm" && doors.onConfirm && (
            <>
              <span className="wb2-evmeta">{fillWords(NOTE_WORDS.press.confirm, { sm8Name: sender.sm8Name })}</span>
              <ConfirmDoors onConfirm={doors.onConfirm} thenSend={entry.id} />
            </>
          )}
          {/* the question was answered since (here, or on another note):
              the row can simply go again */}
          {(acts.includes("send_again") || (acts.includes("confirm") && sender?.state === "ready")) && doors.onSendCopy && (
            <button className="wb2-evdoor" onClick={() => doors.onSendCopy!(entry.id!)}>
              {NOTE_WORDS.door.sendAgain}
            </button>
          )}
          {acts.includes("take_out_again") && doors.onTakeBack && (
            <button className="wb2-evdoor" onClick={() => doors.onTakeBack!(entry.id!)}>
              {NOTE_WORDS.door.tryAgain}
            </button>
          )}
          {acts.includes("undo") && doors.onTakeBack && (
            <button className="wb2-evdoor" onClick={() => doors.onTakeBack!(entry.id!)}>
              {entry.replyTo ? NOTE_WORDS.door.undo : NOTE_WORDS.door.remove}
            </button>
          )}
        </div>
      )}

      {/* ── ours with no state: HeyTiff's only. Remove, as ever; and its
          author may send it where notes are offered, once ── */}
      {ours && entry.id && !state && sendable && (
        <div className="wb2-jcattsave">
          <button className="wb2-evdoor" onClick={() => doors.onSendCopy!(entry.id!)}>
            {NOTE_WORDS.door.sendToSm8}
          </button>
          {remove}
        </div>
      )}
      {ours && entry.id && !state && !sendable && remove}

      {/* ── ServiceM8's flag: Mark done as you, or your own mark's Undo ── */}
      {!ours && entry.sm8Uuid && flagActs.length > 0 && (
        <div className="wb2-jcattsave">
          {notesSm8 && doors.onMarkDone && (flagActs.includes("mark_done") || flagActs.includes("mark_done_again")) && (
            <button
              className="wb2-evdoor"
              disabled={flagBusy}
              onClick={() => doors.onMarkDone!(entry.sm8Uuid!, entry.editedAt ?? null)}
            >
              {flagActs.includes("mark_done_again") ? NOTE_WORDS.door.markDoneAgain : NOTE_WORDS.door.markDone}
            </button>
          )}
          {flagActs.includes("unmark") && doors.onUndoDone && (
            <button className="wb2-evdoor" disabled={flagBusy} onClick={() => doors.onUndoDone!(entry.sm8Uuid!)}>
              {NOTE_WORDS.door.undo}
            </button>
          )}
        </div>
      )}

      {replyable && !replyOpen && (
        <button className="wb2-evdoor" onClick={() => onReplyOpen?.(true)}>
          {NOTE_WORDS.door.reply}
        </button>
      )}
      {replyable && replyOpen && (
        <ReplyBox sourceNoteUuid={entry.sm8Uuid!} doors={doors} onClose={() => onReplyOpen?.(false)} />
      )}

      {thread && thread.length > 0 && <div className="wb2-evthread">{thread}</div>}
    </Ev>
  );
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
    resolve; here it only needs to read as a callout.

    AN "@" INSIDE A WORD IS AN ADDRESS, NOT A MENTION. The diary records the
    documents emailed from the job ("… to josh@lsdb.com.au"), and a split on
    every "@" drew "@lsdb" as a callout in the middle of it — the same
    tolerance lib/workboard/sm8-mentions already gives an email address. */
export function withMentions(text: string): React.ReactNode {
  const parts = text.split(/((?<![\w.+-])@[a-z0-9_]+)/gi);
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
