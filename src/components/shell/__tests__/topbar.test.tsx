import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { Topbar } from "../topbar";
import { CommandPaletteProvider } from "../command-palette-context";
import { fmtAuWeekdayDateLong, todayInAu } from "@/lib/au-dates";

/* THE HEADER (rule 2): the date and the time on the left, open tabs on the
   right, and Tiff's button after them until step 5 gives it its v2 home.

   THE BELL HAS GONE (decision 25). What it carried, the alerts, the
   reminders due with their Later and the work given to you with its Got it,
   is Home's To do (components/dashboard/home-todo), and its count sits on
   Home in the sidebar (./home-count). Its suite went with it; To do's and
   the count's pin what it did. */

/* The topbar carries the Tiff button, which reaches the note flow and its
   server actions — and "use server" modules cannot be imported into jsdom.
   Stubbed so this suite stays about the topbar; the button has its own. */
jest.mock("@/components/notes/tiff-button", () => ({
  TiffButton: () => <button aria-label="Ask or tell Tiff" />,
}));

jest.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: jest.fn() }) }));

const draw = () =>
  render(
    <CommandPaletteProvider>
      <Topbar today="2026-08-09" />
    </CommandPaletteProvider>,
  );

afterEach(cleanup);

describe("the Tiff button, and no bell", () => {
  it("sits in the header's end, and nothing rings beside it", async () => {
    draw();
    const tiff = document.querySelector('[aria-label^="Ask or tell Tiff"]') as HTMLElement;
    expect(tiff).not.toBeNull();
    expect(tiff.closest(".fr-headend")).not.toBeNull();
    expect(tiff.closest(".fr-headend")!.children).toHaveLength(1);
    expect(document.querySelector(".bell, .bell-panel")).toBeNull();
    expect(screen.queryByRole("button", { name: /needs you|nothing needs/i })).toBeNull();
    await act(async () => {});
  });
});

/* ── OPEN TABS (rules 10 and 11) ─────────────────────────────────────────
   The store's own rules are pinned in open-tabs.test; these pin what the
   header draws from it. */
describe("open tabs", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("puts the date and time first and the tabs after them, on the right", async () => {
    draw();
    const clock = document.querySelector(".tbclock") as HTMLElement;
    const tabs = screen.getByRole("tablist", { name: "Open tabs" });
    expect(clock.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async () => {});
  });

  it("names the tab for the page you're on, and offers no cross on the only one", async () => {
    draw();
    await waitFor(() => expect(screen.getByRole("tab", { name: "Home" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.queryByRole("button", { name: "Close Home" })).toBeNull();
  });

  it("opens Search in a new tab", async () => {
    draw();
    await waitFor(() => screen.getByRole("tab", { name: "Home" }));
    act(() => screen.getByRole("button", { name: "New tab" }).click());
    expect(screen.getByRole("tab", { name: "New tab" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Close Home" })).toBeInTheDocument();
  });
});

/* THE CLOCK.

   The date was a teal capsule inside the dashboard hero; it is chrome now, so
   every screen carries it and Home gets the space back. The interesting half
   is the time: a clock rendered into server markup and hydrated a minute later
   is a text mismatch, and a mismatch in a render body fails hydration for the
   whole tree. */
describe("the clock", () => {
  it("takes the day off the LIVE clock once hydrated, not the prop it was given", () => {
    /* The prop here is deliberately ancient. An app left open overnight has to
       roll over rather than insist it is still yesterday, so after hydration
       the date is derived from the same clock as the time — which is also why
       this cannot assert a hard-coded string. It did, once, and broke at
       midnight. The server's use of the prop is pinned by the renderToString
       test below, where `hydrated` is false. */
    render(
      <CommandPaletteProvider>
        <Topbar today="2020-01-01" />
      </CommandPaletteProvider>,
    );
    const clock = document.querySelector(".tbclock") as HTMLElement;
    expect(clock).not.toBeNull();
    expect(clock.querySelector("em")?.textContent).toBe(fmtAuWeekdayDateLong(todayInAu()));
    expect(clock.querySelector("em")?.textContent).not.toBe("Wednesday 1 January");
  });

  it("emits NO time on the server — the whole reason it is split", () => {
    /* renderToString is the only place this is observable: `useHydrated`
       reports true on a plain client render, so RTL alone would show a time
       and prove nothing. Asserted as "no h:mm am/pm anywhere in the markup"
       rather than on one element, so moving the clock can't quietly hide a
       regression. */
    const html = renderToString(
      <CommandPaletteProvider>
        <Topbar today="2026-08-09" />
      </CommandPaletteProvider>,
    );
    expect(html).toContain("Sunday 9 August");
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
    expect(clock.closest(".fr-head")).not.toBeNull();
    expect(clock.closest(".fr-headend")).toBeNull();
    expect(clock.compareDocumentPosition(tiff) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(clock.querySelector("button")).toBeNull();
  });
});
