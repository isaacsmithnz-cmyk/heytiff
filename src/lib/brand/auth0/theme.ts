/* The sign-in widget's dress — `PATCH /api/v2/branding/themes/{id}`.

   THIS IS THE PART THAT WORKS TODAY. Auth0 gates the page TEMPLATE (arbitrary
   HTML around the widget) behind a custom domain; it does not gate the theme.
   So everything below lands on the default tenant domain with nothing bought
   and nothing DNS-verified: the logo, every colour, the real Jakarta face,
   the radii, the page ground. The template in `page-template.ts` is the part
   that waits.

   THE WIDGET IS A `.card2`, AND IS DRESSED AS ONE. HeyTiff's whole light
   surface is white cards on #F0F2F5 with a hairline and a generous corner —
   so the sign-in widget is not styled as its own thing, it is styled as the
   first card of the app. That is the entire design idea here; the values
   below are just where each of the app's numbers had to be rounded to fit
   Auth0's ranges.

   WHERE AUTH0'S RANGES BITE. Two of the app's radii do not fit:

     - buttons. `.newbtn` is 16px; `button_border_radius` caps at 10. Taken to
       10 rather than dropped to a pill, because a pill is a different shape,
       not a smaller one.
     - inputs. The app's fields are 11-14px; `input_border_radius` caps at 10.

   The widget corner (`widget_corner_radius`, 0-50) has room, so it is the
   app's tile corner exactly: 24.

   NO STATE COLOUR IS USED AS THE ACCENT, and no accent is used as a state.
   `success` and `error` are the measured `-t` text tokens from shell.css and
   appear nowhere else in this file. The accent — teal — is deliberately NOT
   the primary button: HeyTiff's primary action is ink with a white label
   (`.newbtn`), and teal is reserved for focus and the mark. */

import { BRAND, WHITE, inputBorderOnWhite } from "./palette.ts";
import type { BrandAssets } from "./assets.ts";

/** The tenant's default theme. Auth0 mints one per tenant and hands back its
    id; the push script reads the id rather than inventing one. */
export type Auth0Theme = ReturnType<typeof heytiffTheme>;

export function heytiffTheme(assets: BrandAssets) {
  return {
    borders: {
      /* capped at 10 — see the note above */
      button_border_radius: 10,
      button_border_weight: 1,
      buttons_style: "rounded",
      input_border_radius: 10,
      input_border_weight: 1,
      inputs_style: "rounded",
      /* The app's cards carry `0 8px 24px -14px rgba(10,12,20,.25)` — a lift,
         not a drop shadow. Auth0's is a boolean: on is closer to the app than
         a flat card floating on grey with no separation but the hairline. */
      show_widget_shadow: true,
      widget_border_weight: 1,
      /* `.pk-tile` / `.card2` — the app's own tile corner, unrounded-down */
      widget_corner_radius: 24,
    },
    colors: {
      body_text: BRAND.body,
      /* state, as words — the shell's `-t` tokens, used for nothing else */
      error: BRAND.badText,
      success: BRAND.okText,
      header: BRAND.ink,
      icons: BRAND.quiet,
      input_background: WHITE,
      input_border: inputBorderOnWhite,
      input_filled_text: BRAND.ink,
      input_labels_placeholders: BRAND.quiet,
      /* The app writes links as `color:inherit; text-decoration:underline` —
         the underline carries them, not a hue. Ink keeps that true here, and
         `links_style` below supplies the underline. Teal was the obvious
         choice and is wrong twice: #00A389 is 3.2:1 on white (fine for the
         wordmark, short of AA for a sentence), and the darker #00735F that
         does clear it is the SUCCESS token. */
      links_focused_components: BRAND.ink,
      primary_button: BRAND.ink,
      primary_button_label: WHITE,
      secondary_button_border: inputBorderOnWhite,
      secondary_button_label: BRAND.body,
      widget_background: WHITE,
      widget_border: BRAND.line,
      /* Focus is a RING — a graphic, where 3:1 is the bar and the accent
         clears it. This is the one place the bright brand teal appears. */
      base_focus_color: BRAND.tealDark,
      base_hover_color: BRAND.tealDark,
    },
    fonts: {
      /* Ratios off `reference_text_size`, not absolutes: Auth0 sizes
         everything as a percentage of that number. 16 is the app's body. */
      reference_text_size: 16,
      body_text: { bold: false, size: 87.5 }, // 14px
      buttons_text: { bold: true, size: 87.5 }, // 14px/700 — `.newbtn`
      input_labels: { bold: true, size: 81.25 }, // 13px/700
      links: { bold: true, size: 81.25 },
      subtitle: { bold: false, size: 87.5 },
      title: { bold: true, size: 150 }, // 24px/800-ish heading
      links_style: "underlined",
      font_url: assets.font,
    },
    page_background: {
      /* the app's page ground — the widget is a card ON something */
      background_color: BRAND.surface,
      background_image_url: "",
      page_layout: "center",
    },
    widget: {
      header_text_alignment: "center",
      /* the lockup is 4.4:1, so 36px tall is ~158 wide — the kit's 120px
         minimum for the full lockup, cleared with room */
      logo_height: 36,
      logo_position: "center",
      logo_url: assets.lockup,
      social_buttons_layout: "bottom",
    },
  } as const;
}

/** Branding settings proper — `PATCH /api/v2/branding`. Separate endpoint,
    separate payload, same scope. This is the pair Auth0 exposes to things
    that are not the theme: the favicon, and the `branding.*` variables the
    page template reads. */
export function heytiffBranding(assets: BrandAssets) {
  return {
    logo_url: assets.lockup,
    favicon_url: assets.favicon,
    colors: {
      primary: BRAND.ink,
      page_background: BRAND.surface,
    },
    font: { url: assets.font },
  } as const;
}
