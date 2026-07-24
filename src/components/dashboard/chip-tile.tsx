import { Icon } from "@/components/shell/icon";
import { GROUP_ICON, chipGroup, type ActionChip } from "@/lib/dashboard/chips";

/* One action-required item.

   Compact and grid-flowed rather than a full-width row: the old layout stretched
   ~200px of content across the whole card and stranded the group tag far from
   the thing it described.

   Two channels carry different information — the GLYPH is the domain (truck /
   shield / hexagon, matching the nav) and the COLOUR is the urgency. Colour
   alone made an expiring rego and an expiring licence look identical. */
export function ChipTile({ chip }: { chip: ActionChip }) {
  const group = chipGroup(chip.kind);
  return (
    <a className={`dash-tile ${chip.state}`} href={chip.href}>
      <span className="dt-ic">
        <Icon name={GROUP_ICON[group]} size={16} />
      </span>
      <span className="dt-main">
        <b className="dt-label">{chip.label}</b>
        <em className="dt-sub">
          {chip.subject} · {group}
        </em>
      </span>
      <span className="dt-chev">
        <Icon name="arrowR" size={16} />
      </span>
    </a>
  );
}
