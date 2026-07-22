import { cleanup, render, waitFor } from "@testing-library/react";
import { ProfileBehaviors } from "../profile-behaviors";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

afterEach(cleanup);

/* Minimal stand-in for a profile/org screen: two editable cards and one
   read-only (data-static) card, matching the real markup's shape. */
const HTML = `
  <div class="prof">
    <div class="card2" data-section="one">
      <div class="c2h"><span><b>One</b></span></div>
      <input class="inp" name="a" value="">
    </div>
    <div class="card2" data-section="two">
      <div class="c2h"><span><b>Two</b></span></div>
      <input class="inp" name="b" value="">
    </div>
    <div class="card2" data-static>
      <div class="c2h"><span><b>Static</b></span></div>
    </div>
  </div>`;

const cards = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>(".card2")];
const actions = (el: HTMLElement) => el.querySelectorAll(".cardactions").length;

describe("ProfileBehaviors — seeding", () => {
  it("locks every card and injects Edit/Cancel/Save on mount", async () => {
    const { container } = render(<ProfileBehaviors html={HTML} />);
    await waitFor(() => expect(actions(container)).toBe(2));
    expect(cards(container).every((c) => c.classList.contains("readonly"))).toBe(true);
    expect(container.querySelectorAll("[data-edit]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-save]")).toHaveLength(2);
  });

  it("gives a data-static card no Edit affordance", async () => {
    const { container } = render(<ProfileBehaviors html={HTML} />);
    await waitFor(() => expect(actions(container)).toBe(2));
    const staticCard = cards(container).find((c) => c.hasAttribute("data-static"))!;
    expect(staticCard.querySelector(".cardactions")).toBeNull();
  });
});

describe("ProfileBehaviors — recovery when the subtree is replaced", () => {
  /* The bug: this screen is injected with dangerouslySetInnerHTML, so a
     re-render (e.g. after a server action saves) swaps in fresh server markup
     that has neither the readonly class nor the injected buttons. Before the
     fix, the card was left permanently unlocked with no way to save it —
     only a reload recovered. */
  it("re-injects the buttons after the nodes are swapped out", async () => {
    const { container } = render(<ProfileBehaviors html={HTML} />);
    await waitFor(() => expect(actions(container)).toBe(2));

    const root = container.firstElementChild as HTMLElement;
    root.innerHTML = HTML; // what React does on re-render with new server data
    expect(actions(container)).toBe(0); // wiped, as observed in the browser

    await waitFor(() => expect(actions(container)).toBe(2));
    expect(cards(container).every((c) => c.classList.contains("readonly"))).toBe(true);
  });

  it("does not re-lock a card the user is currently editing", async () => {
    const { container } = render(<ProfileBehaviors html={HTML} />);
    await waitFor(() => expect(actions(container)).toBe(2));

    const [first] = cards(container);
    first.querySelector<HTMLElement>("[data-edit]")!.click();
    expect(first.classList.contains("readonly")).toBe(false);

    // an unrelated mutation (e.g. an error banner appearing) fires the observer
    const banner = document.createElement("div");
    banner.className = "carderr";
    first.appendChild(banner);

    await new Promise((r) => setTimeout(r, 20));
    expect(first.classList.contains("readonly")).toBe(false);
    expect(actions(container)).toBe(2); // and nothing was duplicated
  });

  it("settles instead of looping — injection does not retrigger itself", async () => {
    const { container } = render(<ProfileBehaviors html={HTML} />);
    await waitFor(() => expect(actions(container)).toBe(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(actions(container)).toBe(2);
    expect(container.querySelectorAll("[data-save]")).toHaveLength(2);
  });
});

describe("ProfileBehaviors — per-card edit model", () => {
  it("unlocks only the clicked card", async () => {
    const { container } = render(<ProfileBehaviors html={HTML} />);
    await waitFor(() => expect(actions(container)).toBe(2));
    const [one, two] = cards(container);
    one.querySelector<HTMLElement>("[data-edit]")!.click();
    expect(one.classList.contains("readonly")).toBe(false);
    expect(two.classList.contains("readonly")).toBe(true);
  });

  it("sends only its own card's fields, and re-locks on success", async () => {
    const onSave = jest.fn().mockResolvedValue({ ok: true });
    const { container } = render(<ProfileBehaviors html={HTML} onSave={onSave} />);
    await waitFor(() => expect(actions(container)).toBe(2));

    const [one] = cards(container);
    one.querySelector<HTMLElement>("[data-edit]")!.click();
    one.querySelector<HTMLInputElement>('[name="a"]')!.value = "typed";
    one.querySelector<HTMLElement>("[data-save]")!.click();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith("one", { a: "typed" });
    await waitFor(() => expect(one.classList.contains("readonly")).toBe(true));
  });

  it("keeps the card open and shows the error when saving fails", async () => {
    const onSave = jest.fn().mockResolvedValue({ ok: false, error: "Nope." });
    const { container } = render(<ProfileBehaviors html={HTML} onSave={onSave} />);
    await waitFor(() => expect(actions(container)).toBe(2));

    const [one] = cards(container);
    one.querySelector<HTMLElement>("[data-edit]")!.click();
    one.querySelector<HTMLInputElement>('[name="a"]')!.value = "kept";
    one.querySelector<HTMLElement>("[data-save]")!.click();

    await waitFor(() => expect(one.querySelector(".carderr")?.textContent).toBe("Nope."));
    expect(one.classList.contains("readonly")).toBe(false);
    expect(one.querySelector<HTMLInputElement>('[name="a"]')!.value).toBe("kept");
  });
});
