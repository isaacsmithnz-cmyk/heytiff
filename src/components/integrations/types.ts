import type { ConnectionView } from "@/lib/integrations/connection";
import type { ScopeEntry } from "@/lib/integrations/providers";
import type { Sm8SyncStatusView } from "@/lib/integrations/sm8-sync";
import type { RecentSm8Write } from "@/lib/integrations/sm8-writes";
import type { SendHold, Sm8PausedReason, Sm8WriteKind, Sm8WriteMode } from "@/lib/integrations/sm8-write-plan";
import type { PersonRow } from "@/lib/integrations/people-import";

/* What Settings › Integrations is handed, app by app: the loaders
   ((settings)/integrations/load.ts) build these, the groups draw them. Types
   only, so the loaders import no client code. */

/** The outcome of an OAuth round trip that just finished, as a sentence
    from a fixed table (lib/integrations/outcome), never the URL's own text. */
export type Notice = { kind: "ok" | "error"; text: string } | null;

/* One live vendor.json read, resolved server-side on page load: proof the
   grant READS, plus the account identity. `null` means the read wasn't
   attempted (not connected, or ServiceM8 isn't set up here). */
export type Sm8Reach =
  | { ok: true; account: { name: string; timezoneName: string | null } }
  | { ok: false; error: string };

/* What the Xero grant can actually SEE: the answer to a real call, so a
   connection that looks healthy but can't read anything says so. `null`
   means the read wasn't attempted. */
export type XeroReach = { ok: true; employees: number } | { ok: false; error: string };

/** The people review: a provider's people against this workspace's cards. */
export type PeopleCardData = {
  rows: PersonRow[];
  /** Active cards with no link of this kind yet: the manual picker's options. */
  linkable: { staffProfileId: string; name: string }[];
  /** The read failed: the sentence to show instead of rows. */
  error: string | null;
};

/** Sending to ServiceM8. Null on a deployment that can't write
    (SM8_WRITES unset): nothing is drawn there, because a setting that can't
    be set is a roadmap. */
export type Sm8WritesView = {
  mode: Sm8WriteMode;
  /** Who paused it, while paused. */
  pausedReason: Sm8PausedReason | null;
  /** What is holding the files waiting to go, as the list says it. */
  hold: SendHold;
  /** The kinds whose permission the grant holds. */
  granted: Sm8WriteKind[];
  /** The kinds ServiceM8 refused for permission since the last connect. */
  refused: Sm8WriteKind[];
  /** Sent in the last 30 days; null when it couldn't be counted. */
  sentLately: number | null;
  /** Waiting to go. */
  waiting: number;
  /** Files that didn't go and wait for a person. */
  failed: number;
  recent: RecentSm8Write[];
  /** What one ServiceM8 account may take in an hour before sending pauses. */
  hourlyCap: number;
  /** The kinds this deployment sends (SM8_WRITES). With files alone there is
      one switch, Off, Paused or On; with more than one kind the owner
      switches each. Absent: files alone. */
  kinds?: Sm8WriteKind[];
  /** The kinds the owner has switched on. */
  ownerKinds?: Sm8WriteKind[];
  /** What holds each kind's waiting writes (the list says it per row). */
  holds?: Partial<Record<Sm8WriteKind, SendHold>>;
  /** Quotes on their own trial run, however the connection is set. */
  quotesTrial?: boolean;
};

export type Servicem8Props = {
  connection: ConnectionView | null;
  /** SM8_CLIENT_ID / SECRET / APP_BASE_URL are all present on this deployment. */
  configured: boolean;
  /** INTEGRATIONS_TOKEN_KEY is present: without it tokens are never stored. */
  sealed: boolean;
  notice: Notice;
  /** Result of one live read; null when there was nothing to read through. */
  reach?: Sm8Reach | null;
  /** Per-object mirror progress; null until connected. */
  sync?: Sm8SyncStatusView | null;
  /** The people review's data; null until connected. */
  people?: PeopleCardData | null;
  /** Other HeyTiff workspaces holding this same ServiceM8 account. */
  elsewhere?: number;
  writes?: Sm8WritesView | null;
  /** The write permissions the consent asks for beside the reads: the kinds
      the deployment allows that the owner has on. Absent: files alone. */
  writeScopes?: ScopeEntry[];
  /** What a disconnect would cancel, kind by kind, where the deployment
      sends that kind. */
  waitingWrites?: number;
  waitingNotes?: number;
  waitingBookings?: number;
  waitingLeave?: number;
  waitingJobs?: number;
  waitingCustomers?: number;
  waitingQuotes?: number;
  /** The account this workspace was connected to before the current one,
      and when it was replaced; null when it never changed. */
  previousAccount?: { name: string | null; at: string } | null;
  /** Live updates from ServiceM8, when they aren't working: the one line
      that says so (sm8-hook-words). Absent while they work. */
  liveUpdates?: string | null;
};

export type XeroProps = {
  connection: ConnectionView | null;
  /** XERO_CLIENT_ID / SECRET / APP_BASE_URL are all present on this deployment. */
  configured: boolean;
  /** INTEGRATIONS_TOKEN_KEY is present. */
  sealed: boolean;
  notice: Notice;
  reach?: XeroReach | null;
  people?: PeopleCardData | null;
  /** Other HeyTiff workspaces holding this same Xero organisation. */
  elsewhere?: number;
};
