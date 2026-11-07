import { ageOn, birthdayOn, birthdayWords, firstNameOf, sharedBirthdays } from "../birthdays";

describe("birthdayOn", () => {
  it("falls on the same month and day in any year", () => {
    expect(birthdayOn("2002-11-16", "2026-11-16")).toBe(true);
    expect(birthdayOn("2002-11-16", "2026-11-17")).toBe(false);
  });
  it("puts 29 February on 28 February in a year without one, and only then", () => {
    expect(birthdayOn("2000-02-29", "2027-02-28")).toBe(true);
    expect(birthdayOn("2000-02-29", "2028-02-28")).toBe(false);
    expect(birthdayOn("2000-02-29", "2028-02-29")).toBe(true);
  });
  it("is never true for a missing or broken day", () => {
    expect(birthdayOn(null, "2026-11-16")).toBe(false);
    expect(birthdayOn("16/11/2002", "2026-11-16")).toBe(false);
  });
});

describe("ageOn", () => {
  it("is the years between", () => expect(ageOn("1996-11-18", "2026-11-18")).toBe(30));
  it("is nothing for a day that can't be a birthday", () => expect(ageOn("2027-01-01", "2026-11-18")).toBeNull());
});

describe("sharedBirthdays", () => {
  const people = [
    { id: "a", name: "Callum", birthday: "2002-11-16", shareBirthday: true, shareAge: false },
    { id: "b", name: "Leo", birthday: "1996-11-16", shareBirthday: true, shareAge: true },
    { id: "c", name: "Alex", birthday: "1990-11-16", shareBirthday: false, shareAge: true },
  ];
  it("shares only those who ticked it, their age only where they ticked that too, and never your own", () => {
    expect(sharedBirthdays(people, "2026-11-16", "b")).toEqual([{ id: "a", name: "Callum", age: null }]);
    expect(sharedBirthdays(people, "2026-11-16")).toEqual([
      { id: "a", name: "Callum", age: null },
      { id: "b", name: "Leo", age: 30 },
    ]);
  });
});

describe("birthdayWords", () => {
  it("says the birthday, or the age when shared", () => {
    expect(birthdayWords({ name: "Callum", age: null })).toBe("It's Callum's birthday today");
    expect(birthdayWords({ name: "Leo", age: 30 })).toBe("Leo turns 30 today");
  });
});

describe("firstNameOf", () => {
  it("takes the name they go by first", () => {
    expect(firstNameOf({ preferred_name: "Mick", first_name: "Michael" })).toBe("Mick");
    expect(firstNameOf({ first_name: "Michael" })).toBe("Michael");
    expect(firstNameOf({ full_name: "Oleksii Khalameida" })).toBe("Oleksii");
    expect(firstNameOf({})).toBe("Someone");
  });
});
