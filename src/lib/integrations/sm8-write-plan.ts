/* Writing to ServiceM8 — the decisions, pure.

   sm8-sync-plan's sibling for the other direction. Everything here is a
   function of its arguments, so the rules that decide what a write BECOMES
   are pinned in a test with no network and no database. sm8-write.ts makes
   the request; sm8-writes.ts is the plumbing that carries these out.

   THE SHAPE OF A WRITE, whatever its kind (docs/migrations/sm8_writes.sql):
   - it is a ROW before it is a request, carrying the uuid ServiceM8 will
     know it by, chosen up front, so a retry names the same record and can't
     make a second copy;
   - one sender at a time holds it, by a lease on the row, and a sender that
     dies mid-request leaves the lease to lapse rather than the write to be
     lost;
   - what came back decides what it becomes: sent, tried again later, or
     stopped with a sentence somebody can act on. Those decisions are this
     file.

   THE SENTENCES ARE OURS. ServiceM8's response body goes to the server log,
   truncated, and never to a screen: the same rule the read side keeps
   (sm8-read.ts). */

/* ── the owner's switch ── */

export type Sm8WriteMode = "off" | "trial" | "live";

/** The switch as stored. Anything unreadable is off: a write path must fail
    closed. */
export function readWriteMode(v: unknown): Sm8WriteMode {
  return v === "trial" || v === "live" ? v : "off";
}

/** Where writing stands for one workspace, as the sender and the card both
    need it. Built from the connection row and the deployment's switch. */
export type Sm8WriteState = {
  /** SM8_WRITES is on for this deployment: the operator's switch, above
      every owner's. Off on a preview, so a branch can never write to a
      business's ServiceM8. */
  deployment: boolean;
  mode: Sm8WriteMode;
  /** The grant works (not needs_reauth). */
  connected: boolean;
  /** The ServiceM8 account connected now — what every write is checked
      against before it goes. */
  tenantId: string | null;
  /** The grant carries every write scope. */
  granted: boolean;
};

const WHERE = "An owner can change that in Integrations, ServiceM8.";

/** Why a press of Send to ServiceM8 can't be taken, in words — or null when
    it can. The order is the order of the fixes: nothing an owner does helps
    a deployment that can't write, and a switch that is off outranks a
    permission nobody has been asked for. */
export function sendRefusal(s: Sm8WriteState): string | null {
  if (!s.deployment) return "Sending to ServiceM8 isn't available yet.";
  if (!s.tenantId) return "ServiceM8 isn't connected.";
  if (s.mode === "off") return `Sending to ServiceM8 is switched off. ${WHERE}`;
  if (!s.connected) return `ServiceM8 needs reconnecting. ${WHERE}`;
  if (s.mode === "live" && !s.granted) {
    return `ServiceM8 hasn't given HeyTiff permission to add files yet. ${WHERE}`;
  }
  return null;
}

/** Whether the card offers Send to ServiceM8 at all. Only where an owner
    has switched it on: a button that could only ever explain itself is
    furniture. A switched-on workspace whose grant has lapsed keeps the
    button, and the press says what's wrong. */
export function offersSend(s: Sm8WriteState): boolean {
  return s.deployment && !!s.tenantId && s.mode !== "off";
}

/* ── the row ── */

export type Sm8WriteKind = "attachment";

export type Sm8WriteStatus = "queued" | "sending" | "sent" | "failed" | "trial" | "cancelled";

const STATUSES: readonly Sm8WriteStatus[] = ["queued", "sending", "sent", "failed", "trial", "cancelled"];

export function readWriteStatus(v: unknown): Sm8WriteStatus {
  return STATUSES.includes(v as Sm8WriteStatus) ? (v as Sm8WriteStatus) : "failed";
}

/** The subject a file is written under — the caller's own name for what it
    wrote, unique per job (see the migration). */
export const documentSubject = (documentId: string) => `document:${documentId}`;

export function subjectDocumentId(subject: string): string | null {
  const m = /^document:(.+)$/.exec(subject);
  return m ? m[1] : null;
}

