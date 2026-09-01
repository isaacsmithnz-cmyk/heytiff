/* The brand assets, as URLs somebody else's server can fetch.

   AUTH0 AND GMAIL BOTH RENDER OFF OUR DOMAIN. The sign-in widget is drawn by
   Auth0 and the mail by a mail client; neither can reach a bundled asset, a
   CSS token or a React component. Everything they show has to be a public
   HTTPS URL, so the four files below live in `public/brand/` — the one
   directory whose paths are stable across deploys.

   WHY NOT `_design/brand/`. That is the kit: SVG sources, print variants, a
   mono mark. None of it is served. `public/brand/` holds only what an
   outsider actually fetches, and the two are not the same set — the lockup
   PNG here does not exist in the kit at all, because the kit's lockup is an
   SVG with live text and Gmail strips SVG.

   THE FONT IS A SECOND COPY ON PURPOSE. The app already self-hosts Plus
   Jakarta Sans through next/font, at a content-hashed path that changes
   whenever the font or the build does. Auth0 stores the URL it is given and
   fetches it months later, so it needs one that does not move. The file is
   the Google latin-subset variable face (weights 200-800, one file). */

const PUBLIC = "/brand";

/** Where the app is served. Auth0 stores absolute URLs, so a relative path is
    not an option — and a preview deploy's URL would be stored and then rot.
    The caller passes the origin; nothing here guesses one. */
export function brandAssets(baseUrl: string) {
  const origin = baseUrl.replace(/\/+$/, "");
  const at = (file: string) => `${origin}${PUBLIC}/${file}`;
  return {
    /** Chevron + "HeyTiff", ink wordmark on transparent, 1123x256.
        Rendered from the kit with the real Jakarta 800 outlines baked in —
        an email client will not load a webfont for a logo. Ink text, so it
        belongs on a light ground and nowhere else. */
    lockup: at("heytiff-lockup.png"),
    /** The mark alone, 512px square, brand gradient. */
    chevron: at("heytiff-chevron.png"),
    /** 32px, for Auth0's `favicon_url`. */
    favicon: at("favicon.png"),
    /** The variable font FILE — Auth0's `font.url` rejects a stylesheet. */
    font: at("plus-jakarta-sans.woff2"),
  };
}

export type BrandAssets = ReturnType<typeof brandAssets>;

/** The files `public/brand/` must contain for the above to resolve. Exported
    so a test can assert the directory and this module have not drifted — a
    404 here is a logo-shaped hole on a screen nobody signed in to see. */
export const BRAND_FILES = [
  "heytiff-lockup.png",
  "heytiff-chevron.png",
  "favicon.png",
  "plus-jakarta-sans.woff2",
] as const;
