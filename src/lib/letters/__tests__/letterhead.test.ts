import { addressLinesOf, letterheadLines, type LetterheadFacts } from "../letterhead";
import { STANDARD_LETTERHEAD } from "@/lib/templates/settings";

const FACTS: LetterheadFacts = {
  brand: { name: "Diamond Air Solutions", logoUrl: null, color: null, abn: "14603285409", phone: "02 9000 0000", email: "a@b.com", website: null },
  legalName: "DAS PTY LTD",
  acn: "603285409",
  address: ["12 Example Street", "Paddington NSW 2021"],
  licences: ["Contractor licence 315890C"],
};

it("prints the details the letterhead shows, in order, from the business's own facts", () => {
  expect(letterheadLines(FACTS, STANDARD_LETTERHEAD)).toEqual([
    "ABN 14 603 285 409",
    "12 Example Street",
    "Paddington NSW 2021",
    "02 9000 0000",
    "a@b.com",
    "Contractor licence 315890C",
  ]);
});

it("adds the legal name and ACN when ticked, and the legal name only when it differs", () => {
  const all = { ...STANDARD_LETTERHEAD, show: { ...STANDARD_LETTERHEAD.show, legalName: true, acn: true } };
  expect(letterheadLines(FACTS, all).slice(0, 2)).toEqual(["DAS PTY LTD", "ABN 14 603 285 409   ACN 603 285 409"]);
  expect(letterheadLines({ ...FACTS, legalName: "diamond air solutions" }, all)[0]).toBe("ABN 14 603 285 409   ACN 603 285 409");
});

it("joins the address as it prints", () => {
  expect(addressLinesOf({ address: "12 Example Street", suburb: "Paddington", state: "NSW", postcode: "2021" })).toEqual(["12 Example Street", "Paddington NSW 2021"]);
  expect(addressLinesOf({})).toEqual([]);
});
