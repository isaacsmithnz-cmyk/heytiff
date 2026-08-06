import { render, screen } from "@testing-library/react";
import { DashboardHero } from "../hero";
import { heroStats } from "@/lib/dashboard/hero-stats";

/* The hero, now React rather than an HTML string built in shell/screens.ts.

   Two things the rewrite bought, both asserted below: the counters became real
   client-routed links instead of plain anchors that reloaded the whole app,
   and the viewer's name stopped needing to be hand-escaped into markup. */

const stats = (over: Partial<Parameters<typeof heroStats>[0]> = {}) =>
  heroStats({ chips: [], openTasks: 0, unreadNotices: 0, ...over });

const chip = (state: "bad" | "warn") => ({
  key: `k${state}`,
  kind: "rego" as const,
  state,
  label: "Rego expired",
  subject: "Hilux",
  href: "/dashboard/assets",
  urgency: 0,
});

const draw = (s: ReturnType<typeof heroStats>) =>
  render(<DashboardHero greeting="Good morning" firstName="Isaac" date="Wed 5 Aug" stats={s} />);

describe("the hero", () => {
  it("greets by name and dates the day", () => {
    draw(stats());
    // the <br> between them means no space in textContent — as in the original
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Good morning,Isaac.");
    expect(screen.getByText("Wed 5 Aug")).toBeInTheDocument();
  });

  it("renders the name as TEXT, not markup", () => {
    /* The builder this replaced pushed the name through
       `dangerouslySetInnerHTML` and hand-escaped it, with a comment and a test
       suite about that hazard. React escapes by construction — the hazard is
       gone rather than guarded. */
    const { container } = render(
      <DashboardHero
        greeting="Good morning"
        firstName={'<img src=x onerror="alert(1)">'}
        date="Wed 5 Aug"
        stats={stats()}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("<img src=x");
  });
});

describe("the counters", () => {
  it("are client-routed links, not plain anchors", () => {
    /* THE POINT OF THE REWRITE. As raw `<a href>` every door out of the
       most-visited screen in the app tore down the shell and rebuilt it. Next's
       Link renders an anchor too, so the tell is the prefetch attribute it
       adds — a bare <a> has none. */
    draw(stats({ chips: [chip("bad")], openTasks: 2 }));
    const urgent = screen.getByRole("link", { name: /Urgent/ });
    expect(urgent).toHaveAttribute("href", "/dashboard/action-required");
    expect(urgent.tagName).toBe("A");
  });

  it("dims a counter that has nothing in it", () => {
    // a clear day should read as calm, not as four lit-up badges saying nothing
    const { container } = draw(stats({ chips: [chip("bad")] }));
    const zeroes = container.querySelectorAll(".hstat.zero");
    // urgent has one; tasks / attention / noticeboard are all empty
    expect(zeroes).toHaveLength(3);
  });

  it("collapses to one statement when everything is zero", () => {
    // four zeroes are still four things to read
    const { container } = draw(stats());
    expect(screen.getByText("All clear")).toBeInTheDocument();
    expect(screen.getByText("Nothing needs you right now")).toBeInTheDocument();
    expect(container.querySelectorAll(".hstat")).toHaveLength(0);
  });

  it("keeps the tasks counter an in-page jump", () => {
    /* Tasks live on this very screen, so its tile scrolls rather than
       navigating — the one href here that is an anchor, not a route. */
    draw(stats({ openTasks: 3 }));
    expect(screen.getByRole("link", { name: /Tasks/ })).toHaveAttribute("href", "#dash-tasks");
  });
});
