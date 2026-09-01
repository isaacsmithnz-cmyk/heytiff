/* One envelope, seven letters.

   EMAIL IS NOT THE APP AND CANNOT BORROW FROM IT. No stylesheet, no cascade
   worth relying on, no SVG (Gmail strips it), no webfont (Gmail ignores it),
   no flexbox in Outlook. So the app's look is rebuilt here out of the only
   things that survive: nested tables, inline styles, and a PNG. Everything
   below is the `.card2` language — white card, hairline, 24px corner, ink
   heading, `--gray700` body, `--q` footnote — expressed in the 1999 subset.

   WHY ONE SHELL AND NOT SEVEN FILES. Auth0 stores each template's HTML
   separately, so seven copies of the chrome is the default outcome, and the
   day the logo moves six of them silently keep the old one. The chrome is
   written once; a template supplies only what it actually says.

   THE LIGHT LAW, RESTATED FOR MAIL CLIENTS. HeyTiff has no dark half
   (globals.css says so out loud). Mail clients invert light emails on their
   own unless told not to, which would put the ink wordmark on ink. The two
   `color-scheme` declarations are that instruction — they are not decoration
   and must not be tidied away.

   NO MONO FACE, HERE EITHER. A verification code is the one place every
   other product reaches for a monospace, and the ban is app-wide. The codes
   below are Jakarta at size with wide letter-spacing, which is what makes
   them scannable — the face was never doing that work. */

import { BRAND, WHITE } from "./palette.ts";
import type { BrandAssets } from "./assets.ts";

/* Jakarta first for the clients that honour @font-face (Apple Mail, iOS),
   then the system stack everyone else lands on. Declared as one string
   because it is repeated onto every element — mail clients do not inherit
   font-family reliably through tables. */
const FONT =
  "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** The lockup's aspect is 1123x256; 158x36 is the kit's minimum lockup width
    cleared with room, at the same height the sign-in widget uses. */
const LOGO_W = 158;
const LOGO_H = 36;

export type Letter = {
  /** The line the inbox shows beside the subject before anything is opened.
      Not visible in the body — a second sentence there would be the design
      failing to explain itself. */
  preheader: string;
  heading: string;
  /** Paragraphs. Liquid is allowed; HTML is not escaped, so keep it to text. */
  body: string[];
  /** The one thing to press. Omitted where the letter has nothing to do. */
  action?: { label: string; href: string };
  /** A code to read off the screen, in place of an action. */
  code?: string;
  /** Facts under the action — an expiry, a consequence, what to do if this
      wasn't you. Kept because they are rules you cannot see anywhere else. */
  footnotes?: string[];
};

export function renderLetter(letter: Letter, assets: BrandAssets): string {
  const { preheader, heading, body, action, code, footnotes = [] } = letter;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(heading)}</title>
