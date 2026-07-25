import { esc, field, input, profileIcon, selectP, textarea } from "../profile";

/* What survives of the string renderer: the form vocabulary the Organisation
   settings screen still builds itself from. The staff card's own markup tests
   moved to components/profile/__tests__ when it became React — these are the
   escaping and shape guarantees org-settings.ts depends on, and they matter
   precisely because that screen still reaches the DOM through
   dangerouslySetInnerHTML. */

describe("esc — values reach the DOM via dangerouslySetInnerHTML", () => {
  it("escapes the five dangerous characters", () => {
    expect(esc(`<script>"x"&'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;"
    );
  });

  it("escapes &amp; first so entities aren't double-broken", () => {
    expect(esc("Tom & Jerry")).toBe("Tom &amp; Jerry");
    expect(esc("<")).toBe("&lt;");
  });

  it("passes null and undefined through as an empty string", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });
});

describe("field helpers", () => {
  it("marks a required field and renders its help line", () => {
    const html = field("Trading name", input("trading_name"), { req: true, help: "Shown across HeyTiff" });
    expect(html).toContain('<span class="req">*</span>');
    expect(html).toContain('<span class="help">Shown across HeyTiff</span>');
  });

  it("cannot be broken out of by a stored value", () => {
    const html = input("trading_name", "e.g. Smith Air", "text", '" autofocus onfocus="alert(1)');
    expect(html).not.toContain('autofocus onfocus="alert(1)"');
    expect(html).toContain("&quot;");
  });

  it("marks the stored select option selected, and the placeholder otherwise", () => {
    expect(selectP("state", "Select a state", ["NSW", "VIC"], "VIC")).toContain(
      "<option selected>VIC</option>"
    );
    expect(selectP("state", "Select a state", ["NSW", "VIC"], null)).toContain(
      '<option value="" selected>Select a state</option>'
    );
  });

  it("escapes a textarea value so it can't close its own tag", () => {
    const html = textarea("notes", "Notes…", "</textarea><script>x</script>");
    expect(html).not.toContain("</textarea><script>");
    expect(html).toContain("&lt;/textarea&gt;");
  });
});

describe("profileIcon", () => {
  it("serves the icons org-settings asks for", () => {
    // `cam` and `upload` are local to this module; the rest fall through to
    // the shared set, which is where the staff card's glyphs now live
    for (const name of ["cam", "upload", "chev", "hexagon", "phone", "shield"]) {
      expect(profileIcon(name)).toContain("<path");
    }
  });

  it("returns an empty svg for a name nothing carries", () => {
    const svg = profileIcon("does-not-exist");
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("<path");
  });
});
