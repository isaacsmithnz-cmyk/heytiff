/* Summary sheet cards that talk to the server: Contributors (who has worked
   on the design). It loads its action module lazily, so it is mocked at the
   module boundary. The live link's states moved with it into the Send
   dialog — see summary/__tests__/send-card.test.tsx. */

import { render, screen, waitFor } from "@testing-library/react";
import { ContributorsCard } from "../summary/contributors-card";

const listDesignContributors = jest.fn();
jest.mock("@/app/actions/studio-contributors", () => ({
  listDesignContributors: (...a: unknown[]) => listDesignContributors(...a),
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
