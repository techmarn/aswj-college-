export type ScannerClass = {
  id: string;
  name: string;
  location: string;
  dayOfWeek: number | null;
  startTime: string;
  endTime: string;
  sessionCancelled: boolean;
  enrolledCount: number;
  checkedInCount: number;
};

export type ScannerClassRow = {
  class_id: string;
  class_name: string;
  class_term: string | null;
  class_location: string | null;
  class_day_of_week: number | null;
  class_start_time: string | null;
  class_end_time: string | null;
  session_cancelled: boolean | null;
  enrolled_count: number | string | null;
  checked_in_count: number | string | null;
};

export function toScannerClasses(rows: ScannerClassRow[]): ScannerClass[] {
  return rows.map((row) => ({
    id: row.class_id,
    name: [row.class_name, row.class_term].filter(Boolean).join(' — '),
    location: row.class_location ?? '',
    dayOfWeek: row.class_day_of_week,
    startTime: row.class_start_time ? String(row.class_start_time).slice(0, 5) : '',
    endTime: row.class_end_time ? String(row.class_end_time).slice(0, 5) : '',
    sessionCancelled: Boolean(row.session_cancelled),
    enrolledCount: Number(row.enrolled_count ?? 0),
    checkedInCount: Number(row.checked_in_count ?? 0),
  }));
}
