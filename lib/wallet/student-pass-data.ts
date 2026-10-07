import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatClassTime } from '../class-time';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type StudentWalletClass = {
  id: string;
  name: string;
  term: string | null;
  location: string | null;
  dayOfWeek: number | null;
  startTime: string | null;
  endTime: string | null;
};

export type StudentWalletPassData = {
  studentId: string;
  studentName: string;
  qrValue: string;
  classes: StudentWalletClass[];
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function classFrom(value: unknown): StudentWalletClass | null {
  const row = one<any>(value as any);
  if (!row?.id || !row?.name) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    term: row.term ? String(row.term) : null,
    location: row.location ? String(row.location) : null,
    dayOfWeek: row.day_of_week === null || row.day_of_week === undefined
      ? null
      : Number(row.day_of_week),
    startTime: row.start_time ? String(row.start_time) : null,
    endTime: row.end_time ? String(row.end_time) : null,
  };
}

export function walletClassLabel(value: StudentWalletClass) {
  return value.term ? `${value.name} — ${value.term}` : value.name;
}

export function walletClassSchedule(value: StudentWalletClass) {
  const day = value.dayOfWeek === null ? null : DAYS[value.dayOfWeek] ?? null;
  const time = value.startTime
    ? `${formatClassTime(value.startTime)}${value.endTime ? `–${formatClassTime(value.endTime)}` : ''}`
    : null;
  return [day, time, value.location].filter(Boolean).join(' · ');
}

export async function loadStudentWalletPassData(
  supabase: SupabaseClient,
  studentId: string
): Promise<StudentWalletPassData | null> {
  const [profileResult, enrolmentResult, qrResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('first_name,last_name,role')
      .eq('id', studentId)
      .maybeSingle(),
    supabase
      .from('enrolments')
      .select(`
        id,
        status,
        classes!enrolments_class_id_fkey(
          id,name,term,location,day_of_week,start_time,end_time
        )
      `)
      .eq('student_id', studentId)
      .eq('status', 'enrolled')
      .order('enrolled_at', { ascending: true }),
    supabase
      .from('student_qr_tokens')
      .select('token')
      .eq('student_id', studentId)
      .eq('active', true)
      .maybeSingle(),
  ]);

  if (profileResult.error || enrolmentResult.error || qrResult.error) {
    throw new Error('Your student pass details could not be loaded.');
  }

  if (!profileResult.data || String(profileResult.data.role ?? 'student') !== 'student') {
    return null;
  }

  const token = qrResult.data?.token ? String(qrResult.data.token) : '';
  const classes = (enrolmentResult.data ?? [])
    .map((row: any) => classFrom(row.classes))
    .filter((value): value is StudentWalletClass => Boolean(value));

  if (!token || classes.length === 0) return null;

  const studentName = [profileResult.data.first_name, profileResult.data.last_name]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(' ') || 'ASWJ College Student';

  return {
    studentId,
    studentName,
    qrValue: `aswj:${token}`,
    classes,
  };
}
