/* PLUS JAKARTA SANS, FOR THE IMAGE RENDERER.

   The preview images are drawn by `next/og`, which rasterises JSX through
   Satori and takes fonts only as TTF, OTF or WOFF. The one copy of Jakarta
   in the repo (`public/brand/plus-jakarta-sans.woff2`, the email copy) is a
   WOFF2, which Satori cannot read, and `next/font` keeps its download inside
   the build directory where a route cannot reach it.

   So the TTF is fetched from Google Fonts at render time, the way the
   renderer's own examples do it. Google's CSS endpoint hands back TTF sources
   to a browser old enough not to speak WOFF2 — the user agent below is that
   browser — and each file is about 66 KB. Both requests are `force-cache`d,
   so a deployment fetches them once. If either fetch fails the caller gets an
   empty list and the renderer falls back to its bundled default face: a
   preview in the wrong font beats no preview.

   `ttfUrlsFromCss` is separate and pure so the parsing can be tested without
   a network. */

export type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 500 | 600 | 700;
  style: "normal";
};

const FAMILY = "Plus Jakarta Sans";
const CSS_ENDPOINT = "https://fonts.googleapis.com/css2";
/** A user agent Google answers with `format('truetype')` sources. */
const LEGACY_UA =
  "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1";

/** weight → TTF URL, from a Google Fonts stylesheet. Only truetype sources
    count; a woff2 line for the same weight is ignored. */
export function ttfUrlsFromCss(css: string): Map<number, string> {
  const out = new Map<number, string>();
  const block = /@font-face\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = block.exec(css))) {
    const body = m[1];
    const weight = body.match(/font-weight:\s*(\d{3})/);
    const src = body.match(/url\(([^)]+\.ttf)\)\s*format\(['"]truetype['"]\)/);
    if (weight && src) out.set(Number(weight[1]), src[1]);
  }
  return out;
}

export async function jakartaFonts(weights: Array<OgFont["weight"]>): Promise<OgFont[]> {
  try {
    const css = await fetch(
      `${CSS_ENDPOINT}?family=${encodeURIComponent(FAMILY)}:wght@${weights.join(";")}`,
      { headers: { "User-Agent": LEGACY_UA }, cache: "force-cache" }
    ).then((r) => (r.ok ? r.text() : ""));
    const urls = ttfUrlsFromCss(css);
    const fonts: OgFont[] = [];
    for (const weight of weights) {
      const url = urls.get(weight);
      if (!url) continue;
      const res = await fetch(url, { cache: "force-cache" });
      if (!res.ok) continue;
      fonts.push({ name: FAMILY, data: await res.arrayBuffer(), weight, style: "normal" });
    }
    return fonts;
  } catch {
    return [];
  }
}
