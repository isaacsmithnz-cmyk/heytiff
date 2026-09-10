import { ttfUrlsFromCss } from "../fonts";

/* Google's stylesheet, as it comes back to the legacy user agent the loader
   sends: one @font-face per weight, truetype sources. A woff2 block for the
   same weight, as a modern browser would get, must not be picked up — the
   renderer cannot read it. */
const CSS = `
/* latin */
@font-face {
  font-family: 'Plus Jakarta Sans';
  font-style: normal;
  font-weight: 500;
  src: url(https://fonts.gstatic.com/s/plusjakartasans/v12/aaa.ttf) format('truetype');
}
@font-face {
  font-family: 'Plus Jakarta Sans';
  font-style: normal;
  font-weight: 700;
  src: url(https://fonts.gstatic.com/s/plusjakartasans/v12/bbb.ttf) format('truetype');
}
@font-face {
  font-family: 'Plus Jakarta Sans';
  font-style: normal;
  font-weight: 600;
  src: url(https://fonts.gstatic.com/s/plusjakartasans/v12/ccc.woff2) format('woff2');
}
`;

describe("the TTF picker", () => {
  it("maps each weight to its truetype file and ignores woff2", () => {
    const urls = ttfUrlsFromCss(CSS);
    expect([...urls.entries()]).toEqual([
      [500, "https://fonts.gstatic.com/s/plusjakartasans/v12/aaa.ttf"],
      [700, "https://fonts.gstatic.com/s/plusjakartasans/v12/bbb.ttf"],
    ]);
  });

  it("is empty for an empty or unexpected stylesheet", () => {
    expect(ttfUrlsFromCss("").size).toBe(0);
    expect(ttfUrlsFromCss("body { color: red }").size).toBe(0);
  });
});
