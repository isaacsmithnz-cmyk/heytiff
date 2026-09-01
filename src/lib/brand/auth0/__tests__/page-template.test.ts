/* The page template is the one artefact nobody can preview until a custom
   domain exists, so it is the one most likely to be edited blind. Auth0
   rejects it outright if either Liquid tag is missing — a rejection that
   would arrive months from now, at the end of the push script, to whoever is
   setting the domain up.

   To see this fail: delete `{%- auth0:widget -%}` from page-template.ts. */

import { heytiffPageTemplate, TEMPLATE_MAX_LENGTH } from "../page-template";
import { brandAssets } from "../assets";
import { BRAND } from "../palette";

const assets = brandAssets("https://app.example.com");
const template = heytiffPageTemplate(assets);

describe("the tags Auth0 requires", () => {
  it.each(["auth0:head", "auth0:widget"])("carries %s", (tag) => {
    expect(template).toContain(`{%- ${tag} -%}`);
  });

  it("is inside Auth0's length cap", () => {
    expect(TEMPLATE_MAX_LENGTH).toBe(102_400);
    expect(template.length).toBeLessThan(TEMPLATE_MAX_LENGTH);
  });

  it("asks for the centred layout", () => {
    expect(template).toContain('class="_widget-auto-layout"');
  });
});

describe("the page it draws", () => {
  it("does not wear the logo twice", () => {
    // The THEME puts the lockup at the top of the widget. A page header with
    // the same mark above it is the classic duplication, and is why this
    // template contributes a ground and nothing else.
    expect(template).not.toContain(assets.lockup);
    expect(template).not.toContain(assets.chevron);
  });

  it("declares the light law rather than inheriting a guess", () => {
    expect(template).toContain("color-scheme: light");
    expect(template).toContain(`background: ${BRAND.surface}`);
  });

  it("keeps the glow decorative and out of the way", () => {
    expect(template).toContain("pointer-events: none");
    expect(template.match(/ht-glow[^"]*" aria-hidden="true"/g)).toHaveLength(2);
    // Behind everything, without needing to know what "everything" is.
    expect(template).toContain("z-index: -1");
  });

  it("never reaches into Auth0's DOM by structure", () => {
    // "The HTML structure of Universal Login pages is subject to change" —
    // so a sibling or descendant selector that lands on the widget is a
    // break waiting for their next build. The first version had
    // `.ht-glow ~ *`; z-index: -1 replaced it.
    // Comments stripped first — the note explaining WHY there is no such
    // selector names the selector, and matched itself.
    const css = template
      .slice(template.indexOf("<style>"), template.indexOf("</style>"))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/[~+>]\s*\*/);
    expect(css).not.toMatch(/\.ht-glow\s*[~+]/);
  });

  it("states its own stacking direction rather than inheriting a guess", () => {
    // Auth0 documents a footer after the widget but does not publish what
    // `_widget-auto-layout` sets. A row would stand the footer beside the
    // card. This is the one Auth0 class that is a documented layout hook
    // rather than a build-hashed one, so naming it is safe.
    expect(template).toContain("body._widget-auto-layout { flex-direction: column; }");
  });

  it("serves the font from our own origin, as a file", () => {
    expect(template).toContain(assets.font);
    expect(assets.font).toMatch(/\.woff2$/);
  });
});
