/* Install details answered by the quote (install-from-quote.ts): a quote's
   material lines tick the questions they settle, and leave the rest. The
   names are the kind a supplier's lines carry. */

import { answerFromQuote, answersFromQuote, stillQuoted } from "../install-from-quote";
import { createDesign } from "../document";
import { newSystem } from "../zones";
import { installAnswers } from "../install";

const QUOTE = [
  { name: "PAIRED COIL 1/4 + 3/8 X 5M", qty: 1 },
  { name: "ISOLATOR SMALL 2 POLE 20A IP56", qty: 1 },
  { name: "Cable Tps 2.5Mm 2C+E per metre", qty: 10 },
  { name: "CON WALL BRACKET 250KG W:550 H:450 L:850", qty: 1 },
  { name: "DURA FLEX COND DRAIN HOSE (16/18MM) (MTR)", qty: 6 },
  { name: "MINI AQUA CONDENSATE PUMP 14L/HR (EA)", qty: 2 },
  { name: "Plastering allowance", qty: 1 },
];

describe("answers from a quote's lines", () => {
  it("reads the bracket, the drain and pump, the electrical and the controls", () => {
    expect(answersFromQuote(QUOTE)).toEqual({
      "outdoor-sits": ["wall"],
      "wall-bracket": ["heavy-bracket"],
      controls: ["wireless"],
      condensate: ["gravity", "pump"],
      "electrical-work": ["yes"],
    });
  });

  it("says nothing of what the quote doesn't", () => {
    const a = answersFromQuote([{ name: "Consumables", qty: 1 }]);
    expect(a["outdoor-sits"]).toBeUndefined();
    expect(a.condensate).toBeUndefined();
    expect(a["electrical-work"]).toBeUndefined();
    // a quote with no controller still means the remotes each head comes with
    expect(a.controls).toEqual(["wireless"]);
  });

  it("reads a plain bracket, a Wi-Fi adapter and a ground pad", () => {
    expect(answersFromQuote([{ name: "Wall bracket 120kg", qty: 1 }])["wall-bracket"]).toEqual(["wall-bracket"]);
    expect(answersFromQuote([{ name: "MAC-587IF-E Wi-Fi interface", qty: 1 }]).controls).toEqual(["wifi"]);
    expect(answersFromQuote([{ name: "Condenser pad 900 x 450", qty: 1 }])["ground-base"]).toEqual(["ground-pad"]);
  });

  it("answers a system and keeps what the quote said", () => {
    const made = newSystem(createDesign({ name: "house", mode: "blank" }), "2026.1");
    const d = answerFromQuote(made.doc, made.systemId, QUOTE);
    const sys = d.systems.find((s) => s.id === made.systemId)!;
    const answers = installAnswers(d, sys);
    expect(answers["outdoor-sits"]).toEqual(["wall"]);
    expect(answers["wall-bracket"]).toEqual(["heavy-bracket"]);
    expect(answers["electrical-work"]).toEqual(["yes"]);
    const quoted = sys.settings.installQuoted as Record<string, string[]>;
    expect(stillQuoted(quoted["outdoor-sits"], answers["outdoor-sits"])).toBe(true);
    // changed since: no longer the quote's
    expect(stillQuoted(quoted["electrical-work"], ["no"])).toBe(false);
  });
});
