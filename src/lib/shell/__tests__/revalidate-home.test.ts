/**
 * @jest-environment node
 */
import fs from "node:fs";
import path from "node:path";

const revalidatePath = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

import { HOME_PATHS, revalidateHome } from "../revalidate-home";

/* Home is three addresses (v2): a write Home shows refreshes each, and each
   is a page that exists, so none is a revalidate aimed at nothing. */
it("(F) refreshes Home, To do's whole list and the desk", () => {
  revalidateHome();
  expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual(["/dashboard", "/dashboard/todo", "/dashboard/desk"]);
});

it.each([...HOME_PATHS])("names a page that exists: %s", (p) => {
  expect(fs.existsSync(path.join(process.cwd(), "src/app", p, "page.tsx"))).toBe(true);
});
