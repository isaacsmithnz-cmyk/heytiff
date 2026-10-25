import { render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { ToastProvider } from "@/components/parts/toast";
import { Servicem8Group } from "../servicem8-group";
import { toView as toViewOf, type ConnectionRow } from "@/lib/integrations/connection";
import { SM8_SCOPE_LIST, SM8_WRITE_SCOPES } from "@/lib/integrations/providers";
import { sm8ObjectPhase, SM8_PAUSE_MIDWALK } from "@/lib/integrations/sm8-sync-plan";
import type { Sm8ObjectStatus, Sm8SyncStatusView } from "@/lib/integrations/sm8-sync";
import type { Sm8WritesView } from "../types";

/* Settings › Integrations, the ServiceM8 group (v2, 25 October 2026). Its
   guards are STRICTER than Xero's for one reason: disconnecting here deletes
   a whole mirror of somebody's client book, where Xero's drops credentials
   only.

   Both halves come from a real accident (2026-08-10): a live business account
   was connected instead of a dev one, because OAuth authorises whichever
   account the BROWSER is signed into and never asks — and the success notice
   named nothing, so the wrong account looked exactly like the right one. */

const disconnect = jest.fn();
const syncNow = jest.fn();
const setWriteMode = jest.fn();
const setWriteKind = jest.fn();
const setQuotes = jest.fn();
const retryFailed = jest.fn();
const refresh = jest.fn();

jest.mock("@/app/actions/integrations", () => ({
  disconnectServiceM8Action: (...args: unknown[]) => disconnect(...args),
  syncServiceM8NowAction: (...args: unknown[]) => syncNow(...args),
  setServiceM8WriteModeAction: (...args: unknown[]) => setWriteMode(...args),
  setServiceM8WriteKindAction: (...args: unknown[]) => setWriteKind(...args),
  setServiceM8QuotesAction: (...args: unknown[]) => setQuotes(...args),
  retryFailedServiceM8WritesAction: (...args: unknown[]) => retryFailed(...args),
}));
jest.mock("@/app/actions/staff-import", () => ({}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));

/* The view as the store builds it on a deployment that sends files: the
   write kinds that count are files alone (store.ts hands them in). */
const toView = (r: ConnectionRow, name: string | null = null) => toViewOf(r, name, ["attachment"]);

const ACCOUNT = "Diamond Air Solutions Pty LTD";
const START = "/api/integrations/servicem8/connect";

const row = (over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  id: "c1",
  org_id: "org1",
  provider: "servicem8",
  status: "connected",
  tenant_id: "v1",
  tenant_name: ACCOUNT,
  tenants: [{ tenantId: "v1", tenantName: ACCOUNT }],
  scopes: SM8_SCOPE_LIST.join(" "),
  access_token_enc: "v1.a.b.c",
  refresh_token_enc: "v1.d.e.f",
  expires_at: null,
  connected_by_user_id: "auth0|isaac",
  connected_at: "2026-08-10T10:25:00.000Z",
  updated_at: null,
  last_error: null,
  ...over,
});

const ready = { configured: true, sealed: true, notice: null } as const;

const show = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
type Props = Parameters<typeof Servicem8Group>[0];
const group = (props: Partial<Props> = {}) => show(<Servicem8Group connection={toView(row())} {...ready} {...props} />);

/** The connection's row: its name, its line and its state word. */
const connectionRow = () => screen.getAllByText(ACCOUNT)[0].closest(".st2-set") as HTMLElement;
const lineOf = (el: HTMLElement) => el.querySelector(".st2-sets")?.textContent ?? "";
const dialog = () => screen.getByRole("dialog");
const openDisconnect = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Disconnect ServiceM8" }));
const confirmButton = () => within(dialog()).getByRole("button", { name: /^Disconnect/ }) as HTMLButtonElement;

beforeEach(() => {
  disconnect.mockReset().mockResolvedValue({ ok: true });
  syncNow.mockReset().mockResolvedValue({ ok: true, note: "Synced 12 changes across 16 objects." });
  setWriteMode.mockReset().mockResolvedValue({ ok: true });
  setWriteKind.mockReset().mockResolvedValue({ ok: true });
  setQuotes.mockReset().mockResolvedValue({ ok: true });
  retryFailed.mockReset().mockResolvedValue({ ok: true, note: "2 files will go again." });
  refresh.mockReset();
});

