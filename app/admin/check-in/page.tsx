import { loadTodayCheckInData } from '../../../lib/attendance/check-in-data';
import CheckInClient from './CheckInClient';

export default async function CheckInPage() {
  const { classes, today } = await loadTodayCheckInData();
  return <CheckInClient classes={classes} today={today} />;
}
