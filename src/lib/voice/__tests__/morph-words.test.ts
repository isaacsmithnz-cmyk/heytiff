import { keptFrom, morphWords, type Said } from "../morph-words";

const said = (text: string) => morphWords([], text, 0);
const ids = (w: Said[]) => w.map((s) => s.id);

describe("keptFrom", () => {
  it("keeps the same start and end, and the run the middles share", () => {
    expect(keptFrom(["a", "b", "c"], ["a", "x", "c"])).toEqual([0, -1, 2]);
    expect(keptFrom(["a", "b"], ["a", "b", "c"])).toEqual([0, 1, -1]);
    expect(keptFrom(["a", "b", "c", "d"], ["a", "c", "d"])).toEqual([0, 2, 3]);
  });
});

describe("morphWords", () => {
  it("names new words in order and keeps the names of words that stay", () => {
    const one = said("tell Lyle");
    expect(ids(one.words)).toEqual([0, 1]);
    const two = morphWords(one.words, "tell Lyle he needs", one.next);
    expect(ids(two.words)).toEqual([0, 1, 2, 3]);
    expect(two.words.some((w) => w.fix)).toBe(false);
  });

  it("calls a word that replaced one a fix, and keeps its neighbours", () => {
    const one = said("send the boat today");
    const two = morphWords(one.words, "send the quote today", one.next);
    expect(two.words.map((w) => w.w)).toEqual([
      "send",
      "the",
      "quote",
      "today",
    ]);
    expect(ids(two.words)).toEqual([0, 1, 4, 3]);
    expect(two.words.map((w) => w.fix)).toEqual([false, false, true, false]);
  });

  it("pairs fixes one for one: a word only added is not a fix", () => {
    const one = said("order the grills");
    const two = morphWords(one.words, "order the grilles down", one.next);
    expect(two.words.map((w) => w.fix)).toEqual([false, false, true, false]);
  });
});
