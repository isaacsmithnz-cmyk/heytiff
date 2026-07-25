import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddressField } from "../address-field";

/* The address box.

   THE FIRST TEST IS THE IMPORTANT ONE. This is a text input that offers help,
   not a picker: an address Google has never heard of — a new estate, a shed
   down a rural road — has to be typeable, and every test below that touches
   the dropdown still leaves the raw value reaching onChange.

   `fetch` is a mock for the whole file and the only URL it is ever allowed to
   see is /api/address. The key isn't in this component's world at all: there
   is no Google host here to type wrongly. */

const fetchMock = jest.fn();
const realFetch = global.fetch;
global.fetch = fetchMock as unknown as typeof fetch;

const SUGGESTIONS = [
  { placeId: "PLACE_1", text: "12 Trade St, Ringwood VIC 3134, Australia" },
  { placeId: "PLACE_2", text: "12 Trade St, Bayswater VIC 3153, Australia" },
];

const PARTS = { address: "12 Trade St", suburb: "Ringwood", state: "VIC", postcode: "3134" };
const FORMATTED = "12 Trade St, Ringwood VIC 3134, Australia";

const jsonOk = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

/** suggest → the two rows; resolve → Ringwood. The default happy path. */
function happyPath() {
  fetchMock.mockImplementation((_url: string, init: { body: string }) => {
    const { op } = JSON.parse(init.body);
    if (op === "suggest") return Promise.resolve(jsonOk({ enabled: true, suggestions: SUGGESTIONS }));
    return Promise.resolve(jsonOk({ enabled: true, formatted: FORMATTED, parts: PARTS }));
  });
}

const opsCalled = () =>
  fetchMock.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body).op);

/** The field is controlled; this is the card that would own the value. */
function Harness({
  enabled = true,
  onResolve,
  initial = "",
}: {
  enabled?: boolean;
  onResolve?: (parts: typeof PARTS, formatted: string) => void;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <AddressField
        name="address"
        value={value}
        enabled={enabled}
        onChange={setValue}
        onResolve={onResolve}
        placeholder="Street, suburb, state, postcode"
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

/* By placeholder, deliberately: the SAME query has to find the field whether
   lookup is on (role=combobox) or off (a plain textbox), because the promise
   is that those are one control in two states. */
const field = () =>
  screen.getByPlaceholderText("Street, suburb, state, postcode") as HTMLInputElement;
const value = () => screen.getByTestId("value").textContent;

beforeEach(() => {
  jest.clearAllMocks();
  happyPath();
});

afterAll(() => {
  global.fetch = realFetch;
});

describe("it is a text box first", () => {
  it("takes an address no lookup has ever heard of", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(field(), "Lot 4 Sawmill Track, Yackandandah VIC 3749");

    expect(value()).toBe("Lot 4 Sawmill Track, Yackandandah VIC 3749");
    // the dropdown had suggestions to offer and they were not substituted
    expect(field()).toHaveValue("Lot 4 Sawmill Track, Yackandandah VIC 3749");
  });

  it("looks like every other field on the card", () => {
    render(<Harness />);
    expect(field()).toHaveClass("inp");
    expect(field()).toHaveAttribute("id", "address");
    expect(field()).toHaveAttribute("name", "address");
  });
});

describe("with no key configured (enabled=false)", () => {
  it("never calls anything, however much you type", async () => {
    const user = userEvent.setup();
    render(<Harness enabled={false} />);

    await user.type(field(), "12 Trade Street Ringwood");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(value()).toBe("12 Trade Street Ringwood");
  });

  it("is not even announced as a combobox — it is an input", async () => {
    render(<Harness enabled={false} />);
    expect(field()).not.toHaveAttribute("role");
    expect(field()).not.toHaveAttribute("aria-expanded");
  });
});

describe("asking", () => {
  it("waits for a pause, then asks once for the whole burst", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<Harness />);

    await user.type(field(), "12 Trade St");
    // mid-typing: nothing has gone out
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(250);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/address");
    expect(JSON.parse(init.body)).toMatchObject({ op: "suggest", input: "12 Trade St" });
    jest.useRealTimers();
  });

  it("says nothing under three characters", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(field(), "12");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("carries a session token, and the same one across the keystrokes of a lookup", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(field(), "12 Tra");
    await screen.findByRole("listbox");
    await user.type(field(), "de");
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));

    const tokens = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).sessionToken);
    expect(tokens[0]).toEqual(expect.any(String));
    expect(tokens[0]).not.toHaveLength(0);
    expect(new Set(tokens).size).toBe(1);
  });

  it("closes the list again when the box drops under three characters", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(field(), "12 Trade");
    await screen.findByRole("listbox");

    await user.clear(field());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("the dropdown", () => {
  it("shows what came back, portalled out to <body>", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);

    await user.type(field(), "12 Trade");
    const list = await screen.findByRole("listbox");

    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByText(SUGGESTIONS[0].text)).toBeInTheDocument();
    // out of the .page subtree, inside a display:contents .fg — the shell's
    // will-change would otherwise anchor a fixed popover to the page
    expect(container).not.toContainElement(list);
    expect(list.parentElement).toHaveClass("fg");
    expect(field()).toHaveAttribute("aria-expanded", "true");
  });

  it("offers nothing when Google found nothing", async () => {
    fetchMock.mockResolvedValue(jsonOk({ enabled: true, suggestions: [] }));
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(field(), "qqqqqq");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("picking one", () => {
  it("fills the box with the formatted line and hands over the parts", async () => {
    const onResolve = jest.fn();
    const user = userEvent.setup();
    render(<Harness onResolve={onResolve} />);

    await user.type(field(), "12 Trade");
    await screen.findByRole("listbox");
    await user.click(screen.getByText(SUGGESTIONS[0].text));

    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(PARTS, FORMATTED));
    expect(value()).toBe(FORMATTED);
    // and it closed
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("resolves by place id, with the session token that closes the billing session", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(field(), "12 Trade");
    await screen.findByRole("listbox");
    await user.click(screen.getByText(SUGGESTIONS[1].text));

    await waitFor(() => expect(opsCalled()).toContain("resolve"));
    const resolveCall = fetchMock.mock.calls.find(
      (c) => JSON.parse(c[1].body).op === "resolve"
    )!;
    const sent = JSON.parse(resolveCall[1].body);
    expect(sent.placeId).toBe("PLACE_2");
    expect(sent.sessionToken).toEqual(expect.any(String));
  });

  it("starts a fresh billing session for the next lookup", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(field(), "12 Trade");
    await screen.findByRole("listbox");
    await user.click(screen.getByText(SUGGESTIONS[0].text));
    await waitFor(() => expect(value()).toBe(FORMATTED));

    await user.clear(field());
    await user.type(field(), "9 Other Rd");
    await waitFor(() => expect(opsCalled().filter((o) => o === "suggest").length).toBe(2));

    const [first, , second] = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).sessionToken);
    expect(second).not.toBe(first);
  });

  it("keeps the line you picked when the details call fails", async () => {
    const onResolve = jest.fn();
    fetchMock.mockImplementation((_url: string, init: { body: string }) => {
      const { op } = JSON.parse(init.body);
      if (op === "suggest")
        return Promise.resolve(jsonOk({ enabled: true, suggestions: SUGGESTIONS }));
      return Promise.resolve({ ok: false, status: 502, json: async () => ({ error: "nope" }) });
    });
    const user = userEvent.setup();
    render(<Harness onResolve={onResolve} />);

    await user.type(field(), "12 Trade");
    await screen.findByRole("listbox");
    await user.click(screen.getByText(SUGGESTIONS[0].text));

    // the suggestion's own line, rather than the half-typed "12 Trade"
    await waitFor(() => expect(value()).toBe(SUGGESTIONS[0].text));
    expect(onResolve).not.toHaveBeenCalled();
  });
});