/* ── how much, how often ── */

/** Writes one run sends. ServiceM8 allows 180 requests a minute; this keeps
    one run well inside it even with a sync walking beside it. */
export const WRITE_BATCH = 10;

/** How long a claimed row is held while its request is in flight. Longer
    than the request's own timeout, so a live send never has its row taken
    from under it. */
export const WRITE_LEASE_MS = 120_000;

/** How long after each failed attempt a row waits before the next. The first
    retry is quick (a blip), the last is half a day (an outage). */
export const WRITE_RETRY_AFTER_MS: readonly number[] = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  12 * 3_600_000,
];

/** Attempts before a row stops trying by itself and waits for a person. */
export const WRITE_MAX_ATTEMPTS = WRITE_RETRY_AFTER_MS.length + 1;

/** How far into its claim a refused send may still try again, once its
    token has been renewed. The second try is another upload (60 s at most)
    and perhaps a read-back (10 s), and all of it must end inside
    WRITE_LEASE_MS, or a second sender could take the row mid-request. Past
    this the row goes back in the queue, untouched, for the next run. */
export const WRITE_RETRY_CUTOFF_MS = 40_000;

/** Waits for a reason that isn't the row's (a busy or unpaid account). */
const RATE_LIMIT_WAIT_MS = 60_000;
const BILLING_WAIT_MS = 12 * 3_600_000;
/** After a token renewal that couldn't reach ServiceM8. */
const RENEW_WAIT_MS = 60_000;

/* ── the sentences ── */

export const WRITE_WORDS = {
  reauth: "ServiceM8 needs reconnecting before anything more can go.",
  forbidden: "ServiceM8 hasn't given HeyTiff permission to add files.",
  billing: "ServiceM8 isn't accepting anything for this account until its plan or invoice is sorted.",
  slowDown: "ServiceM8 asked HeyTiff to slow down. Trying again in a minute.",
  unreachable: "ServiceM8 couldn't be reached. Trying again shortly.",
  gaveUp: "ServiceM8 couldn't be reached, after several tries.",
  noJob: "ServiceM8 couldn't find the job.",
  tooBig: "ServiceM8 said the file is too big.",
  refused: "ServiceM8 refused the file.",
  notThere: "ServiceM8 said it already had this, then couldn't show it.",
  fileGone: "The file isn't in HeyTiff any more.",
  unreadable: "HeyTiff couldn't read the file. Trying again shortly.",
  unreadableGaveUp: "HeyTiff couldn't read the file, after several tries.",
  otherAccount: "This was for a different ServiceM8 account from the one connected now.",
  accountUnknown: "HeyTiff couldn't confirm which ServiceM8 account is connected. Trying again shortly.",
  switchedOff: "Sending to ServiceM8 was switched off before it went.",
  disconnected: "ServiceM8 was disconnected before it went.",
} as const;

/* ── what came back ── */

/** One request's answer, as the decision it forces. The sentences come
    later, from `verdictFor`: the same 403 means one thing to a row and
    another to the run. */
export type Sm8WriteOutcome =
  | { kind: "created"; remoteUuid: string | null }
  /** 409 on our own uuid: an earlier attempt landed. Confirmed by a read
      before it counts, because a conflict that ISN'T ours must not be
      recorded as sent. */
  | { kind: "exists" }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "payment_required" }
  | { kind: "rate_limited" }
  /** This request will never succeed as it is. */
  | { kind: "rejected"; status: number }
  /** Didn't answer, or answered with its own trouble. */
  | { kind: "unavailable"; status: number | null };

export function classifyWrite(status: number, recordUuid: string | null): Sm8WriteOutcome {
  if (status >= 200 && status < 300) return { kind: "created", remoteUuid: recordUuid };
  if (status === 409) return { kind: "exists" };
  if (status === 401) return { kind: "unauthorized" };
  if (status === 402) return { kind: "payment_required" };
  if (status === 403) return { kind: "forbidden" };
  if (status === 429) return { kind: "rate_limited" };
  // a request that timed out on their side can be asked again
  if (status === 408) return { kind: "unavailable", status };
  if (status >= 400 && status < 500) return { kind: "rejected", status };
  return { kind: "unavailable", status };
}

