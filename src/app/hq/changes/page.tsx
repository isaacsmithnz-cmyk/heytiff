import { requireHqPage } from "@/lib/hq/guard";
import { supabaseAdmin } from "@/lib/supabase-server";
import { ChangesList, type ChangeEvent } from "@/components/hq/changes-list";

/* HQ change log — the manual-edit audit trail, newest first. */

export const dynamic = "force-dynamic";

type LogRow = {
  id: string;
  section: string;
  row_key: string;
  field: string;
  action: "set" | "clear";
  old_value: number | string | string[] | null;
  new_value: number | string | string[] | null;
  entered_by: string;
  entered_at: string;
};

export default async function HqChangesPage() {
  await requireHqPage();

  const { data } = await supabaseAdmin
    .from("pack_override_log")
    .select("id, section, row_key, field, action, old_value, new_value, entered_by, entered_at")
    .order("entered_at", { ascending: false })
    .limit(200);

  const events: ChangeEvent[] = ((data as LogRow[]) ?? []).map((r) => ({
    id: r.id,
    section: r.section,
    rowKey: r.row_key,
    field: r.field,
    action: r.action,
    oldValue: r.old_value,
    newValue: r.new_value,
    enteredBy: r.entered_by,
    enteredAt: r.entered_at,
  }));

  return (
    <main className="hq-main">
      <h1 className="hq-h1">Change log</h1>
      <p className="hq-lede">
        Every manual edit to the universal table — who changed what, and when.
        The most recent 200 changes.
      </p>
      <ChangesList events={events} />
    </main>
  );
}
