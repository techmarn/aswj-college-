'use server';

import { revalidatePath } from 'next/cache';
import { requireAttendanceStaff } from '../../../lib/supabase/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireClassAttendanceAccess(classId: string) {
  if (!UUID_PATTERN.test(classId)) throw new Error('The selected class is not valid.');

  const staff = await requireAttendanceStaff();
  if (staff.role !== 'teacher') return staff;

  const { data, error } = await staff.supabase
    .from('classes')
    .select('id')
    .eq('id', classId)
    .eq('teacher_id', staff.user.id)
    .eq('active', true)
    .maybeSingle();

  if (error) throw new Error('Class access could not be verified.');
  if (!data) throw new Error('You can only record attendance for an active class assigned to you.');
  return staff;
}

function refreshAttendanceViews() {
  revalidatePath('/admin');
  revalidatePath('/admin/check-in');
  revalidatePath('/admin/attendance-review');
  revalidatePath('/admin/students');
  revalidatePath('/teacher');
  revalidatePath('/teacher/check-in');
  revalidatePath('/student');
}

export async function checkInByQr(classId: string, token: string) {
  const { supabase } = await requireClassAttendanceAccess(classId);
  const cleaned = token.trim().replace(/^aswj:/i, '');
  if (!UUID_PATTERN.test(cleaned)) {
    throw new Error('This QR code is not valid.');
  }

  const { data, error } = await supabase.rpc('admin_check_in_by_qr', {
    p_class_id: classId,
    p_token: cleaned,
  });

  if (error) throw new Error(error.message);
  refreshAttendanceViews();

  const row = Array.isArray(data) ? data[0] : data;
  return {
    name: row?.student_name ?? 'Student',
    status: row?.attendance_status ?? 'present',
    checkedInAt: row?.checked_in_at ?? null,
    alreadyCheckedIn: Boolean(row?.already_checked_in),
  };
}

export async function setManualAttendance(
  enrolmentId: string,
  classId: string,
  status: 'present' | 'late' | 'absent' | 'excused' | 'absent_unexcused' | 'absent_excused'
) {
  if (!UUID_PATTERN.test(enrolmentId)) throw new Error('The selected enrolment is not valid.');
  const { supabase } = await requireClassAttendanceAccess(classId);
  const databaseStatus = status === 'absent'
    ? 'absent_unexcused'
    : status === 'excused'
      ? 'absent_excused'
      : status;

  const { error } = await supabase.rpc('admin_set_manual_attendance', {
    p_enrolment_id: enrolmentId,
    p_class_id: classId,
    p_status: databaseStatus,
  });

  if (error) throw new Error(error.message);
  refreshAttendanceViews();
}

export async function closeTodayRoll(classId: string) {
  const { supabase } = await requireClassAttendanceAccess(classId);
  const { data, error } = await supabase.rpc('admin_close_today_roll', {
    p_class_id: classId,
  });

  if (error) throw new Error(error.message);
  refreshAttendanceViews();
  return { markedAbsent: Number(data ?? 0) };
}
