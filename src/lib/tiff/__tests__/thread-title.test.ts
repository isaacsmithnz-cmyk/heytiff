import { isFirstWords, nameFrom, shapeName, shownTitle } from "../thread-title";
import type { TiffMsg } from "../threads";

const said = (user: string, tiff = ""): TiffMsg[] => [
  { role: "user", text: user, at: 1 },
  ...(tiff ? [{ role: "tiff" as const, text: tiff, at: 2 }] : []),
];

describe("a conversation's name (Isaac, 22 November 2026)", () => {
  const u2 = said("Need help with a u2 fault on a daikin", "U2 is power supply insufficient…");

  it("knows the first words, as the phone and the web cut them", () => {
    expect(isFirstWords("Need help with a u2 fault on a daikin", u2)).toBe(true);
    expect(isFirstWords("What day is it toda", said("What day is it today?"))).toBe(true);
    expect(isFirstWords("A very long question that the phone cut…", said("A very long question that the phone cut short at sixty"))).toBe(true);
    expect(isFirstWords("Talking to Tiff", said(""))).toBe(true);
  });

  it("shows hers in place of the first words, and a typed name over hers", () => {
    expect(shownTitle("Need help with a u2 fault on a daikin", "Daikin U2 fault on a small split", u2)).toBe("Daikin U2 fault on a small split");
    expect(shownTitle("Smith St U2", "Daikin U2 fault on a small split", u2)).toBe("Smith St U2");
    expect(shownTitle("Need help with a u2 fault on a daikin", null, u2)).toBe("Need help with a u2 fault on a daikin");
  });

  it("names it only once she has answered, and never one somebody renamed", () => {
    expect(nameFrom({ id: "t", title: "Need help with a u2 fault on a daikin", updatedAt: 1, messages: u2 })).toEqual({
      asked: "Need help with a u2 fault on a daikin",
      answer: "U2 is power supply insufficient…",
    });
    expect(nameFrom({ id: "t", title: "What", updatedAt: 1, messages: said("What") })).toBeNull();
    expect(nameFrom({ id: "t", title: "Smith St U2", updatedAt: 1, messages: u2 })).toBeNull();
  });

  it("keeps her name to a short line", () => {
    expect(shapeName('"daikin U2 fault on a small split."')).toBe("Daikin U2 fault on a small split");
    expect(shapeName("x")).toBeNull();
    expect(shapeName("a".repeat(61))).toBeNull();
    expect(shapeName(3)).toBeNull();
  });
});