export type WriteVerdict = {
  status: "sent" | "queued" | "failed";
  error: string | null;
  /** When a queued row may go again, counted from now. */
  retryAfterMs: number | null;
  /** The attempt wasn't the row's doing, so it doesn't count towards
      giving up: a dead grant or a busy account says nothing about the file. */
  refund: boolean;
  /** End the run here. The next row would get the same answer, and asking
      again would spend somebody's rate limit to be told twice. */
  stop: boolean;
  /** ServiceM8 refused the token. The sender renews it once and tries again
      (sm8-renew.ts); only a second refusal flags the connection for
      reconnecting, the way a 401 on a read does. */
  reauth: boolean;
};

const verdict = (v: Partial<WriteVerdict> & Pick<WriteVerdict, "status">): WriteVerdict => ({
  error: null,
  retryAfterMs: null,
  refund: false,
  stop: false,
  reauth: false,
  ...v,
});

/** The wait before the next try, after `attempts` tries. */
const retryAfter = (attempts: number): number =>
  WRITE_RETRY_AFTER_MS[Math.min(Math.max(0, attempts - 1), WRITE_RETRY_AFTER_MS.length - 1)];

/** What a row becomes when the file couldn't be read HERE — the bucket, not
    ServiceM8. Ours to retry, with the same patience, and the run goes on:
    the next row's file may read fine. */
export function verdictForUnreadable(attempts: number): WriteVerdict {
  if (attempts >= WRITE_MAX_ATTEMPTS) return verdict({ status: "failed", error: WRITE_WORDS.unreadableGaveUp });
  return verdict({ status: "queued", error: WRITE_WORDS.unreadable, retryAfterMs: retryAfter(attempts) });
}

/** A refused send whose token couldn't be renewed because ServiceM8 couldn't
    be reached. Not the file's doing and not a dead grant: it waits a minute,
    the attempt is handed back, and the run stops, because the next row would
    need the same renewal. */
export function verdictForRenewUnreachable(): WriteVerdict {
  return verdict({
    status: "queued",
    error: WRITE_WORDS.unreachable,
    retryAfterMs: RENEW_WAIT_MS,
    refund: true,
    stop: true,
  });
}

/** A token whose connection doesn't say which ServiceM8 account it is for —
    a nameless reconnect landed mid-run. The account is unknown, not known to
    be wrong, so the file isn't cancelled: it waits, its attempt handed back,
    until a sync has named the connection. The run stops, because every
    later row would go out on the same token. */
export function verdictForAccountUnknown(): WriteVerdict {
  return verdict({
    status: "queued",
    error: WRITE_WORDS.accountUnknown,
    retryAfterMs: RENEW_WAIT_MS,
    refund: true,
    stop: true,
  });
}

/** A send that found the connection gone mid-run. It waits in the queue; the
    next run, finding no connection, cancels it with these words. */
export function verdictForDisconnected(): WriteVerdict {
  return verdict({ status: "queued", error: WRITE_WORDS.disconnected, refund: true, stop: true });
}

/** A send refused with a token that has since been renewed, too late in its
    claim to try again (WRITE_RETRY_CUTOFF_MS). Nothing went wrong with the
    file or the grant: it goes back to the queue as it was, due at once, and
    the run carries on with the renewed token. */
export function verdictForRenewLate(): WriteVerdict {
  return verdict({ status: "queued", retryAfterMs: 0, refund: true });
}

