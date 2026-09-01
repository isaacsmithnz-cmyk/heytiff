/* Seeing the sign-in screen before Auth0 will show it to you.

   THE PROBLEM THIS SOLVES. Two of the three things the push script sends are
   invisible until they are live: the theme renders only inside Auth0's own
   widget, and the page template needs a custom domain before Auth0 will
   accept it at all. So the entire sign-in design could only be reviewed by
   pushing it to the real tenant and signing out — which is reviewing it in
   front of customers.

   WHAT IS REAL HERE AND WHAT IS NOT, because a preview that blurs that is
   worse than none:

     REAL  The page template, verbatim — its CSS, its glow, its footer, its
           layout. Only the two `auth0:` tags are swapped out.
     REAL  Every colour, radius, font size and logo below is READ FROM THE
           THEME OBJECT, the same one that gets PATCHed — and the subtitle and
           logo alt text from the prompt text that gets PUT. Nothing is
           restated, so this cannot drift from what ships.
     MOCK  The widget's MARKUP. Auth0 draws that and does not publish it, so
           the fields, labels and buttons here are a stand-in of the login
           prompt — right shapes and right dress, not Auth0's exact DOM.

   Read it for the DESIGN — is the card the right white on the right grey, is
   the button ink, does the logo sit right, does the glow read. Do not read it
   for pixel-exact widget internals; those are Auth0's.

   THE LIQUID SUBSTITUTION IS NOT A LIQUID ENGINE. It handles the handful of
   tags this one template uses and nothing else. If the template grows a loop
   or a filter, this will pass it through untouched rather than pretend. */

import type { heytiffTheme } from "./theme";
import type { BrandAssets } from "./assets";
import { LOGIN_PROMPT_TEXT } from "./prompts.ts";

type Theme = ReturnType<typeof heytiffTheme>;

/** Auth0 sizes every piece of text as a percentage of `reference_text_size`.
    Resolved here so the preview inherits the same arithmetic the widget does
    rather than a second set of pixel values. */
const px = (theme: Theme, size: number) =>
  `${((theme.fonts.reference_text_size * size) / 100).toFixed(2)}px`;

export function signInPreview(
  template: string,
  theme: Theme,
  assets: BrandAssets,
): string {
  return template
    .replace(/\{%\s*assign[^%]*%\}/g, "")
    .replace(/\{\{\s*locale\s*\}\}/g, "en")
    .replace(/\{\{\s*resolved_dir\s*\}\}/g, "ltr")
    /* the template's own `{% if tenant.support_url %}` — shown, since a real
       tenant has one and the footer's spacing depends on it being there */
    .replace(/\{%\s*if tenant\.support_url\s*%\}/g, "")
    .replace(/\{%\s*endif\s*%\}/g, "")
    .replace(/\{\{\s*tenant\.support_url\s*\}\}/g, "#")
    .replace(/\{%-?\s*auth0:head\s*-?%\}/, widgetStyles(theme, assets))
    .replace(/\{%-?\s*auth0:widget\s*-?%\}/, widgetMarkup(theme));
}

/* Auth0's widget stylesheet, rebuilt from the theme values. Every declaration
   below reads a field that is actually sent — change the theme and this
   changes with it. */
