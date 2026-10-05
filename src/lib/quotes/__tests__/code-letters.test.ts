/* A maker's code letters, read from its own document (Isaac, 2026-10-05:
   the Mitsubishi letters were read by hand, "not in the app upload"; "I
   would use Sonnet"): what's believed of what Tiff read, and which codes a
   kept rule applies to. */
import { CODE_LETTERS_SCHEMA, letterFeatures, parseLettersRead, ruleApplies, ruleKey, rulePattern, ruleWords, type LetterRule } from "../code-letters";

const wifi: LetterRule = { family: "MSZ", letter: "K", meaning: "Wi-Fi built in", example: { with: "MSZ-AP25VGKD2", without: "MSZ-AP25VGD2" } };
const dred: LetterRule = { family: "MXZ", letter: "D", meaning: "Demand response ready", example: { with: "MXZ-4F71VGD", without: "MXZ-4F71VG" } };

describe("where a rule's letter sits", () => {
  it("reads it off the document's own example: the family, any series, any size, then the letters before it", () => {
    expect(rulePattern(wifi)?.source).toBe("^MSZ[A-Z]*\\d+VGK");
    expect(rulePattern(dred)?.source).toBe("^MXZ\\d+F\\d+VGD");
  });

  it("applies to the family's codes that have the letter there, at any size or series, and to no others", () => {
    expect(ruleApplies(wifi, "MSZ-AP71VGKD2-A2")).toBe(true);
    expect(ruleApplies(wifi, "MSZ-EF35VGKDW-A1")).toBe(true);
    expect(ruleApplies(wifi, "MSZ-AP25VGD2")).toBe(false);
    expect(ruleApplies(wifi, "MFZ-KW25VGK-A2")).toBe(false);
    expect(ruleApplies(dred, "MXZ-5F100VGD-A2")).toBe(true);
    expect(ruleApplies(dred, "MXZ-2F52VF-A2")).toBe(false);
    expect(letterFeatures("MSZ-AP71VGKD2-A2", [wifi, dred])).toEqual(["Wi-Fi built in"]);
  });

  it("says a rule in a few words for a person to check", () => {
    expect(ruleWords(wifi)).toBe("K after VG, in MSZ codes");
  });
});

describe("what's believed of a legend read", () => {
  it("keeps a rule the document's example bears out, and works out the code without it when the letter sits once after the size", () => {
    const read = parseLettersRead({
      maker: "Mitsubishi Electric",
      rules: [
        { family: "MSZ", letter: "K", meaning: "Wi-Fi built in", codeWith: "MSZ-AP25VGKD2", codeWithout: "MSZ-AP25VGD2" },
        { family: "MFZ", letter: "K", meaning: "Wi-Fi built in", codeWith: "MFZ-KW25VGK", codeWithout: "" },
      ],
    });
    expect(read.maker).toBe("Mitsubishi Electric");
    expect(read.rules.map((r) => [r.family, r.letter, r.example.without])).toEqual([
      ["MSZ", "K", "MSZ-AP25VGD2"],
      ["MFZ", "K", "MFZKW25VG"],
    ]);
    expect(read.skipped).toEqual([]);
  });

  it("leaves out what it can't check, and says why — never a guess", () => {
    const read = parseLettersRead({
      maker: "",
      rules: [
        /* the example doesn't have the letter taken out where it says */
        { family: "MSZ", letter: "K", meaning: "Wi-Fi built in", codeWith: "MSZ-AP25VGKD2", codeWithout: "MSZ-AP35VGD2" },
        /* no example at all */
        { family: "PUMY", letter: "Y", meaning: "Three phase", codeWith: "", codeWithout: "" },
        /* the letter is there twice after the size: where is it? */
        { family: "PEAD", letter: "A", meaning: "Low profile", codeWith: "PEAD-M50JAAD", codeWithout: "" },
        /* the same rule twice is one rule */
        { family: "MSZ", letter: "K", meaning: "Wi-Fi built in", codeWith: "MSZ-AP71VGKD2", codeWithout: "MSZ-AP71VGD2" },
        { family: "MSZ", letter: "K", meaning: "Wi-Fi built in", codeWith: "MSZ-AP25VGKD2", codeWithout: "MSZ-AP25VGD2" },
      ],
    });
    expect(read.rules).toHaveLength(1);
    expect(read.skipped.map((s) => s.why)).toEqual([
      "its example doesn't bear it out",
      "not a letter and a meaning with an example",
      "the document doesn't show where the letter sits",
    ]);
  });

  it("keeps one rule however many sizes the document shows it on", () => {
    const a = { ...wifi, example: { with: "MSZ-AP71VGKD2", without: "MSZ-AP71VGD2" } };
    expect(ruleKey(a)).toBe(ruleKey(wifi));
  });

  it("asks for every field it reads, nothing left open", () => {
    const item = CODE_LETTERS_SCHEMA.properties.rules.items;
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
    expect([...CODE_LETTERS_SCHEMA.required].sort()).toEqual(Object.keys(CODE_LETTERS_SCHEMA.properties).sort());
  });
});
