import fs from "node:fs";
import path from "node:path";
import { FIRST_WORDS, firstWordsGroup, firstWordsPicker, firstWordsUrl } from "../first-words";

describe("her first words", () => {
  it("has 32 lines, each with its clip kept beside the app", () => {
    expect(FIRST_WORDS).toHaveLength(32);
    FIRST_WORDS.forEach((_, n) => {
      const file = path.join(process.cwd(), "public", firstWordsUrl(n));
      expect(fs.existsSync(file)).toBe(true);
    });
    expect(firstWordsUrl(0)).toBe("/brand/tiff-voice/first-words/01.mp3");
    expect(firstWordsUrl(31)).toBe("/brand/tiff-voice/first-words/32.mp3");
  });

  it("takes the list from the words used", () => {
    expect(firstWordsGroup("What does an E5 mean on a Daikin ducted unit")).toBe("manuals");
    expect(firstWordsGroup("What clearance does the outdoor unit need")).toBe("manuals");
    expect(firstWordsGroup("How much did we quote for the townhouses")).toBe("money");
    expect(firstWordsGroup("Who's booked on 3570 tomorrow")).toBe("job");
    expect(firstWordsGroup("Remind me to ring the builder after lunch")).toBe("any");
  });

  it("says nothing first for a reply", () => {
    expect(firstWordsGroup("Yes")).toBeNull();
    expect(firstWordsGroup("No, that's all.")).toBeNull();
    expect(firstWordsGroup("Thanks Tiff")).toBeNull();
    expect(firstWordsGroup("Okay, go ahead")).toBeNull();
    expect(firstWordsGroup("")).toBeNull();
  });

  it("says every line of a list once before any comes round again, never one twice running", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const pick = firstWordsPicker(random);
    const manuals = FIRST_WORDS.flatMap((l, i) => (l.group === "manuals" ? [i] : []));
    const said: number[] = [];
    for (let i = 0; i < manuals.length * 5; i++) said.push(pick("What does the E5 fault code mean")!);
    for (let r = 0; r < 5; r++) {
      expect([...said.slice(r * manuals.length, (r + 1) * manuals.length)].sort((a, b) => a - b)).toEqual(manuals);
    }
    for (let i = 1; i < said.length; i++) expect(said[i]).not.toBe(said[i - 1]);
    expect(pick("Yes")).toBeNull();
  });
});
