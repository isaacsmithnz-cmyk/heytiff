import { homeHtml, blankHtml } from "../screens";

describe("screen builders", () => {
  it("home greeting includes the name and greeting", () => {
    const html = homeHtml({ greeting: "Good morning", firstName: "Isaac", date: "Monday" });
    expect(html).toContain("Good morning");
    expect(html).toContain("Isaac");
    expect(html).toContain("Monday");
  });

  /* The Admin landing left this file: it is React now
     (components/admin/admin-index.tsx), covered by its own suite. */

  it("blank screen renders its title and empty hint", () => {
    const html = blankHtml("Design Studio");
    expect(html).toContain("Design Studio");
    expect(html).toContain("Nothing here yet.");
  });
});
