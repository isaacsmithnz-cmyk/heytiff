/**
 * @jest-environment node
 */
/* Tiff's session is on only with a model chosen AND the business listed
   (slice 4.4: his business first): anything else spends nothing. */
jest.mock("server-only", () => ({}));
import { chosenModel, sessionModelFor } from "../model-server";

afterEach(() => {
  delete process.env.QUOTE_SESSION_MODEL;
  delete process.env.QUOTE_SESSION_ORGS;
});

it("is off with no model, or for a business not listed", () => {
  expect(sessionModelFor("org-1")).toBeNull();
  process.env.QUOTE_SESSION_MODEL = "claude-opus-5-5";
  expect(sessionModelFor("org-1")).toBeNull();
  process.env.QUOTE_SESSION_ORGS = "org-2, org-1";
  expect(sessionModelFor("org-1")).toBe("claude-opus-5-5");
  expect(sessionModelFor("org-3")).toBeNull();
});

it("takes only a model's own name", () => {
  process.env.QUOTE_SESSION_MODEL = "anything; drop table";
  expect(chosenModel()).toBeNull();
});
