import { render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import { Servicem8Screen } from "../servicem8-screen";
import { toView as toViewOf, type ConnectionRow } from "@/lib/integrations/connection";
import { SM8_SCOPE_LIST, SM8_WRITE_SCOPES } from "@/lib/integrations/providers";
import { fmtAuWeekdayDate } from "@/lib/au-dates";
import { sm8ObjectPhase, SM8_PAUSE_MIDWALK } from "@/lib/integrations/sm8-sync-plan";
import type { Sm8ObjectStatus, Sm8SyncStatusView } from "@/lib/integrations/sm8-sync";
import type { Sm8WritesView } from "../sm8-writes-card";

/* The ServiceM8 screen's guards, which are STRICTER than Xero's for one
   reason: disconnecting here deletes a whole mirror of somebody's client
   book, where Xero's drops credentials only.

   Both halves come from a real accident (2026-08-10): a live business account
   was connected instead of a dev one, because OAuth authorises whichever
   account the BROWSER is signed into and never asks — and the success notice
   named nothing, so the wrong account looked exactly like the right one. */

const disconnect = jest.fn();
const syncNow = jest.fn();
const setWriteMode = jest.fn();
const setWriteKind = jest.fn();
const retryFailed = jest.fn();
const refresh = jest.fn();

jest.mock("@/app/actions/integrations", () => ({
  disconnectServiceM8Action: (...args: unknown[]) => disconnect(...args),
  syncServiceM8NowAction: (...args: unknown[]) => syncNow(...args),
  setServiceM8WriteModeAction: (...args: unknown[]) => setWriteMode(...args),
  setServiceM8WriteKindAction: (...args: unknown[]) => setWriteKind(...args),
  retryFailedServiceM8WritesAction: (...args: unknown[]) => retryFailed(...args),
}));

/* The view as the store builds it on a deployment that sends files: the
   write kinds that count are files alone (store.ts hands them in). */
const toView = (r: ConnectionRow, name: string | null = null) => toViewOf(r, name, ["attachment"]);
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));

const ACCOUNT = "Diamond Air Solutions Pty LTD";

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

const openConfirm = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByText("Disconnect"));

beforeEach(() => {
  disconnect.mockReset().mockResolvedValue({ ok: true });
  syncNow.mockReset().mockResolvedValue({ ok: true });
  setWriteMode.mockReset().mockResolvedValue({ ok: true });
  retryFailed.mockReset().mockResolvedValue({ ok: true, note: "2 files will go again." });
  refresh.mockReset();
});

