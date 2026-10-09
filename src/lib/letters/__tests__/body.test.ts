import { bodyText, normaliseBody } from "../body";

/* What a letter's body may hold, on every save and every print: anything
   else the editor hands over is dropped, never stored or drawn. */

const p = (text: string, extra: Record<string, unknown> = {}) => ({ type: "paragraph", ...extra, content: [{ type: "text", text }] });

it("keeps paragraphs, headings, lists, tables, marks and alignment", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2, textAlign: "center" }, content: [{ type: "text", text: "Employment", marks: [{ type: "bold" }] }] },
      p("Hello", { attrs: { textAlign: "justify" } }),
      { type: "bulletList", content: [{ type: "listItem", content: [p("one")] }] },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [p("Position")] }, { type: "tableCell", content: [p("Technician")] }] }] },
    ],
  };
  expect(normaliseBody(doc)).toEqual({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2, textAlign: "center" }, content: [{ type: "text", text: "Employment", marks: [{ type: "bold" }] }] },
      { type: "paragraph", attrs: { textAlign: "justify" }, content: [{ type: "text", text: "Hello" }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] }] },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Position" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Technician" }] }] },
            ],
          },
        ],
      },
    ],
  });
});

it("drops what a letter isn't made of: other nodes, marks and attributes", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "codeBlock", content: [{ type: "text", text: "<script>" }] },
      { type: "image", attrs: { src: "javascript:alert(1)" } },
      { type: "paragraph", attrs: { textAlign: "left", onclick: "x" }, content: [{ type: "text", text: "kept", marks: [{ type: "link", attrs: { href: "javascript:x" } }, { type: "italic" }] }] },
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "a level 2" }] },
    ],
  };
  expect(normaliseBody(doc).content).toEqual([
    { type: "paragraph", content: [{ type: "text", text: "kept", marks: [{ type: "italic" }] }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "a level 2" }] },
  ]);
});

it("reads anything that isn't a document as an empty letter", () => {
  expect(normaliseBody(null)).toEqual({ type: "doc", content: [] });
  expect(normaliseBody("<p>hi</p>")).toEqual({ type: "doc", content: [] });
  expect(normaliseBody({ type: "doc", content: "x" })).toEqual({ type: "doc", content: [] });
});

it("cuts a body past a letter's size rather than throwing", () => {
  const huge = { type: "doc", content: Array.from({ length: 1000 }, () => p("x".repeat(100))) };
  const out = normaliseBody(huge);
  expect(out.content.length).toBeLessThanOrEqual(400);
  expect(bodyText(out, 100000).length).toBeLessThanOrEqual(20000 + 400);
});

it("gives the list its first words", () => {
  expect(bodyText(normaliseBody({ type: "doc", content: [p("To whom it may concern,"), p("This confirms")] }))).toBe("To whom it may concern, This confirms");
});
