import { mapAddress, mapShape, pinHue, staticMapUrl } from "../job-map";

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