/** What a row becomes after one attempt. `attempts` counts this one. */
export function verdictFor(outcome: Sm8WriteOutcome, attempts: number): WriteVerdict {
  switch (outcome.kind) {
    case "created":
    case "exists":
      return verdict({ status: "sent" });
    case "unauthorized":
      /* waits for a reconnect, then goes: nothing about the file was wrong */
      return verdict({ status: "queued", error: WRITE_WORDS.reauth, refund: true, stop: true, reauth: true });
    case "payment_required":
      return verdict({
        status: "queued",
        error: WRITE_WORDS.billing,
        retryAfterMs: BILLING_WAIT_MS,
        refund: true,
        stop: true,
      });
    case "rate_limited":
      return verdict({
        status: "queued",
        error: WRITE_WORDS.slowDown,
        retryAfterMs: RATE_LIMIT_WAIT_MS,
        refund: true,
        stop: true,
      });
    case "forbidden":
      /* The grant holds the scope by our records and ServiceM8 still said
         no: a scope name they have changed, or a permission taken away on
         their side. A person has to look, so the row stops, and so does the
         run — the next file would be refused the same way. */
      return verdict({ status: "failed", error: WRITE_WORDS.forbidden, stop: true });
    case "rejected":
      return verdict({
        status: "failed",
        error:
          outcome.status === 404
            ? WRITE_WORDS.noJob
            : outcome.status === 413
              ? WRITE_WORDS.tooBig
              : outcome.status === 409
                ? WRITE_WORDS.notThere
                : WRITE_WORDS.refused,
      });
    case "unavailable":
      if (attempts >= WRITE_MAX_ATTEMPTS) return verdict({ status: "failed", error: WRITE_WORDS.gaveUp, stop: true });
      return verdict({
        status: "queued",
        error: WRITE_WORDS.unreachable,
        retryAfterMs: retryAfter(attempts),
        stop: true,
      });
  }
}

/* ── the name it goes under ── */

/** ServiceM8 caps nothing we know of, but a name is read in a list. */
const NAME_MAX = 120;

/** The name a file goes to ServiceM8 under: the name it has here, extension
    on, the way ServiceM8's own uploads are named (689 of the 760 uploaded
    PDFs on the live account carry theirs). ServiceM8 reads the file's type
    off that extension, which is why it must be there. */
export function sm8FileName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim() || "Document";
  if (clean.length <= NAME_MAX) return clean;
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 && clean.length - dot <= 6 ? clean.slice(dot) : "";
  return `${clean.slice(0, NAME_MAX - ext.length).trimEnd()}${ext}`;
}

/* ── what the job card says ── */

/** One file's write, as the card holds it. */
export type JobSend = {
  documentId: string;
  status: Sm8WriteStatus;
  error: string | null;
  attempts: number;
  remoteUuid: string;
};

export type SendLine = { word: string; tone: "ok" | "warn" | "bad" | null };

/** What one of OUR rows says about ServiceM8, over the files it holds — a
    certificate is one file, a licence may be a front and a back. Null when
    there is nothing to say: never sent, a trial run, or cancelled, all of
    which leave the file as sendable as it was.

    A failure outranks everything: it is the one line somebody has to act on.
    A retry pending is said in the warning colour, because a file that went
    nowhere for an hour is worth noticing; a first send in flight isn't. "In
    ServiceM8" only when EVERY file the row holds went, so a paper whose
    renewal came in since says nothing until the renewal is sent too. */
export function sendLine(sends: readonly JobSend[], documentIds: readonly string[]): SendLine | null {
  if (documentIds.length === 0) return null;
  const mine = documentIds
    .map((id) => sends.find((s) => s.documentId === id))
    .filter((s): s is JobSend => !!s);
  if (mine.length === 0) return null;

  const failed = mine.find((s) => s.status === "failed");
  if (failed) return { word: `Not sent to ServiceM8. ${failed.error ?? WRITE_WORDS.refused}`, tone: "bad" };

  const waiting = mine.filter((s) => s.status === "queued" || s.status === "sending");
  if (waiting.length > 0) {
    const retrying = waiting.some((s) => s.status === "queued" && s.attempts > 0);
    return retrying
      ? { word: "Not in ServiceM8 yet. Trying again shortly.", tone: "warn" }
      : { word: "Sending to ServiceM8…", tone: null };
  }

  if (mine.length === documentIds.length && mine.every((s) => s.status === "sent")) {
    return { word: "In ServiceM8", tone: "ok" };
  }
  return null;
}

