/* The page around the widget — `PUT /api/v2/branding/templates/universal-login`.

   THIS ONE IS GATED, AND THE GATE IS NOT OURS. Auth0 refuses a page template
   on a tenant with no custom domain: "To use customized page templates, you
   must configure a Custom Domain for your tenant." Everything in `theme.ts`
   lands without one. This file is what becomes possible the day
   auth.heytiff.<tld> resolves, and the push script skips it — loudly, by
   name — until then. It is written now so the domain is the only thing left
   to do, not the start of a second job.

   IT ADDS A GROUND, NOT A SECOND LOGO. The theme already puts the lockup at
   the top of the widget. A page header with the same mark 40px above it is
   the commonest way a login page ends up wearing its logo twice, so the
   template deliberately contributes only what a widget cannot: the page's
   own light, the font for text outside the widget, and a footer.

   THE GLOW IS THE APP'S OWN, AT PAGE SCALE. `.fg .side .glow` in shell.css
   is a 250px teal radial at .16, inside a narrow dark rail. Spread over a
   whole light page that alpha stops being atmosphere and tints the ground,
   so it is taken to .11 — the same values the front door uses
   (`app/page.tsx`), so the two screens either side of Auth0 are lit
   identically. Decorative divs: they announce nothing and are
   pointer-transparent.

   THE TWO LIQUID TAGS ARE LOAD-BEARING. `auth0:head` carries everything that
   renders the prompt; `auth0:widget` is the prompt. Auth0 rejects a template
   missing either, and `__tests__/page-template.test.ts` asserts both survive
   any edit to this file. */

import { BRAND } from "./palette.ts";
import type { BrandAssets } from "./assets.ts";

/** Auth0's own cap. Asserted in the test rather than trusted. */
export const TEMPLATE_MAX_LENGTH = 102_400;

export function heytiffPageTemplate(assets: BrandAssets): string {
  return `<!DOCTYPE html>
{% assign resolved_dir = dir | default: "auto" %}
<html lang="{{locale}}" dir="{{resolved_dir}}">
  <head>
    {%- auth0:head -%}
    <link rel="icon" href="${assets.favicon}" />
    <style>
      @font-face {
        font-family: 'Plus Jakarta Sans';
        font-style: normal;
        font-weight: 200 800;
        font-display: swap;
        src: url(${assets.font}) format('woff2');
      }
      /* No dark half exists — see globals.css. Saying so stops the browser
         flipping native controls underneath a light widget. */
      :root { color-scheme: light; }
      html, body { height: 100%; }
      body {
        margin: 0;
        background: ${BRAND.surface};
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .ht-glow {
        position: fixed;
        top: -220px;
        left: 50%;
        width: min(620px, 90vw);
        height: min(620px, 90vw);
        transform: translateX(-50%);
        border-radius: 50%;
        background: ${BRAND.teal};
        filter: blur(140px);
        opacity: .11;
        pointer-events: none;
        z-index: 0;
      }
      .ht-glow.b {
        top: auto;
        bottom: -280px;
        background: ${BRAND.blue};
        opacity: .07;
      }
      /* The widget sits above the light. Auth0 owns everything inside it. */
      .ht-glow ~ * { position: relative; z-index: 1; }
      .ht-foot {
        position: relative;
        z-index: 1;
        padding: 8px 16px 32px;
        text-align: center;
        font-size: 12px;
        font-weight: 600;
        color: ${BRAND.quiet};
      }
      .ht-foot a { color: ${BRAND.quiet}; text-decoration: underline; text-underline-offset: 2px; }
      @media (prefers-reduced-motion: no-preference) {
        .ht-glow { transition: opacity .6s ease; }
      }
    </style>
  </head>
  <body class="_widget-auto-layout">
    <div class="ht-glow" aria-hidden="true"></div>
    <div class="ht-glow b" aria-hidden="true"></div>
    {%- auth0:widget -%}
    <div class="ht-foot">
      HeyTiff — operations &amp; compliance for trades businesses{% if tenant.support_url %} · <a href="{{ tenant.support_url }}">Get help</a>{% endif %}
    </div>
  </body>
</html>`;
}
