import CheckInClient from '../../admin/check-in/CheckInClient';
import { loadTodayCheckInData } from '../../../lib/attendance/check-in-data';

export default async function TeacherCheckInPage() {
  const { classes, today } = await loadTodayCheckInData();
  return <CheckInClient classes={classes} today={today} audience="teacher" />;
}
