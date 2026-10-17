import { openWords, sessionSystemPrompt } from "../prompt";

/* The write-up first is switched on only once the bench says she quotes as
   well or better with it (Isaac, 2026-10-11: "get as much built as possible
   before spending API credit"). */
it("asks for the job written out first only when it's switched on", () => {
  expect(sessionSystemPrompt()).not.toMatch(/write_up/);
  expect(sessionSystemPrompt({ writeUpFirst: true })).toMatch(/Before any line, write the job out \(write_up\)/);
  /* the same for every quote of every business: it caches */
  expect(sessionSystemPrompt()).toBe(sessionSystemPrompt());
});

/* Isaac on the 2749 runs, 2026-10-12: disposal "ask us how much labor we
   want to allow… It does need to have the line at least"; recovery "more of a
   cost that we should be putting in"; and Sonnet left its write-up as the
   first turn had it */
it("always gives old equipment a removal line, asks for disposal labour and the recovery cost, and writes the job again after answers", () => {
  const p = sessionSystemPrompt({ writeUpFirst: true });
  expect(p).toMatch(/Old equipment coming out always has its own line for removal and disposal, as labour: ask how many hours/);
  expect(p).toMatch(/Recovering its refrigerant is the business's own cost: ask what they allow, never research it/);
  expect(p).toMatch(/write it up again, whole, before you reply/);
});

/* Isaac, 2026-10-15, on 3231's quote: "[MITSUBISHI ELEC. DUCT OUT 10KW 1P
   R32]. That's like a line code from a supplier… simplified to indoor unit,
   outdoor unit… indoor unit study, then model" */
it("names a unit's line by what it is, a head by its room, its model the code", () => {
  const p = sessionSystemPrompt();
  expect(p).toMatch(/Name a unit's line by what it is, "Indoor unit" or "Outdoor unit", and a multi's or VRF's head by the room it serves, "Indoor unit, Study"; its model is its code\. The supplier's words for it are never its name/);
});

/* Isaac, 2026-10-15, on 3231's "with about 5 zones": "the client doesn't
   want to hear about five zones. They need something a bit more…
   professional." */
it("writes the proposal plainly for the client: no hedge, no working, an open choice as a contractor says it, none of the business's notes", () => {
  const p = sessionSystemPrompt();
  expect(p).toMatch(/The proposal is the client's: say what's included plainly and with confidence, never your working: no "about", "approximately" or "assumed", no allowance worked out per item, no count that isn't settled/);
  expect(p).toMatch(/A choice still open is said the way a contractor writes it, "Floor grille style to be confirmed with you", and the business's own notes never go in it/);
});

/* Isaac, 2026-10-15: "build a section in the data pack that recommended
   airflow numbers go through. So she has something to compare it with…
   Anyone using it should get the same recommendations, which we can change
   during the conversation." */
it("checks a ducted system's air once its unit and outlets are known, saying the guide's figure and reason, the brief over it", () => {
  const p = sessionSystemPrompt();
  expect(p).toMatch(/For a ducted system, check the air \(airflow_check\) once the unit and its outlets are known\. What the guide says is a recommendation: say it with its figure and its reason, and never settle a size on it without saying so\. The brief, a plan or the person's word overrides it\./);
  /* cached for every business: none of one business's facts */
  expect(p).not.toMatch(/Diamond Air|PEA-M/);
});

/* Isaac, 2026-10-15, on 3231's "4 × Ø250 takeoffs… 8 × Ø200 flex": "most
   air conditioning duct work is 10 inch or 250 mil, but I don't want you to
   take my word for it. It needs to be decided by the brief." 17 October:
   "Ducts can be sourced from the guide. As assumptions. And she can clearly
   show you… the reasoning." */
it("takes every duct and outlet size from the brief, a plan or an answer, else the airflow guide's as assumed, with its reasoning, never the business's usual", () => {
  const p = sessionSystemPrompt();
  expect(p).toMatch(/Every duct and outlet size, the main duct's, each takeoff's and each outlet's, comes from the brief, a plan you've looked at or the person's answer, never from the business's usual\. Where none gives it, size it from the airflow guide \(airflow_check\) on the unit's airflow and the outlets, and put it on at the guide's size as assumed/);
  expect(p).toMatch(/Show that reasoning in your reply, size by size, so the person can change it\./);
  expect(p).toMatch(/A duct's size is never the business's usual one: the brief, a plan or an answer settles it, else the airflow guide's size, as assumed and said with its reasoning/);
  /* the Ys were once settled "from the outlets and the usual layout" */
  expect(p).not.toMatch(/usual layout/);
});

/* the bench, 15 October: a VRF ducted head went on a multi outdoor, and she said "pairing not checked" */
it("checks every system's outdoor takes its indoors before its units go on", () => {
  expect(sessionSystemPrompt()).toMatch(/Check every system's outdoor takes its indoors \(pairing_check\) before its units go on\. One that doesn't connect never goes on as it is: say why, in the book's words, and put on one that does\./);
});

/* the bench, 15 October: "please confirm" in her words, never asked, though the crew and days moved every quote they were given for */
it("asks the crew and days she worked out as a question, not in passing", () => {
  expect(sessionSystemPrompt()).toMatch(/Then ask the crew and days as a question \(ask\), every visit's in it and what you worked out its put: nothing moves a quote more\./);
});

/* the bench, 16 October: a code the pack hasn't got, and she swapped the AP35 for the dearer EF35 the pack has */
it("keeps a unit the pack hasn't got, saying its pairing isn't checked, never swapping it for one the pack has", () => {
  expect(sessionSystemPrompt()).toMatch(/A model the pack hasn't got isn't refused: keep the one the brief or the book gives, and say its pairing isn't checked\. Never swap a unit only to get one the pack has\./);
});

/* 3209, 17 October: questions called by the app's ids ("313, 315, 317 and
   319"), a price asked that the book had, and the flex lost when its line
   became the box */
it("numbers her open questions as she asked them, the id only for settling", () => {
  const w = openWords([
    { id: 313, question: "Is a 2-person crew right?", put: "2 people, 2.5 days" },
    { id: 315, question: "How many metres of pipe?", put: "" },
  ]);
  expect(w).toMatch(/^Your questions still open, numbered as you asked them:\n1\. Is a 2-person crew right\? \(the quote has 2 people, 2\.5 days\) \[id 313\]\n2\. How many metres of pipe\? \[id 315\]/);
  expect(w).toMatch(/To them, call each by its number, never its id\./);
});

it("searches the book before calling a part unknown, and keeps what a found item doesn't cover", () => {
  const p = sessionSystemPrompt();
  expect(p).toMatch(/Search the book \(search_book\) for every part before you call it unknown or ask its price: a custom item or an allowance may be in it\./);
  expect(p).toMatch(/When a book item covers only part of what a line stood for, put it on and keep the rest on its own line \(unknown if it must be\)/);
  expect(p).toMatch(/on a ducted head \(and a head hidden in joinery or a bulkhead is one\) its plenum or supply adaptor, its supply grilles with their boxes and flex, its return grille, box and flex/);
});

/* 3209, 17 October: a whole 10 kg cylinder on a PUMY-SP112 the book puts at about 4 kg */
it("puts on the refrigerant the maker's book gives on the pipe lengths, never a whole cylinder by default", () => {
  expect(sessionSystemPrompt()).toMatch(/The refrigerant a system takes on top of its outdoor's own comes from its maker's book on the pipe lengths \(refrigerant_charge\), never a whole cylinder by default/);
});