function widgetStyles(theme: Theme, assets: BrandAssets): string {
  const c = theme.colors;
  const b = theme.borders;
  return `<meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign in to HeyTiff</title>
    <style>
      /* A STAND-IN FOR A RULE AUTH0 DOES NOT PUBLISH. Written as flex-centre
         because that is what the class is for; the template states its own
         flex-direction: column on top, which is the point — if Auth0 ships
         a row, the template still stacks. Do not read the exact metrics here
         as Auth0's. */
      ._widget-auto-layout { box-sizing: border-box; display: flex; align-items: center; justify-content: center; min-height: 100%; padding: 40px 16px; }
      .ht-w {
        width: 400px; max-width: 100%; box-sizing: border-box;
        padding: 40px 40px 32px;
        background: ${c.widget_background};
        border: ${b.widget_border_weight}px solid ${c.widget_border};
        border-radius: ${b.widget_corner_radius}px;
        ${b.show_widget_shadow ? "box-shadow: 0 8px 24px -14px rgba(10,12,20,.25);" : ""}
        text-align: ${theme.widget.header_text_alignment};
      }
      .ht-w img.logo { display: block; height: ${theme.widget.logo_height}px; width: auto; margin: 0 auto 26px; }
      .ht-w h1 {
        margin: 0 0 6px;
        font-size: ${px(theme, theme.fonts.title.size)};
        font-weight: ${theme.fonts.title.bold ? 800 : 500};
        letter-spacing: -.02em;
        color: ${c.header};
      }
      .ht-w .sub {
        margin: 0 0 26px;
        font-size: ${px(theme, theme.fonts.subtitle.size)};
        font-weight: ${theme.fonts.subtitle.bold ? 700 : 500};
        color: ${c.body_text};
      }
      .ht-w form { text-align: left; }
      .ht-w label {
        display: block; margin: 0 0 6px;
        font-size: ${px(theme, theme.fonts.input_labels.size)};
        font-weight: ${theme.fonts.input_labels.bold ? 700 : 500};
        color: ${c.input_labels_placeholders};
      }
      .ht-w input {
        display: block; width: 100%; box-sizing: border-box;
        margin: 0 0 18px; padding: 13px 14px;
        font-family: inherit;
        font-size: ${px(theme, theme.fonts.body_text.size)};
        font-weight: 500;
        color: ${c.input_filled_text};
        background: ${c.input_background};
        border: ${b.input_border_weight}px solid ${c.input_border};
        border-radius: ${b.input_border_radius}px;
      }
      .ht-w input::placeholder { color: ${c.input_labels_placeholders}; }
      .ht-w input:focus { outline: 2px solid ${c.base_focus_color}; outline-offset: 1px; border-color: ${c.base_focus_color}; }
      .ht-w button {
        display: block; width: 100%;
        margin: 6px 0 0; padding: 14px 16px;
        font-family: inherit;
        font-size: ${px(theme, theme.fonts.buttons_text.size)};
        font-weight: ${theme.fonts.buttons_text.bold ? 700 : 500};
        color: ${c.primary_button_label};
        background: ${c.primary_button};
        border: ${b.button_border_weight}px solid ${c.primary_button};
        border-radius: ${b.button_border_radius}px;
        cursor: pointer;
      }
      .ht-w button.secondary {
        color: ${c.secondary_button_label};
        background: ${c.widget_background};
        border-color: ${c.secondary_button_border};
      }
      .ht-w a {
        color: ${c.links_focused_components};
        font-size: ${px(theme, theme.fonts.links.size)};
        font-weight: ${theme.fonts.links.bold ? 700 : 500};
        text-decoration: ${theme.fonts.links_style === "underlined" ? "underline" : "none"};
        text-underline-offset: 2px;
      }
      .ht-w .row { display: flex; justify-content: flex-end; margin: -8px 0 20px; }
      .ht-w .foot { margin: 22px 0 0; text-align: center; font-size: ${px(theme, theme.fonts.body_text.size)}; font-weight: 500; color: ${c.body_text}; }
      .ht-w .err {
        margin: 0 0 18px; padding: 11px 13px;
        border-radius: ${b.input_border_radius}px;
        background: rgba(200,26,65,.09);
        font-size: ${px(theme, theme.fonts.body_text.size)};
        font-weight: 600;
        color: ${c.error};
      }
      /* Only so the reviewer can see what the theme does to an error and to
         the social row — neither is on screen in the normal state. */
      .ht-note { margin: 26px auto 0; max-width: 400px; text-align: center; font-size: 12px; font-weight: 600; color: ${c.input_labels_placeholders}; }
    </style>
    <link rel="icon" href="${assets.favicon}" />`;
}

function widgetMarkup(theme: Theme): string {
  return `<main class="ht-w">
      <img class="logo" src="${theme.widget.logo_url}" alt="${LOGIN_PROMPT_TEXT.login.logoAltText}" />
      <h1>Welcome</h1>
      <p class="sub">${LOGIN_PROMPT_TEXT.login.description}</p>
      <form onsubmit="return false">
        <label for="e">Email address</label>
        <input id="e" type="email" placeholder="you@company.com.au" />
        <label for="p">Password</label>
        <input id="p" type="password" value="a-password" />
        <div class="row"><a href="#">Forgot password?</a></div>
        <button type="submit">Continue</button>
      </form>
      <p class="foot">Don't have an account? <a href="#">Sign up</a></p>
    </main>
    <p class="ht-note">The card above is a stand-in for Auth0's login prompt — the dress is the real theme, the markup is not Auth0's. Everything around it is the page template verbatim.</p>`;
}

/** The states a reviewer would otherwise never see: an error, and a filled
    field. Rendered as a second page rather than crowding the first. */
export function signInStatesPreview(
  template: string,
  theme: Theme,
  assets: BrandAssets,
): string {
  return signInPreview(template, theme, assets)
    .replace(
      '<form onsubmit="return false">',
      '<div class="err">Wrong email or password.</div>\n      <form onsubmit="return false">',
    )
    .replace(
      '<button type="submit">Continue</button>',
      '<button type="submit">Continue</button>\n        <button type="button" class="secondary" style="margin-top:10px">Continue with Google</button>',
    )
    .replace(
      "The card above is a stand-in",
      "Error state and a secondary button. The card above is a stand-in",
    );
}
