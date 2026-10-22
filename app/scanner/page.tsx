import { loadScannerCheckInData } from '../../lib/attendance/check-in-data';
import ScannerClient from './ScannerClient';

export default async function ScannerPage() {
  const { classes, today, staff } = await loadScannerCheckInData();
  const rosterHref = staff.role === 'teacher' ? '/teacher/check-in' : '/admin/check-in';

  return <ScannerClient classes={classes} today={today} rosterHref={rosterHref} />;
}