<style type="text/css">
  @font-face {
    font-family: 'Plus Jakarta Sans';
    font-style: normal;
    font-weight: 200 800;
    font-display: swap;
    src: url(${assets.font}) format('woff2');
  }
  :root { color-scheme: light; supported-color-schemes: light; }
  body { margin:0 !important; padding:0 !important; width:100% !important; }
  /* Outlook.com and some webmail rewrite links to their own blue */
  a { color: ${BRAND.ink}; }
  /* THE CARD MUST BE TOLD TO NARROW, AND ONLY !important DOES IT. A mail
     table needs the fixed width=560 attribute for Outlook, which ignores
     max-width — and that fixed width is exactly what runs a 560px card off
     a 375px phone. Both it and the inline width lose to the override below;
     dropping only the corner and the padding leaves the letter overflowing,
     which is what it did. Below 600 the card goes full-bleed, so the corner
     would be cut regardless. */
  @media only screen and (max-width: 600px) {
    .ht-card { width: 100% !important; max-width: 100% !important; border-radius: 0 !important; }
    .ht-pad { padding-left: 24px !important; padding-right: 24px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; width:100%; background-color:${BRAND.surface};">
<div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.surface};">
  <tr>
    <td align="center" style="padding:40px 12px;">
      <table role="presentation" class="ht-card" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px; max-width:560px; background-color:${WHITE}; border:1px solid ${BRAND.line}; border-radius:24px;">

        <tr>
          <td class="ht-pad" align="center" style="padding:40px 44px 8px 44px;">
            <img src="${assets.lockup}" width="${LOGO_W}" height="${LOGO_H}" alt="HeyTiff" style="display:block; width:${LOGO_W}px; height:${LOGO_H}px; border:0; outline:none; text-decoration:none;" />
          </td>
        </tr>

        <tr>
          <td class="ht-pad" style="padding:28px 44px 0 44px; font-family:${FONT}; font-size:24px; line-height:31px; font-weight:800; letter-spacing:-0.02em; color:${BRAND.ink};">
            ${heading}
          </td>
        </tr>

        <tr>
          <td class="ht-pad" style="padding:14px 44px 0 44px; font-family:${FONT}; font-size:15px; line-height:24px; font-weight:500; color:${BRAND.body};">
            ${body.map((p) => `<p style="margin:0 0 12px 0;">${p}</p>`).join("\n            ")}
          </td>
        </tr>

        ${code ? codeBlock(code) : ""}
        ${action ? actionBlock(action) : ""}
        ${footnotes.length ? footnoteBlock(footnotes) : ""}
        ${action ? fallbackBlock(action) : ""}

        <tr>
          <td class="ht-pad" style="padding:8px 44px 36px 44px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top:1px solid ${BRAND.line}; font-size:0; line-height:0;">&nbsp;</td></tr>
            </table>
            <p style="margin:18px 0 0 0; font-family:${FONT}; font-size:12px; line-height:18px; font-weight:600; color:${BRAND.quiet};">
              Sent by HeyTiff — operations &amp; compliance for trades businesses.
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/* THE BUTTON IS A TABLE, and the corner is 10px to match the sign-in
   widget's — Auth0 caps `button_border_radius` at 10, so the mail matches
   the screen rather than the app's own 16px. Outlook desktop ignores
   border-radius and draws it square; that is a squarer button, not a broken
   one, and is the reason no VML fallback is worth its weight here. */
function actionBlock(action: { label: string; href: string }): string {
  return `<tr>
          <td class="ht-pad" style="padding:14px 44px 0 44px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="${BRAND.ink}" style="background-color:${BRAND.ink}; border-radius:10px;">
                  <a href="${action.href}" style="display:inline-block; padding:14px 26px; font-family:${FONT}; font-size:14px; line-height:14px; font-weight:700; color:${WHITE}; text-decoration:none; border-radius:10px;">${escapeHtml(action.label)}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
}

/* A SECOND ROUTE, NOT A HINT. Buttons get stripped by corporate filters and
   by plain-text views, and a person staring at a mail with no way through
   has no other move. This is the link itself, not an explanation of the
   button.

   IT GOES LAST, under the footnotes. Sat directly beneath the button it
   pushed the rules that actually matter — what expires, what happens if this
   wasn't you — into the middle of the letter, behind a URL almost nobody
   needs. Least-wanted, last. */
function fallbackBlock(action: { label: string; href: string }): string {
  return `<tr>
          <td class="ht-pad" style="padding:20px 44px 0 44px; font-family:${FONT}; font-size:12px; line-height:19px; font-weight:600; color:${BRAND.quiet};">
            Or paste this into your browser:<br />
            <a href="${action.href}" style="color:${BRAND.quiet}; text-decoration:underline; word-break:break-all;">${action.href}</a>
          </td>
        </tr>`;
}

/* WIDE-TRACKED JAKARTA, NOT A MONO FACE. The ban is app-wide and this is
   where it is most tempting to break. Letter-spacing does the separating. */
function codeBlock(code: string): string {
  return `<tr>
          <td class="ht-pad" style="padding:14px 44px 0 44px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.surface}; border-radius:14px;">
              <tr>
                <td align="center" style="padding:22px 16px; font-family:${FONT}; font-size:30px; line-height:36px; font-weight:800; letter-spacing:0.22em; text-indent:0.22em; color:${BRAND.ink};">${code}</td>
              </tr>
            </table>
          </td>
        </tr>`;
}

function footnoteBlock(notes: string[]): string {
  return `<tr>
          <td class="ht-pad" style="padding:22px 44px 0 44px; font-family:${FONT}; font-size:13px; line-height:20px; font-weight:500; color:${BRAND.quiet};">
            ${notes.map((n) => `<p style="margin:0 0 8px 0;">${n}</p>`).join("\n            ")}
          </td>
        </tr>`;
}

/** Used ONLY where the value cannot carry Liquid — the `<title>` and the
    button label. Body copy, headings and hrefs go through raw on purpose:
    `{{ url }}` and `{{ user.email }}` have to reach Auth0 unmangled, and
    every string in `templates.ts` is ours, not a user's. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
