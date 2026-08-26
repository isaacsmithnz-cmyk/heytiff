/* Summary sheet cards that talk to the server: Contributors (who has worked
   on the design) and the live-link expiry states. Both load their action
   module lazily, so each is mocked at the module boundary. */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ContributorsCard } from "../summary/contributors-card";
import { ShareCard } from "../summary/share-card";
import { SHARE_TTL_DAYS, shareExpiresAt } from "@/lib/studio/share";

const listDesignContributors = jest.fn();
jest.mock("@/app/actions/studio-contributors", () => ({
  listDesignContributors: (...a: unknown[]) => listDesignContributors(...a),
}));

const getShareLink = jest.fn();
const createShareLink = jest.fn();
jest.mock("@/app/actions/studio-share", () => ({
  getShareLink: (...a: unknown[]) => getShareLink(...a),
  createShareLink: (...a: unknown[]) => createShareLink(...a),
  revokeShareLink: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

const contributor = (over: Record<string, unknown> = {}) => ({
  userId: "auth0|abc",
  name: "Isaac Smith",
  photoUrl: null,
  firstAt: "2026-07-01T00:00:00.000Z",
  lastAt: "2026-07-20T00:00:00.000Z",
  ...over,
});

describe("Contributors card", () => {
  it("lists everyone who has worked on the design, oldest first", async () => {
    listDesignContributors.mockResolvedValue([
      contributor(),
      contributor({ userId: "auth0|def", name: "Jordan Lee" }),
    ]);
    render(<ContributorsCard designId="dsn_1" />);

    expect(await screen.findByText("Isaac Smith")).toBeInTheDocument();
    expect(screen.getByText("Jordan Lee")).toBeInTheDocument();
    expect(screen.getByText("Contributors")).toBeInTheDocument();
    // the order the server sent is the order shown
    const names = screen.getAllByText(/Isaac Smith|Jordan Lee/).map((n) => n.textContent);
    expect(names).toEqual(["Isaac Smith", "Jordan Lee"]);
  });

  it("says the design belongs to the business — this is history, not ownership", async () => {
    listDesignContributors.mockResolvedValue([contributor()]);
    render(<ContributorsCard designId="dsn_1" />);
    expect(
      await screen.findByText(/belongs to the business/i)
    ).toBeInTheDocument();
  });

  it("a member with no staff profile still appears", async () => {
    listDesignContributors.mockResolvedValue([contributor({ name: null })]);
    render(<ContributorsCard designId="dsn_1" />);
    expect(await screen.findByText("Unknown member")).toBeInTheDocument();
    // never the raw account id
    expect(screen.queryByText(/auth0\|/)).not.toBeInTheDocument();
  });

  it("renders nothing at all when there are no contributors or no session", async () => {
    listDesignContributors.mockResolvedValue([]);
    const { container, rerender } = render(<ContributorsCard designId="dsn_1" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());

    listDesignContributors.mockRejectedValue(new Error("no session"));
    rerender(<ContributorsCard designId="dsn_2" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe("Share card — link lifetime", () => {
  const link = (over: Record<string, unknown> = {}) => ({
    url: "https://heytiff.vercel.app/live/tok",
    createdAt: "2026-07-20T00:00:00.000Z",
    expiresAt: shareExpiresAt("2026-07-20T00:00:00.000Z").toISOString(),
    expired: false,
    daysLeft: 9,
    ...over,
  });

  it("a live link says when it runs out", async () => {
    getShareLink.mockResolvedValue(link());
    render(<ShareCard designId="dsn_1" onClose={() => {}} />);
    expect(await screen.findByText(/Expires in/i)).toBeInTheDocument();
    expect(screen.getByText("9 days")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy link/i })).toBeInTheDocument();
  });

  it("uses the singular on the last day", async () => {
    getShareLink.mockResolvedValue(link({ daysLeft: 1 }));
    render(<ShareCard designId="dsn_1" onClose={() => {}} />);
    expect(await screen.findByText("1 day")).toBeInTheDocument();
  });

  it("an expired link says so and offers a new one instead of Copy", async () => {
    getShareLink.mockResolvedValue(link({ expired: true, daysLeft: 0 }));
    render(<ShareCard designId="dsn_1" onClose={() => {}} />);

    expect(await screen.findByText(/Expired/i)).toBeInTheDocument();
    expect(screen.getByText(/anyone opening it now sees nothing/i)).toBeInTheDocument();
    // copying a dead link would be a trap — offer the fix instead
    expect(screen.queryByRole("button", { name: /Copy link/i })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Create a new link/i })
    ).toBeInTheDocument();
  });

  it("creating a new link from the expired state replaces it with a live one", async () => {
    getShareLink.mockResolvedValue(link({ expired: true, daysLeft: 0 }));
    createShareLink.mockResolvedValue(link({ daysLeft: SHARE_TTL_DAYS }));
    render(<ShareCard designId="dsn_1" onClose={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: /Create a new link/i }));
    expect(await screen.findByText(`${SHARE_TTL_DAYS} days`)).toBeInTheDocument();
    expect(createShareLink).toHaveBeenCalledWith("dsn_1");
  });

  it("tells you the lifetime BEFORE you create one", async () => {
    getShareLink.mockResolvedValue(null);
    render(<ShareCard designId="dsn_1" onClose={() => {}} />);
    expect(
      await screen.findByText(new RegExp(`works for ${SHARE_TTL_DAYS} days`, "i"))
    ).toBeInTheDocument();
  });
});

/* SHARE COMES TO THE READER, like Export. The summary sheet runs several
   screens and this card used to unfold into the bar at the top of it, so
   pressing Share after reading to the bottom moved nothing into view. It
   wears the shared dialog shell now — portalled out of the sheet's own tree,
   because the shell's `.page` transform traps `position: fixed`. */
describe("the share dialog", () => {
  const live = {
    url: "https://heytiff.vercel.app/live/tok",
    createdAt: "2026-07-20T00:00:00.000Z",
    expiresAt: shareExpiresAt("2026-07-20T00:00:00.000Z").toISOString(),
    expired: false,
    daysLeft: 9,
  };

  it("is a modal dialog, portalled to the body", async () => {
    getShareLink.mockResolvedValue(live);
    const { container } = render(<ShareCard designId="dsn_1" onClose={() => {}} />);

    const dialog = await screen.findByRole("dialog", { name: "Share" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(container).not.toContainElement(dialog);
    expect(document.body).toContainElement(dialog);
  });

  it("closes on the x, on the scrim, and on Escape", async () => {
    getShareLink.mockResolvedValue(live);

    const onClose = jest.fn();
    const first = render(<ShareCard designId="dsn_1" onClose={onClose} />);
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    first.unmount();

    const escClose = jest.fn();
    const second = render(<ShareCard designId="dsn_1" onClose={escClose} />);
    await screen.findByRole("dialog", { name: "Share" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(escClose).toHaveBeenCalledTimes(1);
    second.unmount();

    const scrimClose = jest.fn();
    render(<ShareCard designId="dsn_1" onClose={scrimClose} />);
    const dialog = await screen.findByRole("dialog", { name: "Share" });
    /* the press has to LAND on the scrim — one that starts on a control
       inside the dialog and finishes over the backdrop must not dismiss */
    fireEvent.mouseDown(dialog);
    expect(scrimClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(scrimClose).toHaveBeenCalledTimes(1);
  });

  it("puts what you DO with the link on the footer bar, and nothing there when there is nothing to press", async () => {
    getShareLink.mockResolvedValue(live);
    const { unmount } = render(<ShareCard designId="dsn_1" onClose={() => {}} />);
    const foot = (await screen.findByRole("dialog", { name: "Share" })).querySelector(
      ".ds-xm-foot"
    ) as HTMLElement;
    expect(within(foot).getByRole("button", { name: /Copy link/i })).toBeInTheDocument();
    expect(within(foot).getByRole("button", { name: /Revoke/i })).toBeInTheDocument();
    unmount();

    // the session-less note has no action — the bar is absent, not empty
    getShareLink.mockRejectedValue(new Error("no session"));
    render(<ShareCard designId="dsn_1" onClose={() => {}} />);
    expect(await screen.findByText(/needs a signed-in session/i)).toBeInTheDocument();
    expect(document.querySelector(".ds-xm-foot")).toBeNull();
  });
});