describe("before connecting", () => {
  it("warns which account consent will use — before the button, not after", () => {
    render(<Servicem8Screen connection={null} {...ready} />);

    expect(
      screen.getByText(/whichever ServiceM8 account this browser is already signed in to/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/won't ask you to choose/i)).toBeInTheDocument();
    // and how to avoid it, not just that it happens
    expect(screen.getByText(/private window/i)).toBeInTheDocument();
  });

  it("has nothing to disconnect", () => {
    render(<Servicem8Screen connection={null} {...ready} />);
    expect(screen.queryByText("Disconnect")).not.toBeInTheDocument();
  });
});

describe("connected — the warning names the account", () => {
  it("says what this workspace is currently connected to, so a reconnect isn't blind", () => {
    render(<Servicem8Screen connection={toView(row())} {...ready} />);
    expect(screen.getByText(/currently connected to/i)).toBeInTheDocument();
    expect(screen.getAllByText(ACCOUNT).length).toBeGreaterThan(1);
  });
});

describe("disconnect — the only control here that deletes", () => {
  it("spells out that the mirror goes too, and that a reconnect rebuilds it", async () => {
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row())} {...ready} />);
    await openConfirm(user);

    expect(screen.getByText(/Every mirrored row goes with them/i)).toBeInTheDocument();
    expect(screen.getByText(/rebuilds the mirror/i)).toBeInTheDocument();
    // ServiceM8 has no revoke endpoint — the one step we can't do for them
    expect(screen.getByText(/add-ons/i)).toBeInTheDocument();
  });

  it("refuses until the account name is typed", async () => {
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row())} {...ready} />);
    await openConfirm(user);

    const go = screen.getByText("Yes, disconnect") as HTMLButtonElement;
    expect(go.disabled).toBe(true);

    await user.click(go);
    expect(disconnect).not.toHaveBeenCalled();

    await user.type(screen.getByRole("textbox"), ACCOUNT);
    expect((screen.getByText("Yes, disconnect") as HTMLButtonElement).disabled).toBe(false);

    await user.click(screen.getByText("Yes, disconnect"));
    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
  });

  it("refuses a name that is merely close", async () => {
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row())} {...ready} />);
    await openConfirm(user);

    await user.type(screen.getByRole("textbox"), "Diamond Air");
    expect((screen.getByText("Yes, disconnect") as HTMLButtonElement).disabled).toBe(true);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("accepts the name in any case, with tidy spacing — it's a read-this check, not a typing test", async () => {
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row())} {...ready} />);
    await openConfirm(user);

    await user.type(screen.getByRole("textbox"), "  diamond air solutions pty ltd ");
    expect((screen.getByText("Yes, disconnect") as HTMLButtonElement).disabled).toBe(false);
  });

  it("hides Reconnect while confirming, so the two can't be misclicked", async () => {
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row())} {...ready} />);
    await openConfirm(user);

    expect(screen.queryByText("Reconnect")).not.toBeInTheDocument();
  });

  it("lets you back out, and clears what was typed", async () => {
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row())} {...ready} />);
    await openConfirm(user);

    await user.type(screen.getByRole("textbox"), ACCOUNT);
    await user.click(screen.getByText("Keep it"));
    expect(disconnect).not.toHaveBeenCalled();

    // reopening must not arrive pre-armed from the last attempt
    await openConfirm(user);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
    expect((screen.getByText("Yes, disconnect") as HTMLButtonElement).disabled).toBe(true);
  });

  it("says how many files still waiting to go it would cancel", async () => {
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row())} waitingWrites={2} {...ready} />);
    await openConfirm(user);
    expect(screen.getByText("2 files still waiting to go to ServiceM8 are cancelled.")).toBeInTheDocument();
  });

  it("says it in a connection that needs reconnecting too — Disconnect is offered there", async () => {
    const user = userEvent.setup();
    render(
      <Servicem8Screen connection={toView(row({ status: "needs_reauth" }))} waitingWrites={1} {...ready} />
    );
    await openConfirm(user);
    expect(screen.getByText("1 file still waiting to go to ServiceM8 is cancelled.")).toBeInTheDocument();
  });

  it("leaves the line out when nothing is waiting", async () => {
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row())} waitingWrites={0} {...ready} />);
    await openConfirm(user);
    expect(screen.queryByText(/still waiting to go to ServiceM8/)).not.toBeInTheDocument();
  });

  it("surfaces a refused disconnect rather than claiming success", async () => {
    disconnect.mockResolvedValue({ ok: false, error: "Only an owner can change connected apps." });
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row())} {...ready} />);
    await openConfirm(user);

    await user.type(screen.getByRole("textbox"), ACCOUNT);
    await user.click(screen.getByText("Yes, disconnect"));

    expect(
      await screen.findByText("Only an owner can change connected apps."),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

/* A reconnect to a different account cleared the old one's copy, so the
   screen is the one place left that says which business it was. */
describe("the account this one replaced", () => {
  it("shows the previous account's name and the day it went", () => {
    render(
      <Servicem8Screen
        connection={toView(row())}
        previousAccount={{ name: "Acme Air", at: "2026-09-24T01:00:00.000Z" }}
        {...ready}
      />
    );
    expect(screen.getByText("Previous account")).toBeInTheDocument();
    // the day in AU time, in the screen's own date format (en-AU spells it "Sept" on current ICU)
    expect(screen.getByText(`Acme Air, until ${fmtAuWeekdayDate("2026-09-24")}`)).toBeInTheDocument();
    expect(fmtAuWeekdayDate("2026-09-24")).toMatch(/^Thu 24 Sept? 2026$/);
  });

  it("an old account whose name was never read", () => {
    render(
      <Servicem8Screen
        connection={toView(row())}
        previousAccount={{ name: null, at: "2026-09-24T01:00:00.000Z" }}
        {...ready}
      />
    );
    expect(screen.getByText(/^Another ServiceM8 account, until/)).toBeInTheDocument();
  });

  it("is absent when the account never changed", () => {
    render(<Servicem8Screen connection={toView(row())} {...ready} />);
    expect(screen.queryByText("Previous account")).not.toBeInTheDocument();
  });
});

/* Shared accounts are legitimate and invisible — every uniqueness rule in the
   integrations area is scoped to ONE workspace, so a second workspace can
   mirror this same account and nothing would ever say so. This line says so.
   It informs; it never blocks, because refusing would strand people who share
   an account on purpose. */
describe("this account is connected elsewhere", () => {
  it("says how many other workspaces hold it, and what that means", () => {
    render(<Servicem8Screen connection={toView(row())} elsewhere={2} {...ready} />);

    expect(screen.getByText(/2 other HeyTiff workspaces/)).toBeInTheDocument();
    expect(screen.getByText(/mirrors its own copy/i)).toBeInTheDocument();
    // the reassurance that stops it reading as "your data is at risk here"
    expect(screen.getByText(/disconnecting here doesn't affect theirs/i)).toBeInTheDocument();
    // and the one action that actually ends someone else's access
    expect(screen.getByText(/remove HeyTiff's access from inside ServiceM8/i)).toBeInTheDocument();
  });

  it("says workspace, singular, for one", () => {
    render(<Servicem8Screen connection={toView(row())} elsewhere={1} {...ready} />);
    expect(screen.getByText(/1 other HeyTiff workspace$/)).toBeInTheDocument();
  });

  it("stays silent for the ordinary case", () => {
    render(<Servicem8Screen connection={toView(row())} elsewhere={0} {...ready} />);
    expect(screen.queryByText(/other HeyTiff workspace/)).not.toBeInTheDocument();
  });

  it("never blocks — Reconnect and Disconnect are both still offered", () => {
    render(<Servicem8Screen connection={toView(row())} elsewhere={3} {...ready} />);
    expect(screen.getByText("Reconnect")).toBeInTheDocument();
    expect(screen.getByText("Disconnect")).toBeInTheDocument();
  });

  it("gets out of the way once you are confirming a disconnect", async () => {
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row())} elsewhere={2} {...ready} />);
    await user.click(screen.getByText("Disconnect"));

    // the confirm has its own consequences to read; two notices compete
    expect(screen.queryByText(/other HeyTiff workspaces/)).not.toBeInTheDocument();
  });
});

/* ── the mirror card ──

   THE BUG THIS LOCKS SHUT: a first sync of a real ServiceM8 account is not one
   event, it is days of runs. The engine's page budget caps a run, so ~25,000
   attachments arrive over several — and between them the object's row carries
   `last_error: "Paused mid-walk"`. The card rendered ANY last_error in the
   warning colour and showed a row count only once backfill_done flipped, so
   the object doing the most work was the one that looked broken, and the
   24,996 rows already mirrored were invisible.

   Each test below asserts the DISTINCTION rather than the wording: which rows
   warn, and whether progress is visible at all. */

const objectStatus = (
  over: Partial<Sm8ObjectStatus> & Pick<Sm8ObjectStatus, "object" | "label">
): Sm8ObjectStatus => {
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

/** Prod on 2026-08-13: nine objects done, attachments mid-walk at 24,996. */
const syncView = (objects: Sm8ObjectStatus[]): Sm8SyncStatusView => ({
  objects,
  lastRun: {
    startedAt: "2026-08-13T12:28:00.000Z",
    finishedAt: "2026-08-13T12:28:47.000Z",
    ok: true,
    note: null,
    running: false,
  },
});

const JOBS_DONE = objectStatus({
  object: "jobs",
  label: "Jobs",
  backfillDone: true,
  rowsPulled: 6978,
});
const ATTACHMENTS_READING = objectStatus({
  object: "attachments",
  label: "Attachments",
  rowsPulled: 24996,
  lastError: SM8_PAUSE_MIDWALK,
});

const tagFor = (label: string) =>
  screen.getByText(label).parentElement!.querySelector(".int-tag")!;

describe("the mirror card, mid-backfill", () => {
  it("does not warn about a walk that is simply still going", () => {
    render(
      <Servicem8Screen
        connection={toView(row())}
        sync={syncView([JOBS_DONE, ATTACHMENTS_READING])}
        {...ready}
      />
    );
    expect(tagFor("Attachments").className).not.toContain("warn");
  });

  it("shows the rows already read, instead of hiding them until the walk ends", () => {
    render(
      <Servicem8Screen
        connection={toView(row())}
        sync={syncView([JOBS_DONE, ATTACHMENTS_READING])}
        {...ready}
      />
    );
    // Grouped, because five figures unseparated is where a number stops
    // being read at a glance.
    expect(tagFor("Attachments").textContent).toContain("24,996");
  });

  it("never shows the engine's internal pause sentence to a business owner", () => {
    render(
      <Servicem8Screen
        connection={toView(row())}
        sync={syncView([JOBS_DONE, ATTACHMENTS_READING])}
        {...ready}
      />
    );
    expect(screen.queryByText(SM8_PAUSE_MIDWALK)).not.toBeInTheDocument();
  });

  it("says at the top that a first sync is still running, and names what it is reading", () => {
    render(
      <Servicem8Screen
        connection={toView(row())}
        sync={syncView([JOBS_DONE, ATTACHMENTS_READING])}
        {...ready}
      />
    );
    expect(screen.getByText(/Still reading Attachments across/)).toBeInTheDocument();
    expect(screen.getByText(/24,996 rows so far/)).toBeInTheDocument();
  });

  it("promises the walk resumes by itself — nobody should go hunting for a button", () => {
    render(
      <Servicem8Screen
        connection={toView(row())}
        sync={syncView([JOBS_DONE, ATTACHMENTS_READING])}
        {...ready}
      />
    );
    expect(screen.getByText(/picks up where the last one stopped/)).toBeInTheDocument();
  });

  it("names two objects when two are reading, and counts the rest", () => {
    const also = (object: string, label: string) =>
      objectStatus({ object, label, rowsPulled: 10, lastError: SM8_PAUSE_MIDWALK });
    render(
      <Servicem8Screen
        connection={toView(row())}
        sync={syncView([
          ATTACHMENTS_READING,
          also("jobs", "Jobs"),
          also("job_activities", "Schedule"),
        ])}
        {...ready}
      />
    );
    expect(screen.getByText(/Attachments, Jobs and 1 more/)).toBeInTheDocument();
  });

  it("a run happening right now still outranks the backfill line", () => {
    const view = syncView([JOBS_DONE, ATTACHMENTS_READING]);
    render(
      <Servicem8Screen
        connection={toView(row())}
        sync={{ ...view, lastRun: { ...view.lastRun!, running: true } }}
        {...ready}
      />
    );
    expect(screen.getByText("Syncing now…")).toBeInTheDocument();
    expect(screen.queryByText(/Still reading/)).not.toBeInTheDocument();
  });
});

describe("the mirror card, the other three states", () => {
  it("keeps the warning colour for a fault a human must fix", () => {
    const blocked = objectStatus({
      object: "attachments",
      label: "Attachments",
      lastError: "Reconnect ServiceM8 to grant read_attachments.",
    });
    render(
      <Servicem8Screen connection={toView(row())} sync={syncView([blocked])} {...ready} />
    );
    expect(tagFor("Attachments").className).toContain("warn");
    // A fault IS the sentence — this is the one place the note belongs.
    expect(screen.getByText("Reconnect ServiceM8 to grant read_attachments.")).toBeInTheDocument();
  });

  it("lets a fault outrank rows already read, so a stalled object can't hide", () => {
    const blocked = objectStatus({
      object: "attachments",
      label: "Attachments",
      rowsPulled: 24996,
      lastError: "Reconnect ServiceM8 to grant read_attachments.",
    });
    render(
      <Servicem8Screen connection={toView(row())} sync={syncView([blocked])} {...ready} />
    );
    expect(tagFor("Attachments").className).toContain("warn");
  });

  it("counts a finished object plainly, with no warning", () => {
    render(<Servicem8Screen connection={toView(row())} sync={syncView([JOBS_DONE])} {...ready} />);
    expect(tagFor("Jobs").textContent).toContain("6,978 rows");
    expect(tagFor("Jobs").className).not.toContain("warn");
  });

  it("stops calling an untouched object a warning — nothing is wrong with it yet", () => {
    const queued = objectStatus({ object: "queues", label: "Queues" });
    render(<Servicem8Screen connection={toView(row())} sync={syncView([queued])} {...ready} />);
    expect(tagFor("Queues").textContent).toContain("First sync queued");
    expect(tagFor("Queues").className).not.toContain("warn");
  });
});

/* THE BUG THAT BLANKED THIS WHOLE SCREEN ON PROD (2026-09-01).

   `agoLabel` reads `Date.now()`. The server rendered "Last synced 4 min ago"
   and the client, a moment later across a minute boundary, rendered "5 min
   ago" — different text in the same node, which is React #418. #418 does not
   fail politely: it takes the entire tree's hydration with it, so the page
   came up EMPTY. Nobody could reach the people card below to link themselves
   to the crew, which is how it was found.

   The board's own chip hit this and wrote down the fix; this screen had the
   same helper and never got it. */
describe("the mirror card's clock", () => {
  const READY = {
    configured: true,
    sealed: true,
    notice: null,
    connection: toView(row()),
  };

  it("emits NO relative time on the server — the whole reason it is split", () => {
    /* renderToString is the only place this is observable: `useHydrated`
       reports true on a plain client render, so RTL alone would show a time
       and prove nothing. Asserted across the whole markup rather than on one
       node, so moving the line cannot quietly hide a regression. */
    const html = renderToString(
      <Servicem8Screen {...READY} sync={syncView([JOBS_DONE])} />,
    );
    expect(html).toContain("Last synced");
    expect(html).not.toMatch(/\b(just now|min ago|hours? ago|over a day ago)\b/i);
  });

  it("fills the freshness in once there is a browser to own it", async () => {
    render(<Servicem8Screen {...READY} sync={syncView([JOBS_DONE])} />);
    await waitFor(() =>
      expect(document.body.textContent).toMatch(
        /Last synced (just now|\d+ min ago|\d+ hours? ago|over a day ago)/i,
      ),
    );
  });

  it("keeps the branches that cannot drift on the server", () => {
    /* "Syncing now…" and the still-reading line are facts about the mirror,
       identical on both sides. Only the clock branch waits. */
    const running = syncView([JOBS_DONE]);
    const html = renderToString(
      <Servicem8Screen
        {...READY}
        sync={{ ...running, lastRun: { ...running.lastRun!, running: true } }}
      />,
    );
    expect(html).toContain("Syncing now…");
  });
});

/* THE OVERNIGHT RUN, SEEN. The nightly sync does nothing until CRON_SECRET
   is set in Vercel, and nothing on any screen said whether it ever ran. The
   card now says when Vercel's scheduler last came, as an AU day and time —
   no clock is read, so the server and the browser write the same words. */
describe("the mirror card's overnight line", () => {
  const READY = { configured: true, sealed: true, notice: null, connection: toView(row()) };

  it("says when the overnight sync last came, on the AU clock", () => {
    // 20:04 UTC on Thursday 24 September is 6:04 am on Friday in Sydney
    render(<Servicem8Screen {...READY} sync={{ ...syncView([JOBS_DONE]), lastCron: "2026-09-24T20:04:00Z" }} />);
    expect(screen.getByText("Last overnight sync: Fri 25 Sept, 6:04 am")).toBeInTheDocument();
  });

  it("says plainly when it never has", () => {
    render(<Servicem8Screen {...READY} sync={{ ...syncView([JOBS_DONE]), lastCron: null }} />);
    expect(screen.getByText("The overnight sync hasn't run.")).toBeInTheDocument();
  });

  it("says nothing either way when it couldn't be read", () => {
    render(<Servicem8Screen {...READY} sync={syncView([JOBS_DONE])} />);
    expect(screen.queryByText(/overnight sync/i)).toBeNull();
  });

  it("writes the same line on the server as in the browser", async () => {
    const sync = { ...syncView([JOBS_DONE]), lastCron: "2026-09-24T20:04:00Z" };
    const html = renderToString(<Servicem8Screen {...READY} sync={sync} />);
    expect(html).toContain("Last overnight sync: Fri 25 Sept, 6:04 am");
    render(<Servicem8Screen {...READY} sync={sync} />);
    // once hydrated (the relative time has filled in), the line is unchanged
    await waitFor(() => expect(document.body.textContent).toMatch(/Last synced (just now|\d+ min ago|\d+ hours? ago|over a day ago)/i));
    expect(screen.getByText("Last overnight sync: Fri 25 Sept, 6:04 am")).toBeInTheDocument();
  });
});

/* ── sending files to ServiceM8 ──────────────────────────────────────────
   The owner's switch for the first thing HeyTiff writes back. It isn't drawn
   where it can't be set; it names each setting as a sentence; On asks for
   the permission it needs and says so until it has it; and the list shows
   what was done to their ServiceM8, including what didn't go. */
describe("sending files to ServiceM8", () => {
  type Recent = {
    id: string;
    kind: "attachment" | "note";
    name: string;
    jobNumber: string | null;
    status: "sent" | "failed" | "trial" | "queued" | "sending" | "cancelled";
    attempts: number;
    error: string | null;
    at: string;
    by: string | null;
  };
  const writes = (over: Partial<Sm8WritesView> = {}): Sm8WritesView => ({
    mode: "off",
    pausedReason: null,
    hold: null,
    granted: [],
    refused: [],
    sentLately: null,
    waiting: 0,
    failed: 0,
    recent: [] as Recent[],
    hourlyCap: 60,
    ...over,
  });
  const recent = (n: number, over: Partial<Recent> = {}): Recent[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `w${i}`,
      kind: "attachment" as const,
      name: `File ${i}.pdf`,
      jobNumber: "2380",
      status: "sent",
      attempts: 1,
      error: null,
      at: "2026-09-23T02:00:00Z",
      by: "Isaac Smith",
      ...over,
    }));

  it("isn't drawn where writing isn't available — a setting that can't be set is a roadmap", () => {
    render(<Servicem8Screen connection={toView(row())} {...ready} writes={null} />);
    expect(screen.queryByText("Sending files to ServiceM8")).not.toBeInTheDocument();
  });

  it("starts off, and says what off means", () => {
    render(<Servicem8Screen connection={toView(row())} {...ready} writes={writes()} />);
    expect(screen.getByText("Off. Nothing HeyTiff does changes your ServiceM8.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");
  });

  it("switches on the owner's press and reloads what the screen says", async () => {
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row())} {...ready} writes={writes()} />);
    await user.click(screen.getByRole("radio", { name: "Trial run" }));
    expect(setWriteMode).toHaveBeenCalledWith("trial");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("says a refused change, rather than looking as though it took", async () => {
    setWriteMode.mockResolvedValue({ ok: false, error: "Only an owner can change connected apps." });
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row())} {...ready} writes={writes()} />);
    await user.click(screen.getByRole("radio", { name: "On" }));
    expect(await screen.findByText("Only an owner can change connected apps.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says plainly that a trial run sends nothing", () => {
    render(<Servicem8Screen connection={toView(row({ write_mode: "trial" }))} {...ready} writes={writes({ mode: "trial" })} />);
    expect(screen.getByText(/Nothing reaches ServiceM8\.$/)).toBeInTheDocument();
  });

  it("asks for the write permission only while On, and says what it allows", () => {
    const { unmount } = render(<Servicem8Screen connection={toView(row())} {...ready} writes={writes()} />);
    expect(screen.queryByText("manage_attachments")).not.toBeInTheDocument();
    expect(screen.getByText(/Read-only, every one of them/)).toBeInTheDocument();
    unmount();

    render(<Servicem8Screen connection={toView(row({ write_mode: "live" }))} {...ready} writes={writes({ mode: "live" })} />);
    expect(screen.getByText("manage_attachments")).toBeInTheDocument();
    expect(screen.getByText(/HeyTiff only ever adds/)).toBeInTheDocument();
    expect(screen.getByText(/Reads, and one write/)).toBeInTheDocument();
  });

  it("says On can't send until ServiceM8 gives the permission, and how to give it", () => {
    render(<Servicem8Screen connection={toView(row({ write_mode: "live" }))} {...ready} writes={writes({ mode: "live" })} />);
    expect(screen.getByText(/hasn't given HeyTiff permission to add files yet/)).toBeInTheDocument();
    // the status line agrees: the grant is short of what is now asked for
    expect(screen.getByText("Connected, but missing some of the access HeyTiff now asks for.")).toBeInTheDocument();
    expect(screen.getAllByText("Not granted yet")).toHaveLength(1);
  });

  it("once granted, says so at the top and counts what went", () => {
    render(
      <Servicem8Screen
        connection={toView(row({ write_mode: "live", scopes: `${SM8_SCOPE_LIST.join(" ")} manage_attachments` }))}
        {...ready}
        writes={writes({ mode: "live", granted: ["attachment"], sentLately: 14 })}
      />
    );
    expect(screen.getByText("HeyTiff can read this ServiceM8 account, and add files to its jobs.")).toBeInTheDocument();
    expect(screen.getByText(/14 in the last 30 days\.$/)).toBeInTheDocument();
    expect(screen.queryByText(/hasn't given HeyTiff permission/)).not.toBeInTheDocument();
  });

  it("lists what was done to their ServiceM8, with what didn't go and why", () => {
    render(
      <Servicem8Screen
        connection={toView(row({ write_mode: "live" }))}
        {...ready}
        writes={writes({
          mode: "live",
          granted: ["attachment"],
          recent: [
            { id: "w1", kind: "attachment", name: "Public liability.pdf", jobNumber: "2380", status: "sent", attempts: 1, error: null, at: "2026-09-23T02:00:00Z", by: "Isaac Smith" },
            { id: "w2", kind: "attachment", name: "Plan.pdf", jobNumber: "2381", status: "failed", attempts: 1, error: "ServiceM8 said the file is too big.", at: "2026-09-22T02:00:00Z", by: "Troy Porter" },
          ],
        })}
      />
    );
    expect(screen.getByText("Public liability.pdf")).toBeInTheDocument();
    expect(screen.getByText("Sent")).toHaveClass("int-tag", "ok");
    expect(screen.getByText("Job 2380, Isaac Smith, Wed 23 Sept")).toBeInTheDocument();
    expect(screen.getByText("Not sent")).toHaveClass("int-tag", "bad");
    expect(screen.getByText("Job 2381, Troy Porter, Tue 22 Sept. ServiceM8 said the file is too big.")).toBeInTheDocument();
  });
  it("offers Paused, and says who paused it and how many are waiting", () => {
    const { unmount } = render(
      <Servicem8Screen
        connection={toView(row({ write_mode: "paused" }))}
        {...ready}
        writes={writes({ mode: "paused", pausedReason: "owner", waiting: 3, granted: ["attachment"] })}
      />
    );
    expect(screen.getByRole("radio", { name: "Paused" })).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(
        "Paused. Nothing goes to ServiceM8 until you switch it back on, and nothing waiting is lost. 3 waiting."
      )
    ).toBeInTheDocument();
    unmount();

    render(
      <Servicem8Screen
        connection={toView(row({ write_mode: "paused" }))}
        {...ready}
        writes={writes({ mode: "paused", pausedReason: "cap", granted: ["attachment"] })}
      />
    );
    expect(
      screen.getByText("Paused by HeyTiff, because more than 60 went to ServiceM8 within an hour. Nothing waiting is lost.")
    ).toBeInTheDocument();
  });

  it("switches to Paused on the owner's press", async () => {
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row({ write_mode: "live" }))} {...ready} writes={writes({ mode: "live" })} />);
    await user.click(screen.getByRole("radio", { name: "Paused" }));
    expect(setWriteMode).toHaveBeenCalledWith("paused");
  });

  it("says what Off cancelled", async () => {
    setWriteMode.mockResolvedValue({ ok: true, note: "Sending is off. 2 files that were waiting won't go." });
    const user = userEvent.setup();
    render(<Servicem8Screen connection={toView(row({ write_mode: "live" }))} {...ready} writes={writes({ mode: "live" })} />);
    await user.click(screen.getByRole("radio", { name: "Off" }));
    expect(await screen.findByText("Sending is off. 2 files that were waiting won't go.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("offers Retry failed files when some didn't go, and says what it did", async () => {
    const user = userEvent.setup();
    render(
      <Servicem8Screen
        connection={toView(row({ write_mode: "live" }))}
        {...ready}
        writes={writes({ mode: "live", granted: ["attachment"], failed: 2 })}
      />
    );
    expect(screen.getByText("2 didn't go.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry failed files" }));
    expect(retryFailed).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("2 files will go again.")).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("offers no Retry when nothing failed", () => {
    render(<Servicem8Screen connection={toView(row({ write_mode: "live" }))} {...ready} writes={writes({ mode: "live" })} />);
    expect(screen.queryByRole("button", { name: "Retry failed files" })).not.toBeInTheDocument();
  });

  it("draws twenty writes, then offers the rest", async () => {
    const user = userEvent.setup();
    render(
      <Servicem8Screen
        connection={toView(row({ write_mode: "live" }))}
        {...ready}
        writes={writes({ mode: "live", granted: ["attachment"], recent: recent(25) })}
      />
    );
    expect(screen.getAllByText(/^File \d+\.pdf$/)).toHaveLength(20);
    await user.click(screen.getByRole("button", { name: "Show all 25" }));
    expect(screen.getAllByText(/^File \d+\.pdf$/)).toHaveLength(25);
    expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
  });

  it("says what holds a waiting write", () => {
    render(
      <Servicem8Screen
        connection={toView(row({ write_mode: "paused" }))}
        {...ready}
        writes={writes({ mode: "paused", pausedReason: "owner", hold: "paused", recent: recent(1, { status: "queued", attempts: 0 }) })}
      />
    );
    expect(screen.getByText("Held while paused")).toBeInTheDocument();
  });

  it("keeps asking for the write permission while Paused", () => {
    render(
      <Servicem8Screen
        connection={toView(row({ write_mode: "paused" }))}
        {...ready}
        writes={writes({ mode: "paused", pausedReason: "owner" })}
      />
    );
    expect(screen.getByText("manage_attachments")).toBeInTheDocument();
    expect(screen.getByText(/Reads, and one write/)).toBeInTheDocument();
    // but adds files only while On
    expect(screen.queryByText("HeyTiff can read this ServiceM8 account, and add files to its jobs.")).not.toBeInTheDocument();
    expect(screen.getByText(/hasn't given HeyTiff permission to add files yet/)).toBeInTheDocument();
  });
});

/* ── files and notes (two-way phase 2) ──
   With files alone allowed (production today) the card and the asks list
   are exactly as they were; with notes allowed too, the owner switches each
   kind, and the notes permission is listed only while Notes is on. */
describe("sending files and notes", () => {
  const view = (over: Partial<Sm8WritesView> = {}): Sm8WritesView => ({
    mode: "live",
    pausedReason: null,
    hold: null,
    granted: ["attachment", "note"],
    refused: [],
    sentLately: 3,
    waiting: 0,
    failed: 0,
    recent: [],
    hourlyCap: 60,
    kinds: ["attachment", "note"],
    ownerKinds: ["attachment"],
    ...over,
  });

  it("(F) with files alone allowed, the asks list never shows the notes permission, and the card has no kind switch", () => {
    render(
      <Servicem8Screen
        connection={toView(row({ write_mode: "live" }))}
        {...ready}
        writes={view({ kinds: ["attachment"], ownerKinds: ["attachment", "note"] })}
      />
    );
    expect(screen.getByText("manage_attachments")).toBeInTheDocument();
    expect(screen.queryByText("publish_job_notes")).not.toBeInTheDocument();
    expect(screen.getByText("Sending files to ServiceM8")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Sending notes to ServiceM8" })).not.toBeInTheDocument();
  });

  it("with notes allowed: headed Sending to ServiceM8, a Files and a Notes switch, and the notes permission when the page lists it", async () => {
    const user = userEvent.setup();
    setWriteKind.mockResolvedValue({ ok: true });
    render(
      <Servicem8Screen
        connection={toView(row({ write_mode: "live" }))}
        {...ready}
        writes={view({ ownerKinds: ["attachment", "note"], granted: ["attachment"] })}
        writeScopes={SM8_WRITE_SCOPES}
      />
    );
    expect(screen.getByText("Sending to ServiceM8")).toBeInTheDocument();
    expect(screen.getByText("publish_job_notes")).toBeInTheDocument();
    expect(screen.getByText("On. 3 sent in the last 30 days.")).toBeInTheDocument();
    const notes = screen.getByRole("radiogroup", { name: "Sending notes to ServiceM8" });
    expect(screen.getByRole("radiogroup", { name: "Sending files to ServiceM8" })).toBeInTheDocument();
    // the notes permission isn't held: said, in notes' words
    expect(screen.getByText(/hasn't given HeyTiff permission to add notes yet/)).toBeInTheDocument();
    await user.click(within(notes).getByRole("radio", { name: "Off" }));
    expect(setWriteKind).toHaveBeenCalledWith("note", false);
  });
});
