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
  });

  it("serves the font from our own origin, as a file", () => {
    expect(template).toContain(assets.font);
    expect(assets.font).toMatch(/\.woff2$/);
  });
});
