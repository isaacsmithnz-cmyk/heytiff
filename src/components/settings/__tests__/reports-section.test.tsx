/* Settings › Reports (it was Admin, Analytics): what a setting never saved
   shows, and what each save sends. The typed figures save from their Edit;
   every pick saves itself and says so in a toast with Undo. */
const save = jest.fn();
jest.mock("@/app/actions/analytics-settings", () => ({ saveAnalyticsSettings: (s: unknown) => save(s) }));

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/parts/toast";
import { DEFAULT_SETTINGS, type AnalyticsSettings } from "@/lib/analytics/settings";
import { ReportsSection } from "../reports-section";

const CATS = [
  { uuid: "c-ins", name: "Install", jobs: 612 },
  { uuid: "c-war", name: "Warranty", jobs: 100 },
];
const CLIENTS = [{ id: "tafe", name: "TAFE NSW", cards: 161 }];

beforeEach(() => {
  save.mockReset().mockImplementation(async (s: AnalyticsSettings) => ({ ok: true, settings: s }));
});

const show = (over: Partial<Parameters<typeof ReportsSection>[0]> = {}) =>
  render(
    <ToastProvider>
      <ReportsSection
        initial={DEFAULT_SETTINGS}
        ready
        connected
        categories={CATS}
        clients={CLIENTS}
        closeAge={{ days: 60, count: 35 }}
        {...over}
      />
    </ToastProvider>,
  );

const group = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("section")!;

const pick = async (user: ReturnType<typeof userEvent.setup>, chooser: string, option: string) => {
  await user.click(screen.getByRole("combobox", { name: chooser }));
  await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
};

describe("ReportsSection", () => {
  it("is the section's title and its four groups, with the way to the Reports themselves", () => {
    show();
    expect(screen.getByRole("heading", { level: 1, name: "Reports" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Counting quotes",
      "When ServiceM8 closes a quote",
      "Categories",
      "Bookings, not customers",
    ]);
    expect(screen.getByRole("link", { name: "View Reports" })).toHaveAttribute("href", "/dashboard/analytics");
  });

  it("shows what stands in for each setting never saved", () => {
    show();
    const counting = group("Counting quotes");
    expect(within(counting).getByText("60 days")).toBeInTheDocument();
    expect(within(counting).getByText("180 days")).toBeInTheDocument();
    expect(within(counting).getByText("$3,000 ex GST")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "ServiceM8 closes them" })).toHaveTextContent("As found in your jobs: at 60 days");
    expect(screen.getByText("35 Unsuccessful quotes were closed 60 days to the hour after they became one.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "What Install jobs are" })).toHaveTextContent("Installs, can be quotes");
    expect(screen.getByRole("combobox", { name: "What Warranty jobs are" })).toHaveTextContent("Warranty");
    expect(screen.getByText("612 jobs in two years, read from its name")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Leave TAFE NSW out of the figures" })).toHaveAttribute("aria-checked", "true");
  });

  it("saves the counting rules from their Edit, blank as not set", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Edit counting quotes" }));
    expect(screen.getByLabelText("Quote lost after, in days")).toHaveAttribute("placeholder", "60");
    expect(screen.getByLabelText("Tender lost after, in days")).toHaveAttribute("placeholder", "180");
    await user.type(screen.getByLabelText("Quote lost after, in days"), "120");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, lapseAfterDays: 120, tenderAfterDays: null, quoteFromCents: null }));
    expect(await within(group("Counting quotes")).findByText("120 days")).toBeInTheDocument();
  });

  it("takes the work-order figure in dollars and keeps it in cents", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Edit counting quotes" }));
    await user.type(screen.getByLabelText("Ask about work orders from, ex GST"), "$4,500");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, quoteFromCents: 450_000 }));
  });

  it("won't send a lost-after under 30 days, and says so on the field", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Edit counting quotes" }));
    await user.type(screen.getByLabelText("Quote lost after, in days"), "20");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByLabelText("Quote lost after, in days")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("30 to 730 days, or blank")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("saves that ServiceM8 never closes quotes as 0, the moment it's picked", async () => {
    const user = userEvent.setup();
    show();
    await pick(user, "ServiceM8 closes them", "Never");
    expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, autoCloseDays: 0 });
    expect(await screen.findByText("ServiceM8 never closes quotes")).toBeInTheDocument();
  });

  it("keeps a closing age saved before the list existed", () => {
    show({ initial: { ...DEFAULT_SETTINGS, autoCloseDays: 75 } });
    expect(screen.getByRole("combobox", { name: "ServiceM8 closes them" })).toHaveTextContent("After 75 days");
    expect(screen.queryByText(/to the hour/)).not.toBeInTheDocument();
  });

  it("puts the old closing age back when the toast's Undo is pressed", async () => {
    const user = userEvent.setup();
    show();
    await pick(user, "ServiceM8 closes them", "After 90 days");
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(save).toHaveBeenLastCalledWith(DEFAULT_SETTINGS);
  });

  it("saves every category's role on a pick, the read ones included", async () => {
    const user = userEvent.setup();
    show();
    await pick(user, "What Install jobs are", "Other work");
    expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, categoryRoles: { "c-ins": "other", "c-war": "warranty" } });
    expect(await screen.findByText("Install saved as other work")).toBeInTheDocument();
    expect(screen.queryByText(/read from its name/)).not.toBeInTheDocument();
  });

  it("saves the clients switched on, and an empty list when none is", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("switch", { name: "Leave TAFE NSW out of the figures" }));
    expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, notCustomers: [] });
    expect(await screen.findByText("TAFE NSW counted again")).toBeInTheDocument();
  });

  it("leaves out only the ones listed once the list is saved", () => {
    show({ initial: { ...DEFAULT_SETTINGS, notCustomers: [] } });
    expect(screen.getByRole("switch", { name: "Leave TAFE NSW out of the figures" })).toHaveAttribute("aria-checked", "false");
  });

  it("says why under the group when a pick is refused", async () => {
    const user = userEvent.setup();
    save.mockResolvedValueOnce({ ok: false, reason: "Only someone who sees the jobs' money can change how they're counted." });
    show();
    await pick(user, "ServiceM8 closes them", "Never");
    expect(await within(group("When ServiceM8 closes a quote")).findByRole("alert")).toHaveTextContent("jobs' money");
  });

  it("says when choices can't be kept yet, and won't send them", async () => {
    const user = userEvent.setup();
    show({ ready: false });
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("These can’t be kept until the database is updated for them.");
    expect(screen.getByRole("combobox", { name: "ServiceM8 closes them" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "What Install jobs are" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Leave TAFE NSW out of the figures" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Edit counting quotes" }));
    await user.type(screen.getByLabelText("Quote lost after, in days"), "120");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await within(group("Counting quotes")).findByRole("alert")).toHaveTextContent("database");
    expect(save).not.toHaveBeenCalled();
  });

  it("leads with Connect ServiceM8 when there are no categories to read", () => {
    show({ connected: false, categories: [], clients: [], closeAge: null });
    expect(screen.getByText("No categories in ServiceM8’s copy yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect ServiceM8" })).toHaveAttribute("href", "/dashboard/admin/integrations/servicem8");
    expect(screen.getByText("No bookings found in your jobs")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "ServiceM8 closes them" })).toHaveTextContent("As found in your jobs: no age stands out");
  });
});
