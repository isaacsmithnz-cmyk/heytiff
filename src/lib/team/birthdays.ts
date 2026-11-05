/* BIRTHDAYS, the pure half (Isaac, 6 November 2026: "people to get a push
   notification for other staff members birthdays", then "Staff have to opt
   in, tick to share bday, tick to share age").

   A birthday is shared only when its person ticks Share my birthday on their
   own card; the age only with a second tick, Share my age, which means
   nothing without the first. Nobody hears about their own.

   Days are 'YYYY-MM-DD' text and compared by their month and day; the one
   Date here reads a day, never a time. A 29 February birthday falls on
   28 February in a year without one. */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Does a birthday fall on this day? */
export function birthdayOn(birthday: string | null | undefined, day: string): boolean {
  const b = DAY.exec(String(birthday ?? "").slice(0, 10));
  const d = DAY.exec(day);
  if (!b || !d) return false;
  const [bm, bd] = [b[2], b[3]];
  const [dy, dm, dd] = [Number(d[1]), d[2], d[3]];
  if (bm === dm && bd === dd) return true;
  return bm === "02" && bd === "29" && !leap(dy) && dm === "02" && dd === "28";
}

/** How old they turn on their birthday in this day's year. */
export function ageOn(birthday: string, day: string): number | null {
  const b = DAY.exec(birthday.slice(0, 10));
  const d = DAY.exec(day);
  if (!b || !d) return null;
  const age = Number(d[1]) - Number(b[1]);
  return age > 0 && age < 120 ? age : null;
}

export type SharedBirthday = { name: string; age: number | null };

/** Who is shared today, and how they read: their first name, and their age only where they share it too. */
export function sharedBirthdays(
  people: readonly { id: string; name: string; birthday: string | null; shareBirthday: boolean; shareAge: boolean }[],
  day: string,
  exceptId?: string | null,
): (SharedBirthday & { id: string })[] {
  return people
    .filter((p) => p.shareBirthday && p.id !== exceptId && birthdayOn(p.birthday, day))
    .map((p) => ({ id: p.id, name: p.name, age: p.shareAge && p.birthday ? ageOn(p.birthday, day) : null }));
}

/** The push's words: "It's Callum's birthday today", or "Leo turns 30 today". */
export function birthdayWords(b: SharedBirthday): string {
  return b.age ? `${b.name} turns ${b.age} today` : `It's ${b.name}'s birthday today`;
}

/** A person's first name, as the team calls them. */
export function firstNameOf(p: { preferred_name?: string | null; first_name?: string | null; full_name?: string | null }): string {
  return (p.preferred_name?.trim() || p.first_name?.trim() || p.full_name?.trim().split(/\s+/)[0] || "").trim() || "Someone";
}
