import { heroHtml } from "../screens";

/* The hero reaches the DOM through dangerouslySetInnerHTML (home.tsx), so every
   value that came from a person has to be escaped on the way in. It is the last
   screen that needs this guarantee: the staff card and the organisation profile
   made it too, until both became React.

   The sharp edge used to be the action band, whose sub-line carried a chip's
   label and subject — a licence type name, a vehicle's plate, the insurer, all
   user-entered, and a licence anyone may add to their own card lands on a
   manager's dashboard. That band is gone; what a person still types into this
   hero is their own name, and the guarantee has to hold for it too. */

const PAYLOAD = `<img src=x onerror="alert(1)">`;

describe("heroHtml — escaping", () => {
  it("escapes the viewer's own name in the greeting", () => {
    const html = heroHtml({
      greeting: "Good morning",
      firstName: `<script>alert(1)</script>`,
      date: "Fri 25 Jul",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes a preferred name that arrives as markup, not text", () => {
    const html = heroHtml({ greeting: "Good morning", firstName: PAYLOAD, date: "Fri 25 Jul" });
    expect(html).not.toContain(PAYLOAD);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("still renders the ordinary case unchanged", () => {
    const html = heroHtml({ greeting: "Good morning", firstName: "Isaac", date: "Fri 25 Jul" });
    expect(html).toContain("Good morning,");
    expect(html).toContain("<span>Isaac.</span>");
    expect(html).toContain("Welcome back.");
  });

  /* The band is deleted, not merely unused: an option nobody passes is an
     option someone re-wires later, and this hero is the one place in the app
     where a string reaches the DOM unparsed. */
  it("has no action band left under the greeting", () => {
    const html = heroHtml({ greeting: "Good morning", firstName: "Isaac", date: "Fri 25 Jul" });
    expect(html).not.toContain("hact");
    expect(html).not.toContain("needs your attention");
  });
});

/* The hero's two columns: the greeting on the left, four counters on the right.
   The counters are a separate block from the greeting, so the static screen
   (homeHtml, no stats) has to keep rendering the greeting alone. */
describe("heroHtml — the counters column", () => {
  const STATS = [
    { key: "urgent", icon: "alert", label: "Urgent", count: 2, href: "/dashboard/action-required", tone: "bad" },
    { key: "tasks", icon: "listCheck", label: "Tasks", count: 0, href: "#dash-tasks", tone: "blue" },
  ];

  it("renders a tile per stat, with its count and label", () => {
    const html = heroHtml({
      greeting: "Good evening",
      firstName: "Isaac",
      date: "Fri 25 Jul",
      stats: STATS,
    });
    expect(html).toContain('class="hstats"');
    expect(html).toContain("Urgent");
    expect(html).toContain('<b class="hs-n">2</b>');
    expect(html).toContain('href="#dash-tasks"');
  });

  it("dims a tile at zero and leaves a counted one lit", () => {
    const html = heroHtml({
      greeting: "Good evening",
      firstName: "Isaac",
      date: "Fri 25 Jul",
      stats: STATS,
    });
    expect(html).toContain('class="hstat blue zero"');
    expect(html).toContain('class="hstat bad"');
  });

  it("omits the column entirely when there are no stats", () => {
    const html = heroHtml({ greeting: "Good evening", firstName: "Isaac", date: "Fri 25 Jul" });
    expect(html).not.toContain("hstats");
  });

  it("replaces all four tiles with one statement when every counter is zero", () => {
    const html = heroHtml({
      greeting: "Good evening",
      firstName: "Isaac",
      date: "Fri 25 Jul",
      stats: STATS.map((s) => ({ ...s, count: 0 })),
    });
    expect(html).toContain('class="hstats clear"');
    expect(html).toContain("All clear");
    expect(html).toContain("Nothing needs you right now");
    // the tiles are GONE, not merely dimmed
    expect(html).not.toContain("hstat ");
    expect(html).not.toContain("Urgent");
  });
});
