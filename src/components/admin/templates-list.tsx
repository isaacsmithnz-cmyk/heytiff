/* SETTINGS › TEMPLATES (the seventh section, 26 October 2026): every
   document and message the business sends from fixed wording, grouped by
   who receives it, a row each (rule 39), its name in bold, what it is under
   it, and a state word on the right where it waits on the owner. Each row
   opens the template on its own page.

   No "use client": these are links and a state word. */

import { ScreenPanel } from "@/components/shell/screen-band";
import { SettingsHead } from "@/components/settings/settings-head";
import { Row, RowList } from "@/components/parts/row";
import { StateWord } from "@/components/parts/state";
import { Group, SectionTitle } from "@/components/settings/parts";
import { TEMPLATES, TEMPLATE_GROUPS, templateHref, type TemplateKey } from "./templates-catalogue";

export type TemplateStatus = { text: string; tone: "on" | "warn" };

export function TemplatesList({ status }: { status: Partial<Record<TemplateKey, TemplateStatus>> }) {
  return (
    <>
      <SectionTitle>Templates</SectionTitle>
      {TEMPLATE_GROUPS.map((g) => (
        <Group heading={g} key={g}>
          <RowList label={g}>
            {TEMPLATES.filter((t) => t.group === g).map((t) => {
              const s = status[t.key];
              return (
                <Row
                  key={t.key}
                  name={t.title}
                  line={t.sub}
                  href={templateHref(t.key)}
                  end={s ? <StateWord tone={s.tone === "on" ? "good" : "look"}>{s.text}</StateWord> : undefined}
                />
              );
            })}
          </RowList>
        </Group>
      ))}
    </>
  );
}

/** One template's page: the way back to the list, its name and where it
    stands, who gets it, then the document beside what can be done with it. */
export function TemplateFrame({
  title,
  who,
  status,
  doc,
  side,
}: {
  title: string;
  who: string;
  status?: TemplateStatus | null;
  doc: React.ReactNode;
  side: React.ReactNode;
}) {
  return (
    <div className="page in full">
      <div className="wrap">
        <div className="stg">
          <SettingsHead
            back={{ href: "/dashboard/admin/templates", label: "Templates" }}
            heading={title}
            facts={who}
            tools={status ? <StateWord tone={status.tone === "on" ? "good" : "look"}>{status.text}</StateWord> : null}
          />
          <ScreenPanel>
            <div className="tpl-work">
              <div className="tpl-well">{doc}</div>
              <aside className="tpl-side">{side}</aside>
            </div>
          </ScreenPanel>
        </div>
      </div>
    </div>
  );
}
