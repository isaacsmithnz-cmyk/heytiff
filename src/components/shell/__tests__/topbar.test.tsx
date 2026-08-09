import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { Topbar } from "../topbar";
import { CommandPaletteProvider } from "../command-palette-context";
import type { ShellUser } from "../sidebar";
import { actionRequiredCount } from "@/app/actions/action-required";
import { fmtAuWeekdayDayMonth, todayInAu } from "@/lib/au-dates";

/* The bell.

   It shipped as a `<button>` with no handler wearing a teal dot that pulsed on
   every screen forever — the CSS drew the dot unconditionally, so it never
   meant anything and could never stop meaning it. These tests pin the two
   properties that stop that happening again: the badge is DERIVED from a real
   count, and it is ABSENT when there is nothing to say. */

/* The topbar now carries the Tiff button, which reaches the note flow and its
   server actions — and "use server" modules cannot be imported into jsdom.
   Stubbed so this suite stays about the topbar; the button has its own. */
jest.mock("@/components/notes/tiff-button", () => ({
  TiffButton: () => <button aria-label="Ask or tell Tiff" />,
}));

jest.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
jest.mock("@/app/actions/action-required", () => ({ actionRequiredCount: jest.fn() }));

const countMock = actionRequiredCount as jest.MockedFunction<typeof actionRequiredCount>;

const user: ShellUser = {
  name: "Jordan Mills",
  initials: "JM",
  roleLabel: "Technician",
  role: "staff",
  caps: [],
};

const draw = () =>
  render(
    <CommandPaletteProvider>
      <Topbar user={user} today="2026-08-09" />
    </CommandPaletteProvider>,
  );

const bell = () => document.querySelector(".bell") as HTMLElement;

afterEach(cleanup);
beforeEach(() => countMock.mockReset());

describe("the Tiff button", () => {
  /* It floated bottom-right first and covered the page it sat on. The topbar
     is the only place that is always empty, and within it the order is
     deliberate: the thing you reach for on purpose sits before the thing that
     interrupts you. */
  it("sits in the topbar, immediately left of the bell", async () => {
    countMock.mockResolvedValue(0);
    draw();

    const tiff = document.querySelector('[aria-label^="Ask or tell Tiff"]') as HTMLElement;
    expect(tiff).not.toBeNull();
    expect(tiff.closest(".tbr")).not.toBeNull();
    /* Order, not just membership — "left of notifications" is the ask. */
    expect(tiff.compareDocumentPosition(bell()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async () => {});
  });
});

describe("the bell", () => {
  it("is a link to the board that lists what's waiting on you", async () => {
    countMock.mockResolvedValue(0);
    draw();
    // a bell that navigates nowhere is the thing this replaced
    expect(bell().tagName).toBe("A");
    expect(bell().getAttribute("href")).toBe("/dashboard/action-required");
    await act(async () => {});
  });

  it("wears NO badge while the count is still in flight", async () => {
    // never guess a number: silence until the real one lands
    let settle: (n: number) => void = () => {};
    countMock.mockReturnValue(new Promise<number>((res) => { settle = res; }));
    draw();
    expect(bell().querySelector(".d")).toBeNull();
    await act(async () => settle(3));
  });

  it("wears NO badge at zero", async () => {
    countMock.mockResolvedValue(0);
    draw();
    // and says so, for anyone who can't see the absence of a dot
    await waitFor(() => expect(bell().getAttribute("aria-label")).toBe("Nothing needs you"));
    expect(bell().querySelector(".d")).toBeNull();
  });

  it("shows the real number once it lands, and says what it means", async () => {
    countMock.mockResolvedValue(3);
    draw();
    await waitFor(() => expect(bell().querySelector(".d")?.textContent).toBe("3"));
    expect(bell().getAttribute("aria-label")).toBe("3 things need you");
  });

  it("keeps the badge to two characters", async () => {
    // the badge sits on a 44px control; "12" fits and "9+" is how it says more
    countMock.mockResolvedValue(21);
    draw();
    await waitFor(() => expect(bell().querySelector(".d")?.textContent).toBe("9+"));
    // the LABEL still carries the true count — only the pill is abbreviated
    expect(bell().getAttribute("aria-label")).toBe("21 things need you");
  });

  it("reads as singular for exactly one", async () => {
    countMock.mockResolvedValue(1);
    draw();
    await waitFor(() => expect(bell().getAttribute("aria-label")).toBe("1 thing needs you"));
  });

  it("stays silent rather than breaking the shell when the count fails", async () => {
    countMock.mockRejectedValue(new Error("offline"));
    draw();
    await waitFor(() => expect(countMock).toHaveBeenCalled());
    expect(bell().querySelector(".d")).toBeNull();
    expect(screen.getByText("Jordan Mills")).toBeInTheDocument();
  });
});

/* THE CLOCK.

   The date was a teal capsule inside the dashboard hero; it is chrome now, so
   every screen carries it and Home gets the space back. The interesting half
   is the time: a clock rendered into server markup and hydrated a minute later
   is a text mismatch, and a mismatch in a render body fails hydration for the
   whole tree. */
describe("the clock", () => {
  beforeEach(() => countMock.mockResolvedValue(0));

  it("takes the day off the LIVE clock once hydrated, not the prop it was given", () => {
    /* The prop here is deliberately ancient. An app left open overnight has to
       roll over rather than insist it is still yesterday, so after hydration
       the date is derived from the same clock as the time — which is also why
       this cannot assert a hard-coded string. It did, once, and broke at
       midnight. The server's use of the prop is pinned by the renderToString
       test below, where `hydrated` is false. */
    render(
      <CommandPaletteProvider>
        <Topbar user={user} today="2020-01-01" />
      </CommandPaletteProvider>,
    );
    const clock = document.querySelector(".tbclock") as HTMLElement;
    expect(clock).not.toBeNull();
    expect(clock.querySelector("em")?.textContent).toBe(fmtAuWeekdayDayMonth(todayInAu()));
    expect(clock.querySelector("em")?.textContent).not.toBe("Wed 1 Jan");
  });

  it("emits NO time on the server — the whole reason it is split", () => {
    /* renderToString is the only place this is observable: `useHydrated`
       reports true on a plain client render, so RTL alone would show a time
       and prove nothing. Asserted as "no h:mm am/pm anywhere in the markup"
       rather than on one element, so moving the clock can't quietly hide a
       regression. */
    const html = renderToString(
      <CommandPaletteProvider>
        <Topbar user={user} today="2026-08-09" />
      </CommandPaletteProvider>,
    );
    expect(html).toContain("Sun 9 Aug");
    expect(html).not.toMatch(/\d{1,2}:\d{2}\s*(am|pm)/i);
  });

  it("fills the time in once there is a browser to own it", async () => {
    draw();
    await waitFor(() =>
      expect(document.querySelector(".tbclock b")?.textContent).toMatch(/^\d{1,2}:\d{2} (am|pm)$/),
    );
  });

  it("is information, not a control — it sits outside the button cluster", () => {
    /* Order is the point: when · do · you. If it drifts in among the controls
       it starts reading as one. */
    draw();
    const clock = document.querySelector(".tbclock") as HTMLElement;
    const tiff = document.querySelector('[aria-label^="Ask or tell Tiff"]') as HTMLElement;
    expect(clock.closest(".tbr")).not.toBeNull();
    expect(clock.compareDocumentPosition(tiff) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(clock.querySelector("button")).toBeNull();
  });
});
