import { replyBlocks } from "../reply-blocks";

const plain = (s: { text: string }[]) => s.map((x) => x.text).join("");

it("reads her sentences, points and numbered questions, with the bold out of its asterisks", () => {
  const b = replyBlocks("Option 1 is built at $3,697.70.\n\n- **Labour:** 12 h.\n  - Nested goes level.\n- **Pipe:** 5 m.\n\nQuestion:\n1. What do you allow? $0 now.");
  expect(b.map((x) => x.kind)).toEqual(["para", "bullets", "numbers"]);
  const list = b[1] as { items: { text: string; bold: boolean }[][] };
  expect(list.items).toHaveLength(3);
  expect(list.items[0]![0]).toEqual({ text: "Labour:", bold: true });
  expect(plain(list.items[0]!)).toBe("Labour: 12 h.");
});

it("keeps a line broken mid-sentence as one paragraph, and a stray asterisk as it is", () => {
  const b = replyBlocks("A line\nbroken here, 2 * 3");
  expect(b).toEqual([{ kind: "para", spans: [{ text: "A line broken here, 2 * 3", bold: false }] }]);
});

it("keeps a list's own numbering", () => {
  const b = replyBlocks("4. Fourth?\n5. Fifth?");
  expect(b[0]).toMatchObject({ kind: "numbers", start: 4 });
});
