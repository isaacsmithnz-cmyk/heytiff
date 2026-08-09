import { checkEnglish, looksNonEnglish } from "../english";

/* The net in front of the review card.

   The asymmetry these pin: a false yes costs one cheap translation pass over
   text that was already English, and a false no leaves a record nobody on the
   board can read. So the misses matter more — EXCEPT where a name is
   involved, which is the one place a false yes does damage. */

describe("records that must be repaired", () => {
  it.each([
    // Spanish
    ["Cambiar el filtro del rooftop antes del lunes"],
    ["cambiar filtro"],
    ["¿Dónde está la llave?"],
    // Vietnamese
    ["Thay lọc gió tuần sau"],
    // Tagalog
    ["Kailangan palitan ang filter bukas"],
    // Chinese and Arabic — one character is enough
    ["明天要检查风机"],
    ["يجب استبدال الفلتر"],
  ])("%j is not English", (text) => {
    expect(looksNonEnglish(text)).toBe(true);
  });

  it("says what it found, so a wrong call can be read rather than re-derived", () => {
    const c = checkEnglish("Cambiar el filtro antes del lunes");
    expect(c.foreign).toBe(true);
    expect(c.reasons.length).toBeGreaterThanOrEqual(2);
  });
});

describe("records that must be left alone", () => {
  it.each([
    ["Order the new grilles for Smith Street before Monday"],
    ["The middle rooftop unit tripped again on Tuesday"],
    ["Gate code 4417, roof key behind the front desk"],
    [""],
    ["   "],
  ])("%j is English", (text) => {
    expect(looksNonEnglish(text)).toBe(false);
  });

  it("a name is not a language", () => {
    /* THE TRAP THIS EXISTS FOR: records are full of accented strings that
       are not foreign — people, clients, sites. One piece of Latin-script
       evidence is never enough on its own. */
    expect(looksNonEnglish("Call José about the grilles")).toBe(false);
    expect(looksNonEnglish("Muñoz rang about the Meridian Café job")).toBe(false);
  });

  it("trade notation is not a language either", () => {
    /* Greek is deliberately absent from the script list: Ω and µ are how
       this trade writes resistance and microns. */
    expect(looksNonEnglish("Coil sensor reads 15.0 kΩ at 0°C")).toBe(false);
    expect(looksNonEnglish("Superheat ±2°C, µm filter fitted")).toBe(false);
    expect(looksNonEnglish("PUZ-ZM250VKA throwing P8 in heating")).toBe(false);
  });
});