/** Whether a file may be sent again: never sent, or sent and it came to
    nothing. A file in ServiceM8, or on its way, is not sent twice. */
export function sendable(send: JobSend | undefined): boolean {
  return !send || send.status === "failed" || send.status === "cancelled" || send.status === "trial";
}

/** THE TWIN. Once a file we sent is in ServiceM8, the next sync mirrors it
    back as one of ServiceM8's own, and the Documents face would list it
    twice: ours, saying "In ServiceM8", and theirs. This is the set of
    ServiceM8 uuids to leave off — but only for files one of our rows is
    SHOWING. Take the upload off the job, or move a paper to its renewal,
    and the copy in ServiceM8 is no longer ours on the card, so it appears
    as theirs: which is what it now is. */
export function twinsToHide(sends: readonly JobSend[], shownDocumentIds: Iterable<string>): Set<string> {
  const shown = new Set(shownDocumentIds);
  const out = new Set<string>();
  for (const s of sends) if (s.status === "sent" && shown.has(s.documentId)) out.add(s.remoteUuid);
  return out;
}

/* ── what the owner's log says ── */

/** One write in the ServiceM8 screen's list, in the state colour. */
export function logWord(status: Sm8WriteStatus, attempts: number): SendLine {
  switch (status) {
    case "sent":
      return { word: "Sent", tone: "ok" };
    case "trial":
      return { word: "Trial run, not sent", tone: null };
    case "failed":
      return { word: "Not sent", tone: "bad" };
    case "cancelled":
      return { word: "Cancelled", tone: null };
    case "sending":
      return { word: "Sending", tone: null };
    case "queued":
      return attempts > 0 ? { word: "Trying again", tone: "warn" } : { word: "Waiting to send", tone: null };
  }
}

/* ── what a press of Send to ServiceM8 says ── */

/** Two names, or a count once a list stops being read. */
function named(names: readonly string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.length} documents`;
}

const isAre = (names: readonly string[]) => (names.length === 1 ? "is" : "are");

export type SendOutcome = {
  trial: boolean;
  sent: readonly string[];
  waiting: readonly string[];
  already: readonly string[];
};

/** The card's toast after a press, by what became of each tick. Null when
    there is nothing to report but failures, which the footer says instead.
    Success is noun and verb ("Public liability sent to ServiceM8"); a trial
    run says plainly that nothing went. */
export function sendToast(r: SendOutcome, nameOf: (key: string) => string): string | null {
  const sent = r.sent.map(nameOf);
  const waiting = r.waiting.map(nameOf);
  const already = r.already.map(nameOf);
  if (r.trial && sent.length > 0) return `Trial run: ${named(sent)} would have gone to ServiceM8. Nothing was sent`;
  const parts: string[] = [];
  if (!r.trial && sent.length > 0) parts.push(`${named(sent)} sent to ServiceM8`);
  if (waiting.length > 0) {
    parts.push(
      sent.length > 0 ? `${named(waiting)} will follow` : `${named(waiting)} will go to ServiceM8 once it answers`
    );
  }
  if (parts.length === 0 && already.length > 0) parts.push(`${named(already)} ${isAre(already)} already in ServiceM8`);
  return parts.length > 0 ? parts.join(". ") : null;
}

/** The footer's line for what didn't go: the first, with its reason, and a
    count of the rest. Their ticks stay, so pressing again tries them again. */
export function sendFailure(
  failed: readonly { key: string; error: string }[],
  nameOf: (key: string) => string
): string | null {
  if (failed.length === 0) return null;
  const rest = failed.length - 1;
  const more = rest === 0 ? "" : rest === 1 ? " 1 more didn't go either." : ` ${rest} more didn't go either.`;
  return `${nameOf(failed[0].key)} wasn't sent. ${failed[0].error}${more}`;
}
