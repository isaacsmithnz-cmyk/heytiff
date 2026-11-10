import { namedIn, namedWords, nameRuns, personWords, type Person } from "../people-named";

/* The phone's rules for who is named in the box (heytiff-mobile
   src/lib/people.ts), on the web's box too, tried on the names a real
   workspace has: two Alexes, a Luke, a Callum, a Brent kept as "Brent
   (Service)", and an Isaac with two profiles. */

const person = (id: string, fullName: string, more: { firstName?: string; preferredName?: string; aliases?: string[] } = {}): Person => ({
  id,
  name: fullName,
  words: personWords({ fullName, ...more }),
});

const PEOPLE: Person[] = [
  person("1", "Alex Lorenz"),
  person("2", "Alex Morozoff"),
  person("3", "Luke Ingold", { preferredName: "Luke" }),
  person("4", "Callum Vrieze"),
  person("5", "Brent (Service) Gilmore", { firstName: "Brent (Service)" }),
  person("6", "Isaac Smith"),
  person("7", "Isaac Smith", { preferredName: "Zuck" }),
  person("8", "Leonardo Martins", { aliases: ["Bobo"] }),
  person("9", "Will Turner"),
];

const named = (text: string) => namedIn(text, PEOPLE).map((n) => text.slice(n.start, n.end));

it("finds a person by their first name, as Isaac said it", () => {
  expect(named("Can you let Luke know that Jay Matthews' job is ready to book in?")).toEqual(["Luke"]);
});

it("takes the longest name: Alex Lorenz is one name, and Alex alone is two people's so stays plain", () => {
  expect(named("Alex Lorenz and Callum are on it. Alex brings the ladder.")).toEqual(["Alex Lorenz", "Callum"]);
});

it("finds a nickname Tiff has learned, and a preferred name", () => {
  expect(named("Bobo and Zuck are there")).toEqual(["Bobo", "Zuck"]);
});

it("counts two profiles with one full name as one person", () => {
  expect(named("Isaac will ring")).toEqual(["Isaac"]);
});

it("reads a name kept with a note in brackets without the note too", () => {
  expect(personWords({ fullName: "Brent (Service) Gilmore", firstName: "Brent (Service)" })).toEqual(
    expect.arrayContaining(["Brent (Service) Gilmore", "Brent Gilmore", "Brent (Service)", "Brent"]),
  );
  expect(named("Brent meets them there")).toEqual(["Brent"]);
});

it("counts a name that's an everyday word only with a capital", () => {
  expect(named("Isaac will ring Will")).toEqual(["Isaac", "Will"]);
});

it("never matches inside a word", () => {
  expect(named("Lukewarm water, a callumbo")).toEqual([]);
});

it("cuts the words at each name, keeping every letter", () => {
  const text = "Tell Luke and Callum.";
  const runs = nameRuns(text, PEOPLE);
  expect(runs).toEqual([
    { text: "Tell ", name: null },
    { text: "Luke", name: "Luke Ingold" },
    { text: " and ", name: null },
    { text: "Callum", name: "Callum Vrieze" },
    { text: ".", name: null },
  ]);
  expect(runs.map((r) => r.text).join("")).toBe(text);
});

it("leaves the words whole when nobody is named, or nobody is known", () => {
  expect(nameRuns("ready to book in", PEOPLE)).toEqual([{ text: "ready to book in", name: null }]);
  expect(nameRuns("Tell Luke", [])).toEqual([{ text: "Tell Luke", name: null }]);
});

it("flags each heard word that is part of a name", () => {
  expect(namedWords(["tell", "Alex", "Lorenz", "and", "Luke,"], PEOPLE)).toEqual([false, true, true, false, true]);
});
