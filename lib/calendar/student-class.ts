import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { StudentCalendarClass } from './ics';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function canonicalClassId(value: unknown) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return UUID_PATTERN.test(cleaned) ? cleaned.toLowerCase() : null;
}

function optionalDate(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  return DATE_PATTERN.test(text) ? text : null;
}

export async function loadStudentCalendarClass(
  supabase: SupabaseClient,
  studentId: string,
  classId: string
): Promise<StudentCalendarClass | null> {
  const canonicalId = canonicalClassId(classId);
  if (!canonicalId) return null;

  const { data, error } = await supabase
    .from('enrolments')
    .select(`
      id,
      enrolled_at,
      reinstated_at,
      status,
      classes!enrolments_class_id_fkey(
        id,name,term,location,active,starts_on,ends_on,day_of_week,start_time,end_time
      )
    `)
    .eq('student_id', studentId)
    .eq('class_id', canonicalId)
    .eq('status', 'enrolled')
    .maybeSingle();

  if (error) {
    throw new Error('Your class calendar could not be loaded.');
  }
  if (!data) return null;

  const classRow = one<any>(data.classes);
  const dayOfWeek = Number(classRow?.day_of_week);
  const startTime = classRow?.start_time ? String(classRow.start_time) : '';
  const endTime = classRow?.end_time ? String(classRow.end_time) : '';
  const enrolledAt = data.enrolled_at ? String(data.enrolled_at) : '';
  const reinstatedAt = data.reinstated_at ? String(data.reinstated_at) : '';

  if (
    !classRow
    || canonicalClassId(classRow.id) !== canonicalId
    || classRow.active !== true
    || !classRow.name
    || !Number.isInteger(dayOfWeek)
    || dayOfWeek < 0
    || dayOfWeek > 6
    || !TIME_PATTERN.test(startTime)
    || !TIME_PATTERN.test(endTime)
    || !enrolledAt
  ) {
    return null;
  }

  return {
    id: canonicalId,
    name: String(classRow.name),
    term: classRow.term ? String(classRow.term) : null,
    location: classRow.location ? String(classRow.location) : null,
    startsOn: optionalDate(classRow.starts_on),
    endsOn: optionalDate(classRow.ends_on),
    dayOfWeek,
    startTime,
    endTime,
    effectiveAt: reinstatedAt || enrolledAt,
  };
}
