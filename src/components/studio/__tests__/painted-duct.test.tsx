import { renderToStaticMarkup } from "react-dom/server";
import { PaintedDuct, PaintedFitting, RiserDisc } from "../painted-duct";

const markup = (props: Partial<Parameters<typeof PaintedDuct>[0]>) =>
  renderToStaticMarkup(
    <svg>
      <PaintedDuct diaMm={400} mmPerUnit={10} pen={1} {...props} />
    </svg>
  );

describe("a painted duct", () => {
  it("flex has walls, a body and ribs across it", () => {
    const html = markup({ d: "M 0 0 L 100 0" });
    expect(html.match(/<path/g)).toHaveLength(3);
    expect(html).toContain('stroke="#A855F7"');
    expect(html).toContain('stroke-dasharray="2 8"');
  });
  it("rigid is smooth", () => {
    const html = markup({ points: "0,0 100,0" });
    expect(html.match(/<polyline/g)).toHaveLength(2);
    expect(html).not.toContain("stroke-dasharray");
  });
  it("is at its true width until it would be thinner than 4 px", () => {
    expect(markup({ d: "M 0 0 L 1 0" })).toContain('stroke-width="40"');
    expect(markup({ d: "M 0 0 L 1 0", mmPerUnit: 1000 })).toContain('stroke-width="4"');
  });
});

describe("a fitting", () => {
  it("is grey metal whatever the ducts' colours, with a leg for each", () => {
    const ends = [400, 300, 300].map((diaMm, i) => ({ diaMm, path: [{ x: 0, y: 0 }, { x: i === 0 ? -500 : 500, y: i * 200 }] }));
    const html = renderToStaticMarkup(
      <svg>
        <PaintedFitting j={{ at: { x: 0, y: 0 }, stream: "supply", diasMm: [400, 300, 300], ends }} mmPerUnit={10} pen={1} />
      </svg>
    );
    expect(html.match(/<polygon/g)).toHaveLength(6);
    expect(html).toContain('fill="#D1D5DB"');
    expect(html).not.toContain("#A855F7");
  });
});

describe("a riser", () => {
  const disc = (mark: Parameters<typeof RiserDisc>[0]["mark"]) =>
    renderToStaticMarkup(
      <svg>
        <RiserDisc at={{ x: 0, y: 0 }} mark={mark} mmPerUnit={10} pen={1} />
      </svg>
    );
  it("is red with its word on it", () => {
    expect(disc({ word: "DR", diaMm: 100 })).toContain('fill="#BE123C"');
    expect(disc({ word: "DR", diaMm: 100 })).toContain(">DR<");
    expect(disc({ word: "PR", diaMm: null })).toContain(">PR<");
  });
  it("is smaller for a pipe", () => {
    expect(disc({ word: "PR", diaMm: null })).toContain('r="8"');
    expect(disc({ word: "DR", diaMm: 100 })).toContain('r="11"');
  });
  it("is never lost inside its duct", () => {
    expect(disc({ word: "DR", diaMm: 400 })).toContain('r="20"');
  });
});
