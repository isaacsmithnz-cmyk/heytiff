/* The theme is pushed to a vendor that answers a bad value with 400 and a
   sentence about "payload validation". By then it is a failed deploy step at
   the end of a script somebody ran once. Auth0's published ranges are
   asserted here instead, where the failure names the field.

   The design laws are asserted too — that teal is never the primary button,
   that no `-t` state colour leaks into a non-state role — because those are
   the two mistakes that would look FINE on screen and still be wrong. */

import { heytiffTheme, heytiffBranding } from "../theme";
import { brandAssets } from "../assets";
import { BRAND, WHITE, inputBorderOnWhite } from "../palette";

const assets = brandAssets("https://app.example.com");
const theme = heytiffTheme(assets);
const branding = heytiffBranding(assets);

describe("Auth0's published ranges", () => {
  /* https://auth0.com/docs/api/management/v2/branding/patch-branding-theme */
  const ranges: [string, number, number, number][] = [
    ["button_border_radius", theme.borders.button_border_radius, 1, 10],
    ["button_border_weight", theme.borders.button_border_weight, 0, 10],
    ["input_border_radius", theme.borders.input_border_radius, 0, 10],
    ["input_border_weight", theme.borders.input_border_weight, 0, 3],
    ["widget_border_weight", theme.borders.widget_border_weight, 0, 10],
    ["widget_corner_radius", theme.borders.widget_corner_radius, 0, 50],
    ["logo_height", theme.widget.logo_height, 1, 100],
    ["reference_text_size", theme.fonts.reference_text_size, 12, 24],
  ];

  it.each(ranges)("%s is within %i-%i", (_name, value, min, max) => {
    expect(value).toBeGreaterThanOrEqual(min);
    expect(value).toBeLessThanOrEqual(max);
  });

  it.each([
    ["buttons_style", theme.borders.buttons_style, ["pill", "rounded", "sharp"]],
    ["inputs_style", theme.borders.inputs_style, ["pill", "rounded", "sharp"]],
    ["page_layout", theme.page_background.page_layout, ["center", "left", "right"]],
    ["logo_position", theme.widget.logo_position, ["center", "left", "none", "right"]],
    ["links_style", theme.fonts.links_style, ["normal", "underlined"]],
    [
      "header_text_alignment",
      theme.widget.header_text_alignment,
      ["center", "left", "right"],
    ],
    [
      "social_buttons_layout",
      theme.widget.social_buttons_layout,
      ["bottom", "top"],
    ],
  ] as [string, string, string[]][])("%s is one of the allowed values", (_n, v, allowed) => {
    expect(allowed).toContain(v);
  });

  it("every colour is a hex Auth0 will accept", () => {
    for (const [name, value] of Object.entries(theme.colors)) {
      expect(`${name}=${value}`).toMatch(/=#[0-9A-Fa-f]{6}$/);
    }
  });

  it("sends every top-level key — PATCH requires all five", () => {
    expect(Object.keys(theme).sort()).toEqual([
      "borders",
      "colors",
      "fonts",
      "page_background",
      "widget",
    ]);
  });
});

describe("the design laws hold", () => {
  it("the primary button is ink, not the accent", () => {
    // `.newbtn` in shell.css is `background:var(--ink)` with a white label.
    // Teal as a big filled button is the single most likely wrong turn here.
    expect(theme.colors.primary_button).toBe(BRAND.ink);
    expect(theme.colors.primary_button_label).toBe(WHITE);
    expect(theme.colors.primary_button).not.toBe(BRAND.teal);
    expect(theme.colors.primary_button).not.toBe(BRAND.tealDark);
  });

  it("no state colour is used anywhere but its own state role", () => {
    const stateRoles = new Set(["error", "success"]);
    for (const [role, value] of Object.entries(theme.colors)) {
      if (stateRoles.has(role)) continue;
      expect(`${role}=${value}`).not.toBe(`${role}=${BRAND.okText}`);
      expect(`${role}=${value}`).not.toBe(`${role}=${BRAND.badText}`);
    }
    expect(theme.colors.success).toBe(BRAND.okText);
    expect(theme.colors.error).toBe(BRAND.badText);
  });

  it("links carry an underline rather than a hue", () => {
    // The app writes them `color:inherit; text-decoration:underline`.
    expect(theme.fonts.links_style).toBe("underlined");
    expect(theme.colors.links_focused_components).toBe(BRAND.ink);
  });

  it("the widget is a card on the app's own ground", () => {
    expect(theme.colors.widget_background).toBe(WHITE);
    expect(theme.colors.widget_border).toBe(BRAND.line);
    expect(theme.page_background.background_color).toBe(BRAND.surface);
    expect(theme.colors.input_border).toBe(inputBorderOnWhite);
  });
});

describe("the asset URLs", () => {
  it("are absolute https — Auth0 stores them and fetches them itself", () => {
    for (const url of [
      theme.widget.logo_url,
      theme.fonts.font_url,
      branding.logo_url,
      branding.favicon_url,
      branding.font.url,
    ]) {
      expect(url).toMatch(/^https:\/\/app\.example\.com\/brand\//);
    }
  });

  it("point at the font FILE — Auth0 rejects a stylesheet", () => {
    expect(theme.fonts.font_url).toMatch(/\.woff2$/);
  });
});