describe("before connecting", () => {
  it("warns which account consent will use, before anything leaves for ServiceM8", async () => {
    const user = userEvent.setup();
    group({ connection: null });
    expect(screen.queryByText(/whichever ServiceM8 account/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Connect ServiceM8" }));
    expect(within(dialog()).getByText(/whichever ServiceM8 account this browser is already signed in to/i)).toBeInTheDocument();
    expect(within(dialog()).getByText(/won't ask you to choose/i)).toHaveTextContent("signed in to. ServiceM8 won't ask you to choose.");
    // and how to avoid it, not just that it happens
    expect(within(dialog()).getByText(/private window/i)).toBeInTheDocument();
    // the way on is a plain link to the route, the second, deliberate press
    expect(within(dialog()).getByRole("link", { name: "Continue to ServiceM8" })).toHaveAttribute("href", START);
  });

  it("has nothing to disconnect and nothing to sync", () => {
    group({ connection: null });
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Disconnect/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync now" })).not.toBeInTheDocument();
  });

  it("shows every permission it will ask for, open, as the preview of the consent screen", () => {
    group({ connection: null });
    for (const scope of SM8_SCOPE_LIST) expect(screen.getByText(scope)).toBeInTheDocument();
    // nothing is granted or not granted before there is a grant
    expect(screen.queryByText("Granted")).not.toBeInTheDocument();
    expect(screen.queryByText("Not granted yet")).not.toBeInTheDocument();
  });
});

/* A customer supplies NO ServiceM8 credentials — one HeyTiff-owned app
   serves every workspace — so this state reads as ours to finish. (The
   env-var line is dev-only; NODE_ENV is "test" here.) */
describe("a deployment that isn't set up", () => {
  it("tells the owner there's nothing for them to do, and offers no Connect", () => {
    group({ connection: null, configured: false, sealed: false });
    expect(screen.getByText(/Nothing for you to set up/)).toHaveTextContent(/^ServiceM8 connections aren't switched on here yet\./);
    expect(screen.queryByRole("button", { name: "Connect ServiceM8" })).not.toBeInTheDocument();
    expect(screen.getByText(/SM8_CLIENT_ID/)).toBeInTheDocument();
    expect(screen.getByText(/INTEGRATIONS_TOKEN_KEY/)).toBeInTheDocument();
  });

  it("names only the piece that is missing", () => {
    group({ connection: null, configured: true, sealed: false });
    expect(screen.queryByText(/SM8_CLIENT_ID/)).not.toBeInTheDocument();
    expect(screen.getByText(/INTEGRATIONS_TOKEN_KEY/)).toBeInTheDocument();
  });
});

describe("the round trip's outcome", () => {
  it("names what was connected", () => {
    group({ notice: { kind: "ok", text: `Connected to ${ACCOUNT}.` } });
    expect(screen.getByText(`Connected to ${ACCOUNT}.`).closest("p")).toHaveClass("st2-int-said--good");
  });

  it("says what went wrong in red", () => {
    group({ connection: null, notice: { kind: "error", text: "You cancelled the ServiceM8 connection, so nothing changed." } });
    expect(screen.getByRole("alert")).toHaveTextContent("You cancelled the ServiceM8 connection, so nothing changed.");
  });
});

describe("reconnect names the account", () => {
  /* 2026-09-28: the warning stood open under the controls all the time. It
     opens at the moment it is for — after Reconnect, before anything leaves
     for ServiceM8 — and the way on is a second, deliberate press. */
  it("opens on Reconnect, says what this workspace is connected to now, and backs out", async () => {
    const user = userEvent.setup();
    group();
    expect(screen.queryByText(/whichever ServiceM8 account this browser/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Continue to/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reconnect ServiceM8" }));
    expect(within(dialog()).getByText(/whichever ServiceM8 account this browser/i)).toBeInTheDocument();
    expect(within(dialog()).getByText(/currently connected to/i)).toHaveTextContent(ACCOUNT);
    expect(within(dialog()).getByRole("link", { name: "Continue to ServiceM8" })).toHaveAttribute("href", START);

    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("disconnect — the only control here that deletes", () => {
  it("spells out that the mirror goes too, and that a reconnect rebuilds it", async () => {
    const user = userEvent.setup();
    group();
    await openDisconnect(user);
    expect(within(dialog()).getByText(/Every mirrored row goes with them/i)).toBeInTheDocument();
    expect(within(dialog()).getByText(/rebuilds the mirror/i)).toBeInTheDocument();
    // ServiceM8 has no revoke endpoint — the one step we can't do for them
    expect(within(dialog()).getByText(/add-ons/i)).toBeInTheDocument();
  });

  it("refuses until the account name is typed", async () => {
    const user = userEvent.setup();
    group();
    await openDisconnect(user);
    expect(confirmButton().disabled).toBe(true);
    await user.click(confirmButton());
    expect(disconnect).not.toHaveBeenCalled();

    await user.type(within(dialog()).getByRole("textbox", { name: `Type ${ACCOUNT} to confirm` }), ACCOUNT);
    expect(confirmButton().disabled).toBe(false);
    await user.click(confirmButton());
    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
  });

  it("refuses a name that is merely close", async () => {
    const user = userEvent.setup();
    group();
    await openDisconnect(user);
    await user.type(within(dialog()).getByRole("textbox"), "Diamond Air");
    expect(confirmButton().disabled).toBe(true);
  });

  it("accepts the name in any case, with tidy spacing — it's a read-this check, not a typing test", async () => {
    const user = userEvent.setup();
    group();
    await openDisconnect(user);
    await user.type(within(dialog()).getByRole("textbox"), "  diamond air solutions pty ltd ");
    expect(confirmButton().disabled).toBe(false);
  });

  it("lets you back out, and clears what was typed", async () => {
    const user = userEvent.setup();
    group();
    await openDisconnect(user);
    await user.type(within(dialog()).getByRole("textbox"), ACCOUNT);
    await user.click(within(dialog()).getByRole("button", { name: "Keep it" }));
    expect(disconnect).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // reopening must not arrive pre-armed from the last attempt
    await openDisconnect(user);
    expect((within(dialog()).getByRole("textbox") as HTMLInputElement).value).toBe("");
    expect(confirmButton().disabled).toBe(true);
  });

  it("says how many files still waiting to go it would cancel", async () => {
    const user = userEvent.setup();
    group({ waitingWrites: 2 });
    await openDisconnect(user);
    expect(within(dialog()).getByText("2 files still waiting to go to ServiceM8 are cancelled.")).toBeInTheDocument();
  });

  it("says it in a connection that needs reconnecting too — Disconnect is offered there", async () => {
    const user = userEvent.setup();
    group({ connection: toView(row({ status: "needs_reauth" })), waitingWrites: 1 });
    await openDisconnect(user);
    expect(within(dialog()).getByText("1 file still waiting to go to ServiceM8 is cancelled.")).toBeInTheDocument();
  });

  it("leaves the line out when nothing is waiting", async () => {
    const user = userEvent.setup();
    group({ waitingWrites: 0 });
    await openDisconnect(user);
    expect(within(dialog()).queryByText(/still waiting to go to ServiceM8/)).not.toBeInTheDocument();
  });

  it("surfaces a refused disconnect in the dialog rather than claiming success", async () => {
    disconnect.mockResolvedValue({ ok: false, error: "Only an owner can change connected apps." });
    const user = userEvent.setup();
    group();
    await openDisconnect(user);
    await user.type(within(dialog()).getByRole("textbox"), ACCOUNT);
    await user.click(confirmButton());
    expect(await within(dialog()).findByText("Only an owner can change connected apps.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("closes on success, says what it cancelled, and reloads", async () => {
    disconnect.mockResolvedValue({ ok: true, note: "Disconnected here. To fully revoke access, also remove HeyTiff from your ServiceM8 account's add-ons." });
    const user = userEvent.setup();
    group();
    await openDisconnect(user);
    await user.type(within(dialog()).getByRole("textbox"), ACCOUNT);
    await user.click(confirmButton());
    expect(await screen.findByText(/^Disconnected here\./)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });
});

/* A reconnect to a different account cleared the old one's copy, so the
   line is the one place left that says which business it was. */
describe("the account this one replaced", () => {
  it("names it and the day it went, in AU time", () => {
    group({ previousAccount: { name: "Acme Air", at: "2026-09-24T01:00:00.000Z" } });
    expect(lineOf(connectionRow())).toMatch(/It replaced Acme Air on Thu 24 Sept? 2026\./);
  });

  it("an old account whose name was never read", () => {
    group({ previousAccount: { name: null, at: "2026-09-24T01:00:00.000Z" } });
    expect(lineOf(connectionRow())).toMatch(/It replaced another ServiceM8 account on/);
  });

  it("says nothing when the account never changed, and says who connected it", () => {
    group({ connection: toView(row(), "Isaac Smith") });
    expect(lineOf(connectionRow())).not.toMatch(/replaced/);
    expect(lineOf(connectionRow())).toMatch(/^Connected Mon 10 Aug 2026 by Isaac Smith\./);
  });
});

/* Shared accounts are legitimate and invisible — every uniqueness rule in the
   integrations area is scoped to ONE workspace. This line says so. It
   informs; it never blocks. */
describe("this account is connected elsewhere", () => {
  it("says how many other workspaces hold it, and what that means", () => {
    group({ elsewhere: 2 });
    const said = screen.getByText(/2 other HeyTiff workspaces/);
    expect(said).toHaveTextContent(/mirrors its own copy/i);
    expect(said).toHaveTextContent(/disconnecting here doesn't affect theirs/i);
    expect(said).toHaveTextContent(/remove HeyTiff's access from inside ServiceM8/i);
  });

  it("says workspace, singular, for one", () => {
    group({ elsewhere: 1 });
    expect(screen.getByText(/1 other HeyTiff workspace\./)).toBeInTheDocument();
  });

  it("stays silent for the ordinary case, and never blocks", () => {
    const { unmount } = group({ elsewhere: 0 });
    expect(screen.queryByText(/other HeyTiff workspace/)).not.toBeInTheDocument();
    unmount();
    group({ elsewhere: 3 });
    expect(screen.getByRole("button", { name: "Reconnect ServiceM8" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect ServiceM8" })).toBeInTheDocument();
  });
});

/* ── what has been read ──

   THE BUG THIS LOCKS SHUT: a first sync of a real account is days of runs,
   and between them an object carries `last_error: "Paused mid-walk"`. It
   once rendered in the warning colour with no count, so the object doing
   the most work looked broken. Each test asserts the DISTINCTION. */

const objectStatus = (over: Partial<Sm8ObjectStatus> & Pick<Sm8ObjectStatus, "object" | "label">): Sm8ObjectStatus => {
  const backfillDone = over.backfillDone ?? false;
  const rowsPulled = over.rowsPulled ?? 0;
  const lastError = over.lastError ?? null;
  return {
    rowsPulled,
    backfillDone,
    lastSyncedAt: null,
    lastError,
    // Through the real classifier, so a test can't disagree with the engine.
    phase: sm8ObjectPhase({ backfillDone, rowsPulled, lastError }),
    ...over,
  };
};

/** Prod on 2026-08-13: objects done, attachments mid-walk at 24,996. */
const syncView = (objects: Sm8ObjectStatus[]): Sm8SyncStatusView => ({
  objects,
  lastRun: { startedAt: "2026-08-13T12:28:00.000Z", finishedAt: "2026-08-13T12:28:47.000Z", ok: true, note: null, running: false },
});

const JOBS_DONE = objectStatus({ object: "jobs", label: "Jobs", backfillDone: true, rowsPulled: 6978 });
const ATTACHMENTS_READING = objectStatus({ object: "attachments", label: "Attachments", rowsPulled: 24996, lastError: SM8_PAUSE_MIDWALK });
const BLOCKED = objectStatus({ object: "attachments", label: "Attachments", lastError: "Reconnect ServiceM8 to grant read_attachments." });

const mirrorRow = () => screen.getByText(/records, \d+ kinds?$|^Nothing read yet$/).closest(".st2-set") as HTMLElement;
const showEach = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(within(mirrorRow()).getByRole("button", { name: "Show each" }));
/** A kind of record's state, in the opened list. */
const stateOf = (label: string) => within(screen.getByText(label, { selector: ".st2-sett" }).closest(".st2-set") as HTMLElement);

describe("what has been read, mid-backfill", () => {
  it("counts every record read, across every kind", () => {
    group({ sync: syncView([JOBS_DONE, ATTACHMENTS_READING]) });
    expect(screen.getByText("31,974 records, 2 kinds")).toBeInTheDocument();
  });

  it("says a first sync is still running, names what it is reading, and that it resumes by itself", () => {
    group({ sync: syncView([JOBS_DONE, ATTACHMENTS_READING]) });
    expect(lineOf(mirrorRow())).toBe(
      "Still reading Attachments across, 24,996 rows so far. Each sync picks up where the last one stopped."
    );
  });

  it("shows the rows already read, without the warning colour, and never the engine's pause sentence", async () => {
    const user = userEvent.setup();
    group({ sync: syncView([JOBS_DONE, ATTACHMENTS_READING]) });
    await showEach(user);
    const word = stateOf("Attachments").getByText(/^Reading, 24,996 so far$/).closest(".pt-state")!;
    expect(word).toHaveClass("pt-state--good", "st2-int-live");
    expect(screen.queryByText(SM8_PAUSE_MIDWALK)).not.toBeInTheDocument();
  });

  it("names two objects when two are reading, and counts the rest", () => {
    const also = (object: string, label: string) => objectStatus({ object, label, rowsPulled: 10, lastError: SM8_PAUSE_MIDWALK });
    group({ sync: syncView([ATTACHMENTS_READING, also("jobs", "Jobs"), also("job_activities", "Schedule")]) });
    expect(lineOf(mirrorRow())).toMatch(/Attachments, Jobs and 1 more/);
  });
});

describe("what has been read, the other three states", () => {
  it("keeps the needs-a-look colour for a fault a human must fix, and says it on the row", async () => {
    const user = userEvent.setup();
    group({ sync: syncView([BLOCKED]) });
    // a fault IS the sentence — the one place the note belongs
    expect(lineOf(mirrorRow())).toBe("Attachments: Reconnect ServiceM8 to grant read_attachments.");
    await showEach(user);
    expect(stateOf("Attachments").getByText("Reconnect ServiceM8 to grant read_attachments.").closest(".pt-state")).toHaveClass("pt-state--look");
  });

  it("lets a fault outrank rows already read, so a stalled object can't hide", async () => {
    const user = userEvent.setup();
    group({ sync: syncView([{ ...BLOCKED, rowsPulled: 24996, phase: sm8ObjectPhase({ backfillDone: false, rowsPulled: 24996, lastError: BLOCKED.lastError }) }]) });
    await showEach(user);
    expect(stateOf("Attachments").getByText(/Reconnect ServiceM8/).closest(".pt-state")).toHaveClass("pt-state--look");
  });

  it("counts a finished object plainly, with no state word", async () => {
    const user = userEvent.setup();
    group({ sync: syncView([JOBS_DONE]) });
    expect(lineOf(mirrorRow())).toBe("");
    await showEach(user);
    expect(stateOf("Jobs").getByText("6,978")).toHaveClass("st2-int-count");
    expect(stateOf("Jobs").queryByText(/Reading|queued/)).not.toBeInTheDocument();
  });

  it("calls an untouched object queued, in grey — nothing is wrong with it yet", async () => {
    const user = userEvent.setup();
    group({ sync: syncView([objectStatus({ object: "queues", label: "Queues" })]) });
    expect(screen.getByText("Nothing read yet")).toBeInTheDocument();
    expect(lineOf(mirrorRow())).toBe("Waiting for the first sync.");
    await showEach(user);
    expect(stateOf("Queues").getByText("First sync queued").closest(".pt-state")).toHaveClass("pt-state--info");
  });
});

/* THE BUG THAT BLANKED THE WHOLE SCREEN ON PROD (2026-09-01). The relative
   time reads Date.now(); the server and the browser wrote different minutes
   into the same node, React #418, and the page came up EMPTY. */
describe("the connection's clock", () => {
  const SERVER = (
    <ToastProvider>
      <Servicem8Group connection={toView(row())} {...ready} sync={syncView([JOBS_DONE])} />
    </ToastProvider>
  );

  it("emits NO relative time on the server — the whole reason it is split", () => {
    /* renderToString is the only place this is observable: useHydrated is
       true on a plain client render, so RTL alone would prove nothing */
    const html = renderToString(SERVER);
    expect(html).toContain("Last synced");
    expect(html).not.toMatch(/\b(just now|min ago|hours? ago|over a day ago)\b/i);
  });

  it("fills the freshness in once there is a browser to own it", async () => {
    group({ sync: syncView([JOBS_DONE]) });
    await waitFor(() => expect(lineOf(connectionRow())).toMatch(/Last synced (just now|\d+ min ago|\d+ hours? ago|over a day ago)\./i));
  });

  it("leaves a running sync to the state word, the same on the server", () => {
    const running = syncView([JOBS_DONE]);
    const sync = { ...running, lastRun: { ...running.lastRun!, running: true } };
    const html = renderToString(
      <ToastProvider>
        <Servicem8Group connection={toView(row())} {...ready} sync={sync} />
      </ToastProvider>
    );
    expect(html).toContain("Syncing now");
    expect(html).not.toContain("Last synced");
  });

  it("says why the last sync didn't finish, and only then", () => {
    const failed = syncView([JOBS_DONE]);
    group({ sync: { ...failed, lastRun: { ...failed.lastRun!, ok: false, note: "ServiceM8 couldn't be reached — resuming next sync." } } });
    expect(lineOf(connectionRow())).toMatch(/ServiceM8 couldn't be reached/);
  });
});

/* THE OVERNIGHT RUN, SEEN. It does nothing until CRON_SECRET is set, and
   nothing said whether it ever ran. An AU day and time, no clock read. */
describe("the overnight sync", () => {
  it("says when it last came, on the AU clock", () => {
    // 20:04 UTC on Thursday 24 September is 6:04 am on Friday in Sydney
    group({ sync: { ...syncView([JOBS_DONE]), lastCron: "2026-09-24T20:04:00Z" } });
    expect(lineOf(connectionRow())).toMatch(/Last overnight sync Fri 25 Sept, 6:04 am\.$/);
  });

  it("says plainly when it never has", () => {
    group({ sync: { ...syncView([JOBS_DONE]), lastCron: null } });
    expect(lineOf(connectionRow())).toMatch(/The overnight sync hasn't run\.$/);
  });

  it("says nothing either way when it couldn't be read", () => {
    group({ sync: syncView([JOBS_DONE]) });
    expect(lineOf(connectionRow())).not.toMatch(/overnight/i);
  });

  it("writes the same words on the server as in the browser", () => {
    const sync = { ...syncView([JOBS_DONE]), lastCron: "2026-09-24T20:04:00Z" };
    const html = renderToString(
      <ToastProvider>
        <Servicem8Group connection={toView(row())} {...ready} sync={sync} />
      </ToastProvider>
    );
    expect(html).toContain("Last overnight sync Fri 25 Sept, 6:04 am.");
  });
});

describe("Sync now", () => {
  it("sits on the group's head once there is a mirror, runs, says what it did, and reloads", async () => {
    const user = userEvent.setup();
    group({ sync: syncView([JOBS_DONE]) });
    await user.click(screen.getByRole("button", { name: "Sync now" }));
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Synced 12 changes across 16 objects.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("says why it didn't run, under the connection", async () => {
    syncNow.mockResolvedValue({ ok: false, error: "A sync is already running." });
    const user = userEvent.setup();
    group({ sync: syncView([JOBS_DONE]) });
    await user.click(screen.getByRole("button", { name: "Sync now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A sync is already running.");
    expect(refresh).not.toHaveBeenCalled();
  });
});

/* LIVE UPDATES FROM SERVICEM8 (two-way phase 4). Nothing while they work;
   one line, in the needs-a-look colour, when they don't. */
describe("live updates from ServiceM8", () => {
  const LINE = "ServiceM8 turned off live updates for Job notes on Sat 3 Oct: Webhook request failed for over 12 hours. Press Reconnect.";

  it("says nothing while they work", () => {
    group({ sync: syncView([JOBS_DONE]) });
    expect(screen.queryByText(/live update/i)).toBeNull();
  });

  it("says the one line when they don't, in the needs-a-look colour, beside Reconnect", () => {
    group({ sync: syncView([JOBS_DONE]), liveUpdates: LINE });
    expect(screen.getByText(LINE).closest("p")).toHaveClass("st2-int-said--look");
    expect(screen.getByRole("button", { name: "Reconnect ServiceM8" })).toBeInTheDocument();
  });

  it("writes the same line on the server", () => {
    const html = renderToString(
      <ToastProvider>
        <Servicem8Group connection={toView(row())} {...ready} sync={syncView([JOBS_DONE])} liveUpdates={LINE} />
      </ToastProvider>
    );
    expect(html).toContain(LINE);
  });

  it("says nothing without a connection, whatever it is handed", () => {
    group({ connection: null, liveUpdates: LINE });
    expect(screen.queryByText(LINE)).toBeNull();
  });
});

/* Isaac, 2026-09-28: "some sort of green signalling to show that it is
   connected, and working". Green only when it is both. */
describe("the connection's health", () => {
  const healthy = syncView([JOBS_DONE]);
  const word = (text: string) => screen.getByText(text).closest(".pt-state")!;

  it("is green when the grant is whole, the read works and the last sync finished", () => {
    group({ reach: { ok: true, account: { name: ACCOUNT, timezoneName: "Australia/Sydney" } }, sync: healthy });
    expect(word("Connected and working")).toHaveClass("pt-state--good");
  });

  it("says a sync is running, still green", () => {
    group({ sync: { ...healthy, lastRun: { ...healthy.lastRun!, running: true } } });
    expect(word("Syncing now")).toHaveClass("pt-state--good");
  });

  it("needs a look when the last sync didn't finish", () => {
    group({ sync: { ...healthy, lastRun: { ...healthy.lastRun!, ok: false } } });
    expect(word("Last sync didn't finish")).toHaveClass("pt-state--look");
  });

  it("needs a look when the live read failed", () => {
    group({ reach: { ok: false, error: "401" }, sync: healthy });
    expect(word("Can't be read")).toHaveClass("pt-state--look");
  });

  it("asks for a reconnect in red, with the grant's own reason on the line", () => {
    group({ connection: toView(row({ status: "needs_reauth", last_error: "ServiceM8 refused the token." })) });
    expect(word("Needs reconnecting")).toHaveClass("pt-state--wrong");
    expect(lineOf(connectionRow())).toMatch(/^ServiceM8 refused the token\./);
  });

  it("says nothing before there is a connection", () => {
    group({ connection: null });
    expect(document.querySelector(".pt-state")).toBeNull();
  });
});

/* ── sending files to ServiceM8 ──
   The owner's switch for what HeyTiff writes back. It isn't drawn where it
   can't be set; On asks for the permission it needs and says so until it
   has it; and the list shows what was done to their ServiceM8. */
type Recent = Sm8WritesView["recent"][number];
const writes = (over: Partial<Sm8WritesView> = {}): Sm8WritesView => ({
  mode: "off",
  pausedReason: null,
  hold: null,
  granted: [],
  refused: [],
  sentLately: null,
  waiting: 0,
  failed: 0,
  recent: [],
  hourlyCap: 60,
  ...over,
});
const recent = (n: number, over: Partial<Recent> = {}): Recent[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `w${i}`,
    kind: "attachment" as const,
    name: `File ${i}.pdf`,
    jobNumber: "2380",
    status: "sent" as const,
    attempts: 1,
    error: null,
    at: "2026-09-23T02:00:00Z",
    by: "Isaac Smith",
    ...over,
  }));
const live = (scopes = SM8_SCOPE_LIST.join(" ")) => toView(row({ write_mode: "live", scopes }));
const openRecent = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(within(screen.getByText("Recent sends").closest(".st2-set") as HTMLElement).getByRole("button", { name: "Show each" }));
const openPermissions = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(within(screen.getByText("Permissions").closest(".st2-set") as HTMLElement).getByRole("button", { name: "Show each" }));

describe("sending files to ServiceM8", () => {
  it("isn't drawn where writing isn't available — a setting that can't be set is a roadmap", () => {
    group({ writes: null });
    expect(screen.queryByText("Sending files to ServiceM8")).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("starts off, offering Off, Paused and On — Trial run is retired", () => {
    group({ writes: writes() });
    const tray = screen.getByRole("radiogroup", { name: "Sending files to ServiceM8" });
    expect(within(tray).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Off", "Paused", "On"]);
    expect(within(tray).getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");
  });

  it("switches on the owner's press, says so, and reloads", async () => {
    const user = userEvent.setup();
    group({ writes: writes() });
    await user.click(screen.getByRole("radio", { name: "On" }));
    expect(setWriteMode).toHaveBeenCalledWith("live");
    expect(await screen.findByText("Sending to ServiceM8 on")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("says a refused change, rather than looking as though it took", async () => {
    setWriteMode.mockResolvedValue({ ok: false, error: "Only an owner can change connected apps." });
    const user = userEvent.setup();
    group({ writes: writes() });
    await user.click(screen.getByRole("radio", { name: "On" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only an owner can change connected apps.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("switches to Paused on the owner's press, and says what Off cancelled", async () => {
    const user = userEvent.setup();
    setWriteMode.mockResolvedValue({ ok: true, note: "Sending is off. 2 files that were waiting won't go." });
    group({ connection: live(), writes: writes({ mode: "live" }) });
    await user.click(screen.getByRole("radio", { name: "Paused" }));
    expect(setWriteMode).toHaveBeenLastCalledWith("paused");
    await waitFor(() => expect(screen.getByRole("radio", { name: "Off" })).not.toBeDisabled());
    await user.click(screen.getByRole("radio", { name: "Off" }));
    expect(setWriteMode).toHaveBeenLastCalledWith("off");
    expect(await screen.findAllByText("Sending is off. 2 files that were waiting won't go.")).not.toHaveLength(0);
  });

  it("says plainly that a trial run sends nothing", () => {
    group({ connection: toView(row({ write_mode: "trial" })), writes: writes({ mode: "trial" }) });
    expect(screen.getByText(/Nothing reaches ServiceM8\.$/)).toBeInTheDocument();
  });

  it("asks for the write permission only while On, and says what it allows", async () => {
    const user = userEvent.setup();
    const { unmount } = group({ writes: writes() });
    await openPermissions(user);
    expect(screen.queryByText("manage_attachments")).not.toBeInTheDocument();
    unmount();

    // On, and not granted: short of what is asked, so the list stands open
    group({ connection: live(), writes: writes({ mode: "live" }) });
    expect(screen.getByText("manage_attachments")).toBeInTheDocument();
    expect(screen.getByText(/HeyTiff only ever adds/)).toBeInTheDocument();
    expect(screen.getAllByText("Not granted yet")).toHaveLength(1);
    expect(lineOf(screen.getByText("Permissions").closest(".st2-set") as HTMLElement)).toMatch(/reads and 1 write, 1 not granted yet$/);
  });

  it("says On can't send until ServiceM8 gives the permission, and how to give it", () => {
    group({ connection: live(), writes: writes({ mode: "live" }) });
    expect(screen.getByText(/hasn't given HeyTiff permission to add files yet/)).toHaveTextContent(/Reconnect ServiceM8 below/);
    // the health word agrees: the grant is short of what is now asked for
    expect(screen.getByText("Missing access")).toBeInTheDocument();
  });

  it("once granted, says nothing about permission and counts what went", () => {
    group({
      connection: live(`${SM8_SCOPE_LIST.join(" ")} manage_attachments`),
      writes: writes({ mode: "live", granted: ["attachment"], sentLately: 14 }),
    });
    expect(screen.queryByText(/hasn't given HeyTiff permission/)).not.toBeInTheDocument();
    expect(lineOf(screen.getByText("Recent sends").closest(".st2-set") as HTMLElement)).toBe("14 sent in the last 30 days");
  });

  it("lists what was done to their ServiceM8, with what didn't go and why", async () => {
    const user = userEvent.setup();
    group({
      connection: live(),
      writes: writes({
        mode: "live",
        granted: ["attachment"],
        recent: [
          { id: "w1", kind: "attachment", name: "Public liability.pdf", jobNumber: "2380", status: "sent", attempts: 1, error: null, at: "2026-09-23T02:00:00Z", by: "Isaac Smith" },
          { id: "w2", kind: "attachment", name: "Plan.pdf", jobNumber: "2381", status: "failed", attempts: 1, error: "ServiceM8 said the file is too big.", at: "2026-09-22T02:00:00Z", by: "Troy Porter" },
        ],
      }),
    });
    expect(screen.queryByText("Public liability.pdf")).not.toBeInTheDocument();
    await openRecent(user);
    expect(screen.getByText("Public liability.pdf")).toBeInTheDocument();
    expect(screen.getByText("Sent").closest(".pt-state")).toHaveClass("pt-state--good");
    expect(screen.getByText("Job 2380, Isaac Smith, Wed 23 Sept")).toBeInTheDocument();
    expect(screen.getByText("Not sent").closest(".pt-state")).toHaveClass("pt-state--wrong");
    expect(screen.getByText("Job 2381, Troy Porter, Tue 22 Sept. ServiceM8 said the file is too big.")).toBeInTheDocument();
  });

  it("says who paused it and how many are waiting", () => {
    const { unmount } = group({
      connection: toView(row({ write_mode: "paused" })),
      writes: writes({ mode: "paused", pausedReason: "owner", waiting: 3, granted: ["attachment"] }),
    });
    expect(screen.getByRole("radio", { name: "Paused" })).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText("Paused. Nothing goes to ServiceM8 until you switch it back on, and nothing waiting is lost. 3 waiting.")
    ).toBeInTheDocument();
    unmount();

    group({ connection: toView(row({ write_mode: "paused" })), writes: writes({ mode: "paused", pausedReason: "cap", granted: ["attachment"] }) });
    const said = screen.getByText("Paused by HeyTiff, because more than 60 went to ServiceM8 within an hour. Nothing waiting is lost.");
    expect(said.closest("p")).toHaveClass("st2-int-said--look");
  });

  it("offers Retry the files when some didn't go, and says what it did", async () => {
    const user = userEvent.setup();
    group({ connection: live(), writes: writes({ mode: "live", granted: ["attachment"], failed: 2, sentLately: 34 }) });
    const failedRow = screen.getByText("2 files didn't go").closest(".st2-set") as HTMLElement;
    expect(lineOf(failedRow)).toBe("34 sent in the last 30 days");
    expect(within(failedRow).getByText("Didn't go").closest(".pt-state")).toHaveClass("pt-state--wrong");
    await user.click(within(failedRow).getByRole("button", { name: "Retry the files" }));
    expect(retryFailed).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("2 files will go again.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("offers no Retry when nothing failed", () => {
    group({ connection: live(), writes: writes({ mode: "live" }) });
    expect(screen.queryByRole("button", { name: "Retry the files" })).not.toBeInTheDocument();
  });

  it("draws the latest four, then offers the rest", async () => {
    const user = userEvent.setup();
    group({ connection: live(), writes: writes({ mode: "live", granted: ["attachment"], recent: recent(25) }) });
    await openRecent(user);
    expect(screen.getAllByText(/^File \d+\.pdf$/)).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "Show all 25" }));
    expect(screen.getAllByText(/^File \d+\.pdf$/)).toHaveLength(25);
    expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
  });

  it("says what holds a waiting send", async () => {
    const user = userEvent.setup();
    group({
      connection: toView(row({ write_mode: "paused" })),
      writes: writes({ mode: "paused", pausedReason: "owner", hold: "paused", recent: recent(1, { status: "queued", attempts: 0 }) }),
    });
    await openRecent(user);
    expect(screen.getByText("Held while paused")).toBeInTheDocument();
  });

  it("keeps asking for the write permission while Paused", () => {
    group({ connection: toView(row({ write_mode: "paused" })), writes: writes({ mode: "paused", pausedReason: "owner" }) });
    expect(screen.getByText("manage_attachments")).toBeInTheDocument();
    expect(screen.getByText(/hasn't given HeyTiff permission to add files yet/)).toBeInTheDocument();
  });
});

/* ── files and notes, and every kind after (two-way phases 2 and 3) ──
   With files alone allowed (production today) there is one switch and the
   permissions are exactly as they were; with more, the owner switches each
   kind, and its permission is listed only while it is on. */
describe("sending more than files", () => {
  const view = (over: Partial<Sm8WritesView> = {}): Sm8WritesView => ({
    mode: "live",
    pausedReason: null,
    hold: null,
    granted: ["attachment", "note", "booking"],
    refused: [],
    sentLately: 3,
    waiting: 0,
    failed: 0,
    recent: [],
    hourlyCap: 60,
    kinds: ["attachment", "note", "booking"],
    ownerKinds: ["attachment", "note", "booking"],
    ...over,
  });
  const switches = () => screen.queryAllByRole("switch").map((s) => s.textContent);
  const kindsLive = live();

  it("(F) with files alone allowed: one switch, and never the notes permission", async () => {
    const user = userEvent.setup();
    group({ connection: kindsLive, writes: view({ kinds: ["attachment"], ownerKinds: ["attachment", "note"] }) });
    expect(screen.getByRole("radiogroup", { name: "Sending files to ServiceM8" })).toBeInTheDocument();
    expect(switches()).toEqual([]);
    if (!screen.queryByText("manage_attachments")) await openPermissions(user);
    expect(screen.getByText("manage_attachments")).toBeInTheDocument();
    expect(screen.queryByText("publish_job_notes")).not.toBeInTheDocument();
  });

  it("(F) with notes allowed: headed Sending to ServiceM8, a Files and a Notes switch, and the notes permission when the page lists it", async () => {
    const user = userEvent.setup();
    setWriteKind.mockResolvedValue({ ok: true });
    group({
      connection: kindsLive,
      writes: view({ kinds: ["attachment", "note"], ownerKinds: ["attachment", "note"], granted: ["attachment"] }),
      writeScopes: SM8_WRITE_SCOPES,
    });
    expect(screen.getByRole("radiogroup", { name: "Sending to ServiceM8" })).toBeInTheDocument();
    expect(switches()).toEqual(["Sending files to ServiceM8", "Sending notes to ServiceM8"]);
    expect(screen.getByText("publish_job_notes")).toBeInTheDocument();
    // the notes permission isn't held: said, in notes' words
    expect(screen.getByText(/hasn't given HeyTiff permission to add notes yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Sending notes to ServiceM8" }));
    expect(setWriteKind).toHaveBeenCalledWith("note", false);
    expect(await screen.findByText("Notes off")).toBeInTheDocument();
  });

  it("(F) with all three: Files, Notes and Bookings, in that order, each saving itself and saying what it cancelled", async () => {
    const user = userEvent.setup();
    setWriteKind.mockResolvedValue({ ok: true, note: "Bookings are off. 2 bookings that were waiting won't go." });
    group({ connection: kindsLive, writes: view() });
    expect(switches()).toEqual(["Sending files to ServiceM8", "Sending notes to ServiceM8", "Sending bookings to ServiceM8"]);
    expect(screen.getByRole("switch", { name: "Sending bookings to ServiceM8" }).closest(".st2-set")).toHaveTextContent(/^Bookings/);
    const bookings = screen.getByRole("switch", { name: "Sending bookings to ServiceM8" });
    expect(bookings).toHaveAttribute("aria-checked", "true");
    await user.click(bookings);
    expect(setWriteKind).toHaveBeenCalledWith("booking", false);
    expect(await screen.findByText("Bookings are off. 2 bookings that were waiting won't go.")).toBeInTheDocument();
  });

  it("(F) with leave allowed: a Leave switch after Bookings, off until the owner switches it on, and its own consent line", async () => {
    const user = userEvent.setup();
    const kinds = ["attachment", "note", "booking", "leave"] as Sm8WritesView["kinds"];
    const { unmount } = group({ connection: kindsLive, writes: view({ kinds }) });
    expect(switches()).toEqual([
      "Sending files to ServiceM8",
      "Sending notes to ServiceM8",
      "Sending bookings to ServiceM8",
      "Sending leave to ServiceM8",
    ]);
    expect(screen.getByRole("switch", { name: "Sending leave to ServiceM8" })).toHaveAttribute("aria-checked", "false");
    await user.click(screen.getByRole("switch", { name: "Sending leave to ServiceM8" }));
    expect(setWriteKind).toHaveBeenCalledWith("leave", true);
    unmount();
    group({ connection: kindsLive, writes: view({ kinds, ownerKinds: ["attachment", "leave"], granted: ["attachment"] }) });
    expect(screen.getByText(/hasn't given HeyTiff permission to add leave yet, so no leave can go/)).toBeInTheDocument();
  });

  it("(F) a new job says on its row that ServiceM8 may charge for it", () => {
    group({ connection: kindsLive, writes: view({ kinds: ["attachment", "job"], ownerKinds: ["attachment"] }) });
    const jobs = screen.getByRole("switch", { name: "Starting jobs in ServiceM8" }).closest(".st2-set") as HTMLElement;
    expect(jobs).toHaveTextContent(/^New jobs/);
    expect(lineOf(jobs)).toBe("ServiceM8 may charge for jobs, as it does for jobs started there.");
  });

  /* Isaac, 2026-10-11: send to ServiceM8 as a quote, "Trial first" */
  it("switches accepted quotes three ways, Off, Trial or On, a trial run whatever the connection says", async () => {
    const user = userEvent.setup();
    const { unmount } = group({ connection: kindsLive, writes: view({ kinds: ["attachment", "quote"], ownerKinds: ["attachment", "quote"], quotesTrial: true }) });
    const quotes = screen.getByRole("radiogroup", { name: "Sending accepted quotes to ServiceM8" });
    expect(quotes.closest(".st2-set")).toHaveTextContent(/^Accepted quotes/);
    expect(within(quotes).getByRole("radio", { name: "Trial" })).toHaveAttribute("aria-checked", "true");
    await user.click(within(quotes).getByRole("radio", { name: "On" }));
    expect(setQuotes).toHaveBeenCalledWith("live");
    expect(await screen.findByText("Accepted quotes on")).toBeInTheDocument();
    unmount();
    group({ connection: kindsLive, writes: view({ kinds: ["attachment", "quote"], ownerKinds: ["attachment"] }) });
    expect(within(screen.getByRole("radiogroup", { name: "Sending accepted quotes to ServiceM8" })).getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");
  });

  it("(F) says ServiceM8 hasn't given permission to book only while Bookings is On and it isn't held", () => {
    const consent = /hasn't given HeyTiff permission to book yet, so no booking can go/;
    const cases: [Partial<Sm8WritesView>, boolean][] = [
      [{ granted: ["attachment", "note"] }, true],
      // Bookings Off: nothing to ask for
      [{ granted: ["attachment", "note"], ownerKinds: ["attachment", "note"] }, false],
      // held
      [{}, false],
      // refused since the last connect: said again
      [{ refused: ["booking"] }, true],
    ];
    for (const [over, says] of cases) {
      const { unmount } = group({ connection: kindsLive, writes: view(over) });
      if (says) expect(screen.getByText(consent)).toBeInTheDocument();
      else expect(screen.queryByText(consent)).not.toBeInTheDocument();
      unmount();
    }
    // a trial run asks for nothing
    group({ connection: toView(row({ write_mode: "trial" })), writes: view({ mode: "trial", granted: ["attachment", "note"] }) });
    expect(screen.queryByText(consent)).not.toBeInTheDocument();
  });

  it("says what each booking permission allows, and that it isn't granted yet, when the page lists it", () => {
    const scopes = `${SM8_SCOPE_LIST.join(" ")} manage_attachments publish_job_notes`;
    group({ connection: toViewOf(row({ write_mode: "live", scopes }), null, ["attachment", "note", "booking"]), writes: view(), writeScopes: SM8_WRITE_SCOPES });
    for (const scope of ["manage_schedule", "manage_jobs"]) {
      const item = screen.getByText(scope).closest(".st2-set") as HTMLElement;
      expect(within(item).getByText("Not granted yet")).toBeInTheDocument();
    }
    expect(screen.getByText(/never touches allocations or booking windows/)).toBeInTheDocument();
    expect(screen.getByText(/It never removes a job\./)).toBeInTheDocument();
  });

  it("(F) lists a booking under its label, and a sent one with a guard's words says them", async () => {
    const user = userEvent.setup();
    const at = "2026-09-27T10:00:00Z";
    group({
      connection: kindsLive,
      writes: view({
        recent: [
          { id: "b1", kind: "booking", name: "Booking", jobNumber: "3370", status: "sent", attempts: 1, error: "ServiceM8 kept a different time for this booking. HeyTiff switched bookings off.", at, by: "Isaac Smith" },
          { id: "b2", kind: "booking", name: "Quote made a Work Order", jobNumber: "288", status: "sent", attempts: 1, error: null, at, by: "Isaac Smith" },
          // a file that went never says a reason, as before
          { id: "f1", kind: "attachment", name: "Plan.pdf", jobNumber: "2380", status: "sent", attempts: 1, error: "left over", at, by: "Troy Porter" },
        ],
      }),
    });
    await openRecent(user);
    expect(screen.getByText("Booking")).toBeInTheDocument();
    expect(
      screen.getByText("Job 3370, Isaac Smith, Sun 27 Sept. ServiceM8 kept a different time for this booking. HeyTiff switched bookings off.")
    ).toBeInTheDocument();
    expect(screen.getByText("Job 288, Isaac Smith, Sun 27 Sept")).toBeInTheDocument();
    expect(screen.getByText("Job 2380, Troy Porter, Sun 27 Sept")).toBeInTheDocument();
  });

  it("(F) counts waiting bookings apart in the disconnect confirm, and says today's words with none", async () => {
    const user = userEvent.setup();
    const { unmount } = group({ connection: kindsLive, waitingWrites: 2, waitingBookings: 1 });
    await openDisconnect(user);
    expect(within(dialog()).getByText("2 files and 1 booking still waiting to go to ServiceM8 are cancelled.")).toBeInTheDocument();
    unmount();
    group({ connection: kindsLive, waitingWrites: 2, waitingBookings: 0 });
    await openDisconnect(user);
    expect(within(dialog()).getByText("2 files still waiting to go to ServiceM8 are cancelled.")).toBeInTheDocument();
  });
});

describe("permissions", () => {
  it("fold to one line once connected and whole, and open on Show each", async () => {
    const user = userEvent.setup();
    group();
    const perms = screen.getByText("Permissions").closest(".st2-set") as HTMLElement;
    expect(lineOf(perms)).toBe(`${SM8_SCOPE_LIST.length} reads, all granted`);
    expect(screen.queryByText("read_jobs")).not.toBeInTheDocument();
    await openPermissions(user);
    expect(within(screen.getByText("read_jobs").closest(".st2-set") as HTMLElement).getByText("Granted")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide them" }));
    expect(screen.queryByText("read_jobs")).not.toBeInTheDocument();
  });
});
