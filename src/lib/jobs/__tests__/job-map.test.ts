import { HEAD_MAP_SIZE, headMapSize, mapAddress, mapShape, pinHue, staticMapUrl } from "../job-map";

/* The map over a job's address (Isaac, 14 November 2026: "Yes, add the map") */
it("asks for the address as written, its lines joined, else the suburb line", () => {
  expect(mapAddress({ address: "910/226 Victoria St\nPotts Point NSW 2011" })).toBe("910/226 Victoria St, Potts Point NSW 2011");
  expect(mapAddress({ address: "  ", geoLine: "Rose Bay NSW 2029" })).toBe("Rose Bay NSW 2029");
  expect(mapAddress({ address: null, geoLine: null })).toBeNull();
});

it("draws one grey picture 320 by 96 at twice the pixels, the pin in the job's colour", () => {
  const url = new URL(staticMapUrl("910/226 Victoria St, Potts Point NSW 2011", "green", "k"));
  expect(url.origin + url.pathname).toBe("https://maps.googleapis.com/maps/api/staticmap");
  expect(url.searchParams.get("size")).toBe("320x96");
  expect(url.searchParams.get("scale")).toBe("2");
  expect(url.searchParams.get("markers")).toBe("color:0x15803D|910/226 Victoria St, Potts Point NSW 2011");
  expect(url.searchParams.getAll("style")).toContain("saturation:-100");
});

it("takes only a hue of the palette for the pin, grey otherwise", () => {
  expect(pinHue("pink")).toBe("pink");
  expect(pinHue("teal")).toBe("grey");
  expect(pinHue(null)).toBe("grey");
});

/* the head's map (Isaac, 16 November 2026: "zoomed out a bit more so you can see surrounding areas") */
it("asks for the head's wide picture one step further out, and anything else as the card's", () => {
  const head = new URL(staticMapUrl("3 Surrey St, Marrickville NSW 2204", "purple", "k", mapShape("head")));
  expect(head.searchParams.get("size")).toBe("640x112");
  expect(head.searchParams.get("zoom")).toBe("15");
  expect(head.searchParams.get("scale")).toBe("2");
  const card = new URL(staticMapUrl("3 Surrey St, Marrickville NSW 2204", "purple", "k", mapShape("anything")));
  expect(card.searchParams.get("size")).toBe("320x96");
  expect(card.searchParams.get("zoom")).toBe("16");
});

/* the head's map in colour (Isaac, 16 November 2026: "the map should be in color"); the card's grey */
it("draws the head's map in colour and the card's grey", () => {
  const styles = (shape: "head" | "card") => new URL(staticMapUrl("3 Surrey St", "purple", "k", shape)).searchParams.getAll("style");
  expect(styles("head")).not.toContain("saturation:-100");
  expect(styles("card")).toContain("saturation:-100");
  expect(styles("head")).toContain("feature:poi|visibility:off");
});

/* the head's map drawn to its card (bug 52, Isaac, 20 November 2026: "map misaligned") */
it("asks for the head's picture at its card's size, whole pixels, in Google's bounds, and the wide one without a size", () => {
  expect(headMapSize(380, 164)).toEqual({ width: 380, height: 164 });
  expect(headMapSize("380.4", "119.6")).toEqual({ width: 380, height: 120 });
  expect(headMapSize(2000, 20)).toEqual({ width: 640, height: 96 });
  expect(headMapSize(null, 120)).toEqual(HEAD_MAP_SIZE);
  expect(headMapSize("wide", "tall")).toEqual(HEAD_MAP_SIZE);
  const sized = new URL(staticMapUrl("3 Surrey St", "purple", "k", "head", { width: 380, height: 164 }));
  expect(sized.searchParams.get("size")).toBe("380x164");
  expect(sized.searchParams.get("zoom")).toBe("15");
  /* a size is the head's only: the card keeps its own */
  expect(new URL(staticMapUrl("3 Surrey St", "purple", "k", "card", { width: 380, height: 164 })).searchParams.get("size")).toBe("320x96");
});
