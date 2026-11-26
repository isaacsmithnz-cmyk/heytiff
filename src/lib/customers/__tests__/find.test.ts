import { bestCustomers, customerLine, nameFits, ownClient, searchWords, type CustomerHit } from "../find";

/* Isaac, 26 November 2026: the client he asked about was in the book as the
   contact on an old job, kept "De Vane" where he said "DeVane". Names here
   are made up. */

const hit = (over: Partial<CustomerHit> = {}): CustomerHit => ({
  name: "Sam De Vane",
  via: "job contact",
  client: "QX Construct",
  address: "2/28 Lorem St\nSampleton NSW 2088",
  job: { number: "2951", status: "Completed", date: "2024-05-03" },
  fit: 1,
  ...over,
});

describe("a name in the book answers the name said", () => {
  it("however its spaces fall, and either way round", () => {
    expect(nameFits("Sam DeVane", "Sam De Vane")).toBe(1);
    expect(nameFits("Sam De Vane", "Vane, Sam De")).toBe(1);
    expect(nameFits("Peter Quartermain", "Quartermain Peter")).toBe(1);
  });
  it("a letter out on a long name, as a name is heard", () => {
    expect(nameFits("Peter Quartermane", "Peter Quartermain")).toBe(0.8);
  });
  it("one word said, the book's last name", () => {
    expect(nameFits("Quartermain", "Peter Quartermain")).toBe(0.6);
  });
  it("never another person who shares a word", () => {
    expect(nameFits("Sam DeVane", "Sam Lee")).toBe(0);
    expect(nameFits("Sam DeVane", "Alex Vane")).toBe(0);
  });
  it("is looked for by each word of three letters or more, so a first name still reaches a spaced surname", () => {
    expect(searchWords("Sam DeVane")).toEqual(["sam", "devane"]);
    expect(searchWords("Jo Li")).toEqual([]);
  });
});

describe("what she says she found", () => {
  it("one customer: who, the job and where, and the builder it was through", () => {
    expect(customerLine("Sam DeVane", [hit()])).toBe(
      "Sam De Vane is already a customer: job 2951 at 2/28 Lorem St, Sampleton NSW 2088, Completed May 2024, through QX Construct.",
    );
  });
  it("a client of their own, with no job yet", () => {
    expect(customerLine("Sam DeVane", [hit({ via: "client", client: null, job: null })])).toBe("Sam De Vane is already a customer: at 2/28 Lorem St, Sampleton NSW 2088.");
  });
  it("nobody", () => {
    expect(customerLine("Sam DeVane", [])).toBe("I couldn't find Sam DeVane among your customers, so they'd be a new client.");
  });
  it("several, each once, the closest first", () => {
    const hits = bestCustomers([hit({ fit: 0.8, name: "Sam Devane", address: "9 Ipsum Rd\nOtherton NSW 2000", job: null, client: null }), hit(), hit(), hit({ fit: 0.2, name: "Sam Lee" })]);
    expect(hits.map((h) => h.name)).toEqual(["Sam De Vane", "Sam Devane"]);
    expect(customerLine("Sam DeVane", hits)).toBe(
      "I found 2 customers like Sam DeVane: Sam De Vane, job 2951 at 2/28 Lorem St, Sampleton NSW 2088, Completed May 2024, through QX Construct; Sam Devane, at 9 Ipsum Rd, Otherton NSW 2000.",
    );
  });
});

describe("the client a new job goes under", () => {
  it("the one the book is sure of, however the name was heard", () => {
    expect(ownClient([hit({ via: "client", client: null, clientUuid: "c-1" })])).toEqual({ uuid: "c-1", name: "Sam De Vane" });
    expect(ownClient([hit({ via: "contact", client: "Sam & Jo De Vane", clientUuid: "c-2" })])).toEqual({ uuid: "c-2", name: "Sam & Jo De Vane" });
  });
  it("never a builder whose job they were a contact on, a far fit, or one of two", () => {
    expect(ownClient([hit({ clientUuid: null })])).toBeNull();
    expect(ownClient([hit({ via: "client", fit: 0.6, clientUuid: "c-1" })])).toBeNull();
    expect(ownClient([hit({ via: "client", clientUuid: "c-1" }), hit({ via: "client", clientUuid: "c-3", address: "9 Ipsum Rd" })])).toBeNull();
  });
});
