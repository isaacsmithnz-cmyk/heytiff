import { render, screen } from "@testing-library/react";
import { NO_BRAND, type OrgBrand } from "@/lib/org/brand";
import { BrandMark, Letterhead } from "../letterhead";

/* The two shapes the company's face takes on a surface a customer receives.

   What these really pin is the FALLBACK, in both directions. Before this, the
   handover sheet carried no business name, the live link said "HeyTiff" and
   the printed copy said "HeyTiff Design Studio" — the name of the software, on
   documents an installer sends. Now the installer's name displaces those, but
   only when there is one: an org that has never opened the Organisation page
   must read exactly as it did. */

const FULL: OrgBrand = {
  name: "Smith Air Conditioning",
  logoUrl: "https://signed.example/logo.png",
  abn: "51824753556",
  phone: "(03) 9000 0000",
  email: "office@smithair.com.au",
  website: "smithair.com.au",
};

describe("Letterhead", () => {
  it("prints the name and the contact line, with the ABN grouped", () => {
    render(<Letterhead brand={FULL} />);
    expect(screen.getByText("Smith Air Conditioning")).toBeInTheDocument();
    expect(
      screen.getByText(
        "ABN 51 824 753 556 · (03) 9000 0000 · office@smithair.com.au · smithair.com.au"
      )
    ).toBeInTheDocument();
  });

  /* The whole line is ONE text node. Rendered as spans with separators
     between them, a middot can wrap onto a line by itself — which is the
     classic way a letterhead row breaks. */
  it("writes the contact line as one string, not a row of separators", () => {
    const { container } = render(<Letterhead brand={FULL} />);
    const line = container.querySelector(".org-lh-contact")!;
    expect(line.children).toHaveLength(0);
  });

  it("stands the initials in when there is no logo", () => {
    const { container } = render(<Letterhead brand={{ ...FULL, logoUrl: null }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".org-initials")).toHaveTextContent("SA");
  });

  /* The logo is decoration for a label already on screen — described, a
     screen reader says the business name twice. */
  it("leaves the logo undescribed, because the name is beside it as text", () => {
    const { container } = render(<Letterhead brand={FULL} />);
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("drops the contact line rather than printing an empty one", () => {
    const { container } = render(
      <Letterhead brand={{ ...NO_BRAND, name: "Smith Air" }} />
    );
    expect(container.querySelector(".org-lh-contact")).toBeNull();
  });

  /* THE BAND COLLAPSES. A business that has set neither a name nor a logo gets
     the sheet it had before — not a frame with nothing in it. */
  it("renders nothing at all for a business that has told us nothing", () => {
    const { container } = render(<Letterhead brand={NO_BRAND} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("BrandMark", () => {
  it("shows the installer, not the platform", () => {
    render(<BrandMark brand={FULL} fallback="HeyTiff" />);
    expect(screen.getByText("Smith Air Conditioning")).toBeInTheDocument();
    expect(screen.queryByText("HeyTiff")).not.toBeInTheDocument();
  });

  it("falls back to the surface's own wording when there is no brand", () => {
    render(<BrandMark brand={NO_BRAND} fallback="HeyTiff" />);
    expect(screen.getByText("HeyTiff")).toBeInTheDocument();
  });

  /* A logo with no name is still a brand — the mark shows it alone rather
     than falling through to the platform. */
  it("shows a logo even when the business has no name yet", () => {
    const { container } = render(
      <BrandMark brand={{ ...NO_BRAND, logoUrl: "https://x/y.png" }} fallback="HeyTiff" />
    );
    expect(container.querySelector("img")).toBeInTheDocument();
    expect(screen.queryByText("HeyTiff")).not.toBeInTheDocument();
  });

  /* THE PLATE IS NOT DECORATION — it is the only reason a customer can see
     this logo at all. Every surface asking for this mark is a dark bar
     (#0b0d12 on the share link), and plenty of businesses ink their logo in
     black or navy: unplated, Diamond Air's real 3780x1064 artwork is simply
     not there. It used to be a rule in studio.css scoped to `.ds-live-brand`,
     which meant any new dark surface adopting BrandMark silently got no plate.
     The component carries it now, so this asserts the class rather than
     trusting a stylesheet nobody will read.

     `:not(.org-initials)` in the CSS is why the initials case is checked too —
     that stand-in brings its own background and must not be double-plated. */
  it("plates the logo, because every surface that asks for this mark is dark", () => {
    const { container } = render(
      <BrandMark brand={{ ...NO_BRAND, logoUrl: "https://x/y.png" }} fallback="HeyTiff" />
    );
    expect(container.querySelector("img")).toHaveClass("org-mark-logo", "org-plate");
  });

  it("still plates by class when the logo is initials, which opt out in CSS", () => {
    const { container } = render(
      <BrandMark brand={{ ...NO_BRAND, name: "Smith Air" }} fallback="HeyTiff" />
    );
    expect(container.querySelector(".org-initials")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});
