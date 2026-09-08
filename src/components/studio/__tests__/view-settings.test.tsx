/* The canvas's two machine settings — what a bare scroll does, and whether
   the canvas talks you through the armed tool — and the reason they moved.

   They shipped as icon-only buttons leading the zoom strip, and Isaac could
   not read any of them: "the i symbol doesn't do anything, and it looks like
   it's a clickable icon. I don't actually know what it does." Both were
   settings whose consequence is invisible at the moment you press them — the
   wheel mode's "zooms" half was a diagonal-arrows EXPAND glyph two buttons
   from Fit, and the hints button's only feedback is a window that exists just
   while a tool is armed, so with Select active pressing it changes nothing.

   A tooltip does not fix that; words do. They are lines in the View popover
   now, beside Layers and Black & white — the menu that already answers "how
   does this view look". These pin that they are reachable BY WHAT THEY DO,
   and that each still drives its own store. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio } from "../studio";
import { LocalDesignStore } from "@/lib/studio/store";

const localStudio = () => <Studio store={new LocalDesignStore(window.localStorage)} />;

/** Straight to the Design step with the View popover open. */
async function openViewMenu() {
  const user = userEvent.setup();
  render(localStudio());
  await user.click(await screen.findByText("New design"));
  await user.type(screen.getByPlaceholderText(/Design name/), "View test");
  await user.click(screen.getByRole("button", { name: /Continue/ }));
  await user.click(screen.getByText("Blank canvas"));
  await user.click(await screen.findByRole("button", { name: "Design" }));
  await user.click(screen.getByRole("button", { name: /View/ }));
  return user;
}

beforeEach(() => {
  localStorage.clear();
});

describe("the settings say what they do", () => {
  /* THE GUARD THAT MATTERS. Both of these were unreadable as glyphs; if either
     ever goes back to being reachable only by a picture, this fails. */
  it("names every choice in words", async () => {
    await openViewMenu();

    expect(screen.getByRole("radio", { name: "Zoom in and out" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Move around the plan" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Show tool hints" })).toBeInTheDocument();
  });

  /* One View menu, not two. The Studio already had a View popover answering
     "how does this view look", and a second control of the same name on the
     zoom strip would be worse than the glyphs it replaced. */
  it("puts them in the View menu that already exists, beside its other rows", async () => {
    await openViewMenu();

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("checkbox", { name: "Show legend" })).toBeInTheDocument();
    expect(within(menu).getByRole("checkbox", { name: "Show tool hints" })).toBeInTheDocument();
    expect(within(menu).getByRole("radio", { name: "Zoom in and out" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^View$/ })).toHaveLength(1);
  });
});

describe("what a bare scroll does", () => {
  /* THE DEFAULT IS WHY THIS IS PINNED: it shipped as "zoom" for one day and
     left a trackpad unable to cross a plan, because two fingers zoomed and a
     pad has no other pan gesture. */
  it("defaults to moving the plan, so a trackpad can cross it out of the box", async () => {
    await openViewMenu();

    expect(screen.getByRole("radio", { name: "Move around the plan" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Zoom in and out" })).not.toBeChecked();
  });

  it("remembers the choice on this machine", async () => {
    const user = await openViewMenu();

    await user.click(screen.getByRole("radio", { name: "Zoom in and out" }));

    expect(screen.getByRole("radio", { name: "Zoom in and out" })).toBeChecked();
    expect(localStorage.getItem("ht-wheel")).toBe("zoom");
  });

  it("takes the stored choice on the next visit", async () => {
    localStorage.setItem("ht-wheel", "zoom");
    await openViewMenu();

    expect(screen.getByRole("radio", { name: "Zoom in and out" })).toBeChecked();
  });
});

describe("tool hints", () => {
  it("are on by default — the guided answer", async () => {
    await openViewMenu();
    expect(screen.getByRole("checkbox", { name: "Show tool hints" })).toBeChecked();
  });

  /* Turning them OFF is still done on the hint itself, where the annoyance is.
     This row's whole job is being the way back ON, which is the one thing the
     old info glyph could never show you it had done. */
  it("turn off and back on from here, and the choice survives", async () => {
    const user = await openViewMenu();
    const row = () => screen.getByRole("checkbox", { name: "Show tool hints" });

    await user.click(row());
    expect(row()).not.toBeChecked();
    expect(localStorage.getItem("ht-studio-hints")).toBe("off");

    await user.click(row());
    expect(row()).toBeChecked();
    expect(localStorage.getItem("ht-studio-hints")).toBe("on");
  });
});
