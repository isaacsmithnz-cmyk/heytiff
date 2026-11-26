import { NOT_ON_MAP, mapAsked, newJobStep } from "../new-job-check";
import type { CustomerHit } from "@/lib/customers/find";

const FOUND: CustomerHit = { name: "Sam De Vane", via: "client", client: null, address: "2/28 Lorem St\nSampleton NSW 2088", job: null, fit: 1 };

describe("before a new job is offered", () => {
  it("with no address, asks where, offering the customer's own", () => {
    expect(newJobStep({ client: "Sam DeVane", address: "" }, { customers: [FOUND], place: null, askedOnMap: false })).toEqual({
      kind: "ask",
      lead: "Sam De Vane is already a customer: at 2/28 Lorem St, Sampleton NSW 2088.",
      question: "Is the new job at 2/28 Lorem St, Sampleton NSW 2088, or somewhere else?",
    });
    expect(newJobStep({ client: "", address: "" }, { customers: null, place: null, askedOnMap: false })).toMatchObject({ kind: "ask", lead: "", question: "Where's the new job? Say the site's address, with the suburb." });
  });
  it("offers it at the place the map gives", () => {
    expect(newJobStep({ client: "", address: "2/26 Lorem St, Samppleton" }, { customers: null, place: { kind: "found", address: "2/26 Lorem St, Sampleton NSW 2088" }, askedOnMap: false })).toEqual({
      kind: "offer",
      address: "2/26 Lorem St, Sampleton NSW 2088",
      lead: "",
    });
  });
  it("asks once about a place the map doesn't know, then takes it as said", () => {
    const step = newJobStep({ client: "", address: "Lot 4 Newbuild Rd, Sampleton" }, { customers: null, place: { kind: "none" }, askedOnMap: false });
    expect(step).toMatchObject({ kind: "ask", question: "I couldn't find Lot 4 Newbuild Rd, Sampleton on the map. What's the street number, street and suburb?" });
    expect(mapAsked([step.kind === "ask" ? step.question : ""])).toBe(true);
    expect(newJobStep({ client: "", address: "Lot 4 Newbuild Rd, Sampleton" }, { customers: null, place: { kind: "none" }, askedOnMap: true })).toMatchObject({ kind: "offer", address: "Lot 4 Newbuild Rd, Sampleton" });
  });
  it("says the map's marker in its question", () => {
    expect(NOT_ON_MAP).toBe("on the map");
  });
});
