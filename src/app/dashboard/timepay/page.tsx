import { TimePay } from "@/components/timepay/timepay";
import {
  demoTimepayPeriods,
  demoTimepayStaff,
  demoTimepayToday,
  demoTimepayWeek,
} from "@/mock/demo";

export default function TimePayPage() {
  return (
    <TimePay
      staff={demoTimepayStaff}
      week={demoTimepayWeek}
      today={demoTimepayToday}
      periods={demoTimepayPeriods}
    />
  );
}
