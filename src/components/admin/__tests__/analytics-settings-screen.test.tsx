/* Admin, Analytics: what a setting never saved shows, and what each Save sends. */
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));
const save = jest.fn();
jest.mock("@/app/actions/analytics-settings", () => ({ saveAnalyticsSettings: (s: unknown) => save(s) }));

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_SETTINGS } from "@/lib/analytics/settings";
import { AnalyticsSettingsScreen } from "../analytics-settings-screen";

const CATS = [
  { uuid: "c-ins", name: "Install", jobs: 612 },
  { uuid: "c-war", name: "Warranty", jobs: 100 },
];
const CLIENTS = [{ id: "tafe", name: "TAFE NSW", cards: 161 }];

beforeEach(() => {
  save.mockReset().mockImplementation(async (s) => ({ ok: true, settings: s }));
});

const show = (over: Partial<Parameters<typeof AnalyticsSettingsScreen>[0]> = {}) =>
  render(
    <AnalyticsSettingsScreen
      initial={DEFAULT_SETTINGS}
      ready
      categories={CATS}
      clients={CLIENTS}
      closeAge={{ days: 60, count: 35 }}
      {...over}
    />,
  );

describe("AnalyticsSettingsScreen", () => {
  it("shows what stands in for each setting never saved", () => {
    show();
    expect(screen.getByLabelText("Days with no answer before a quote counts as lost")).toHaveAttribute("placeholder", "180");
    expect(screen.getByRole("option", { name: "As found in your jobs: at 60 days" })).toBeInTheDocument();
    expect(screen.getByText("35 Unsuccessful quotes were closed 60 days to the hour after they became one.")).toBeInTheDocument();
    expect(screen.getByLabelText("What Install jobs are")).toHaveValue("install");
    expect(screen.getByLabelText("What Warranty jobs are")).toHaveValue("warranty");
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByText(/Until this list is saved, the ones found in your jobs are left out/)).toBeInTheDocument();
  });

  it("saves the counting rules, blank as not set", async () => {
    show();
    fireEvent.change(screen.getByLabelText("Days with no answer before a quote counts as lost"), { target: { value: "120" } });
    fireEvent.click(within(screen.getByRole("heading", { name: "Counting quotes" }).closest("section")!).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, lapseAfterDays: 120, quoteFromCents: null }));
  });

  it("won't save a lost-after under 91 days", () => {
    show();
    fireEvent.change(screen.getByLabelText("Days with no answer before a quote counts as lost"), { target: { value: "30" } });
    const section = screen.getByRole("heading", { name: "Counting quotes" }).closest("section")!;
    expect(within(section).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves that ServiceM8 never closes quotes as 0", async () => {
    show();
    fireEvent.change(screen.getByRole("combobox", { name: "ServiceM8 closes them" }), { target: { value: "never" } });
    fireEvent.click(within(screen.getByRole("heading", { name: "When ServiceM8 closes a quote" }).closest("section")!).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, autoCloseDays: 0 }));
  });

  it("saves every category's role, the read ones included", async () => {
    show();
    fireEvent.change(screen.getByLabelText("What Install jobs are"), { target: { value: "other" } });
    fireEvent.click(within(screen.getByRole("heading", { name: "Categories" }).closest("section")!).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, categoryRoles: { "c-ins": "other", "c-war": "warranty" } }),
    );
  });

  it("saves the clients ticked, and an empty list when none is", async () => {
    show();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(within(screen.getByRole("heading", { name: "Bookings, not customers" }).closest("section")!).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, notCustomers: [] }));
  });

  it("says when choices can't be kept yet, and won't send them", () => {
    show({ ready: false });
    expect(screen.getByText("These can’t be kept until the database is updated for them.")).toBeInTheDocument();
    for (const b of screen.getAllByRole("button", { name: "Save" })) expect(b).toBeDisabled();
  });
});
