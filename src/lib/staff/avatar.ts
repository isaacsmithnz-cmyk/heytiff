/* One colour per person, from their name.

   The Team directory tints each person's initials with it, and the staff card
   paints the same hue behind theirs, so a person reads as the same colour on
   both screens. It lived inside the directory until the card needed it too.

   The hash is deliberately dumb: stable across renders and servers, and good
   enough to tell eight people apart. It is not an identity. */
export function nameHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/* The staff card's tile carries WHITE initials, so its colour has to be dark
   enough for them at every hue. At 34% lightness the worst hue (yellow, ~60°)
   still measures above 3:1 against white, which is the bar for 24px bold
   type; the directory's 56% is a ring colour, not a ground for text. */
export function avatarGround(name: string): string {
  return `hsl(${nameHue(name)} 62% 34%)`;
}
