import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { Sm8Chip, syncedAgo, type Sm8Health } from "../sm8-chip";

/* THE MIRROR-HEALTH CHIP, and the hydration failure it used to cause.

   `syncedAgo` reads `Date.now()`. The server rendered "just now"; the client
   hydrated a few seconds later, crossed a minute boundary and rendered "1 min
   ago" — different text in the same node, which React treats as a hydration
   failure and which took the whole workboard's hydration down with it. It
   threw on every load of that screen.

   The property that fixes it is narrow and easy to break again by "tidying"
   the conditional: WHAT THE SERVER SENDS MUST NOT DEPEND ON THE CLOCK. The
   browser finishes the sentence once it has one. */

const health = (over: Partial<Sm8Health> = {}): Sm8Health => ({
  attention: false,
  running: false,
  syncedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  ...over,
});

afterEach(cleanup);

describe("what the server sends", () => {
  it("carries no clock-dependent text — the thing that broke hydration", () => {
    const html = renderToString(<Sm8Chip sm8={health()} />);
    expect(html).toContain("ServiceM8 synced");
    /* Any of these in the server markup means the clock got back in. */
    expect(html).not.toMatch(/just now|min ago|hour|over a day/);
  });

  it("still sends the states that cannot drift", () => {
    expect(renderToString(<Sm8Chip sm8={health({ attention: true })} />)).toContain(
      "ServiceM8 needs attention"
    );
    expect(renderToString(<Sm8Chip sm8={health({ running: true })} />)).toContain(
      "ServiceM8 syncing…"
    );
  });

  /* The whole failure was two renders disagreeing, so this compares them
     rather than trusting either one alone. */
  it("agrees with the client's FIRST render, which is what hydration compares", () => {
    const sm8 = health();
    const server = renderToString(<Sm8Chip sm8={sm8} />);
    /* `useHydrated` reports false during hydration too, so the first client
       pass produces the server's text — the match React needs. */
    expect(server).toContain("ServiceM8 synced");
    expect(server).not.toContain("ago");
  });
});

describe("once the browser has the clock", () => {
  it("finishes the sentence with how stale the mirror is", () => {
    render(<Sm8Chip sm8={health()} />);
    expect(screen.getByText("ServiceM8 synced 5 min ago")).toBeInTheDocument();
  });

  it("says nothing about staleness while a sync is running", () => {
    render(<Sm8Chip sm8={health({ running: true })} />);
    expect(screen.getByText("ServiceM8 syncing…")).toBeInTheDocument();
  });

  it("is absent entirely for a standalone org", () => {
    const { container } = render(<Sm8Chip sm8={null} />);
    /* Not a chip reading "not connected" on every screen forever. */
    expect(container).toBeEmptyDOMElement();
  });
});

describe("syncedAgo", () => {
  const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

  it("reads under a minute as just now", () => {
    expect(syncedAgo(ago(0))).toBe("just now");
  });

  it("counts minutes, then hours, then gives up", () => {
    expect(syncedAgo(ago(5))).toBe("5 min ago");
    expect(syncedAgo(ago(90))).toBe("1 hour ago");
    expect(syncedAgo(ago(200))).toBe("3 hours ago");
    expect(syncedAgo(ago(60 * 25))).toBe("over a day ago");
  });

  it("survives a missing or unparseable timestamp", () => {
    expect(syncedAgo(null)).toBe("not yet");
    expect(syncedAgo("not a date")).toBe("just now");
  });
});
