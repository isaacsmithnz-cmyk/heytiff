import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { NoticesBoard } from "@/components/dashboard/notices-board";
import { loadNoticeBoard } from "@/lib/dashboard/page-data";

/* The noticeboard is intrinsic — everyone in the org reads it, so there is no
   capability gate here. Posting and moderating are gated inside (on `team`);
   reading, voting, RSVPing, reacting and commenting are not.

   Reading happens on THIS page rather than the dashboard: getting here takes a
   deliberate click, which is what makes marking the notices read honest. */
export default async function NoticesPage() {
  /* Notices are Team's Notices view (v2 audit, 20 October 2026). Someone
     without Team still reads the board here, the one door they have. */
  if (await can("team")) redirect("/dashboard/team?view=notices");
  const { notices, canManage, canRead, today, staff, viewerStaffId } = await loadNoticeBoard();
  return (
    <NoticesBoard
      notices={notices}
      canManage={canManage}
      canRead={canRead}
      today={today}
      staff={staff}
      viewerStaffId={viewerStaffId}
    />
  );
}
