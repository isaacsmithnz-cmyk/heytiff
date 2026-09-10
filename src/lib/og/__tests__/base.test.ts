import { metadataBaseFromEnv } from "../base";

describe("the preview base URL", () => {
  it("is the canonical host when APP_BASE_URL is set", () => {
    expect(metadataBaseFromEnv("https://go.example.com")?.href).toBe("https://go.example.com/");
  });

  it("is undefined when the variable is unset or not a URL, so a preview branch still builds", () => {
    expect(metadataBaseFromEnv(undefined)).toBeUndefined();
    expect(metadataBaseFromEnv("")).toBeUndefined();
    expect(metadataBaseFromEnv("not a url")).toBeUndefined();
  });
});