describe("the keyboard", () => {
  it("arrows to a row and takes it with Enter", async () => {
    const onResolve = jest.fn();
    const user = userEvent.setup();
    render(<Harness onResolve={onResolve} />);

    await user.type(field(), "12 Trade");
    await screen.findByRole("listbox");

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");
    await waitFor(() => expect(onResolve).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).placeId).toBe("PLACE_2");
  });

  it("wraps around, and Up from the top goes to the bottom", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(field(), "12 Trade");
    await screen.findByRole("listbox");

    await user.keyboard("{ArrowUp}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });

  /* Enter with nothing highlighted belongs to whatever the person was typing —
     an address the lookup doesn't know must never be silently replaced by the
     first thing that looks close. */
  it("does nothing on Enter until a row is highlighted", async () => {
    const onResolve = jest.fn();
    const user = userEvent.setup();
    render(<Harness onResolve={onResolve} />);

    await user.type(field(), "12 Trade");
    await screen.findByRole("listbox");
    await user.keyboard("{Enter}");

    expect(onResolve).not.toHaveBeenCalled();
    expect(opsCalled()).not.toContain("resolve");
    expect(value()).toBe("12 Trade");
  });

  it("closes on Escape, leaving what was typed alone", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(field(), "12 Trade");
    await screen.findByRole("listbox");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(value()).toBe("12 Trade");
  });

  it("closes when focus tabs away", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(field(), "12 Trade");
    await screen.findByRole("listbox");

    await user.tab();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("clicking outside", () => {
  it("closes the list", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(field(), "12 Trade");
    await screen.findByRole("listbox");

    await user.click(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("when the server says there is no key after all", () => {
  it("switches itself off instead of asking again every keystroke", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ enabled: false }) });
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(field(), "12 Trade");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.type(field(), " Street Ringwood");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // and the typing all landed
    expect(value()).toBe("12 Trade Street Ringwood");
  });

  it("says nothing about it — an address box without autocomplete is an address box", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(field(), "12 Trade");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(value()).toBe("12 Trade");
  });
});

describe("the only host it knows", () => {
  it("is our own proxy", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(field(), "12 Trade");
    await screen.findByRole("listbox");
    await user.click(screen.getByText(SUGGESTIONS[0].text));
    await waitFor(() => expect(opsCalled()).toContain("resolve"));

    for (const [url] of fetchMock.mock.calls) {
      expect(url).toBe("/api/address");
    }
  });
});
