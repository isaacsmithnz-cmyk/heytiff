import { render, screen } from "@testing-library/react";
import { Plate, plateHtml } from "../plate";

/* The two halves have to stay interchangeable: profile.ts renders the string
   twin into the same card the register renders the component into, so anything
   that is true of one below is asserted of the other. */

describe("Plate", () => {
  it("uppercases whatever was typed", () => {
    render(<Plate plate="mkt482" />);
    expect(screen.getByText("MKT482")).toBeInTheDocument();
  });

  it("trims stray whitespace off the plate", () => {
    render(<Plate plate="  1TG 4ZR  " />);
    expect(screen.getByText("1TG 4ZR")).toBeInTheDocument();
  });

  it("shows the state tag when one is recorded", () => {
    const { container } = render(<Plate plate="MKT482" state="vic" />);
    expect(container.querySelector(".au-plate .st")?.textContent).toBe("VIC");
  });

  it("renders no tag at all rather than an empty one", () => {
    // AU plates are only unique within a state, but plenty of records simply
    // don't have it — a blank divider would read as missing data, not absent data
    for (const state of [undefined, null, "", "   "]) {
      const { container } = render(<Plate plate="MKT482" state={state} />);
      expect(container.querySelector(".st")).toBeNull();
    }
  });

  it("carries the size as a class, defaulting to md", () => {
    const { container: md } = render(<Plate plate="MKT482" />);
    expect(md.querySelector(".au-plate")?.className).toBe("au-plate");
    const { container: sm } = render(<Plate plate="MKT482" size="sm" />);
    expect(sm.querySelector(".au-plate")?.className).toBe("au-plate sm");
  });

  it("is styled by an UNSCOPED class, because fleet modals portal outside .fg", () => {
    const { container } = render(<Plate plate="MKT482" />);
    expect(container.querySelector(".au-plate")).not.toBeNull();
  });
});

describe("plateHtml", () => {
  it("matches the component: uppercased, tag only when given", () => {
    expect(plateHtml("mkt482")).toBe('<span class="au-plate">MKT482</span>');
    expect(plateHtml("MKT482", "VIC")).toBe(
      '<span class="au-plate">MKT482<span class="st">VIC</span></span>',
    );
    expect(plateHtml("MKT482", "  ")).toBe('<span class="au-plate">MKT482</span>');
    expect(plateHtml("MKT482", null, "sm")).toBe('<span class="au-plate sm">MKT482</span>');
  });

  /* A plate is typed by whoever added the vehicle, and this string lands on a
     staff card their MANAGER opens — the same shape as the stored XSS the
     dashboard hero had. So it escapes, and the test proves it rather than
     trusting the call site to remember. */
  it("escapes a plate carrying markup", () => {
    // note the uppercasing runs first, so the payload arrives shouting — the
    // escaping is what matters and it is unaffected
    const html = plateHtml(`<img src=x onerror="alert(1)">`);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain("&lt;IMG");
    expect(html).toContain("&quot;");
  });

  it("escapes the state tag too — it is user-chosen data as well", () => {
    const html = plateHtml("MKT482", `<script>alert(1)</script>`);
    expect(html).not.toMatch(/<script>/i);
    expect(html).toContain("&lt;SCRIPT&gt;");
  });

  it("cannot be tricked into closing its own span with a quote", () => {
    expect(plateHtml(`"><script>x</script>`)).not.toMatch(/<script>/i);
  });
});
