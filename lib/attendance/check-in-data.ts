import 'server-only';

import { requireAttendanceStaff } from '../supabase/server';

export type CheckInStudent = {
  enrolmentId: string;
  studentId: string;
  name: string;
  enrolmentStatus: string;
  attendanceStatus: string | null;
  checkedInAt: string | null;
};

export type CheckInClass = {
  id: string;
  name: string;
  location: string;
  dayOfWeek: number | null;
  startTime: string;
  endTime: string;
  sessionId: string | null;
  sessionCancelled: boolean;
  students: CheckInStudent[];
};

function todaySydney() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

type TeacherRosterRow = {
  class_id: string;
  class_name: string;
  class_term: string | null;
  class_location: string | null;
  class_day_of_week: number | null;
  class_start_time: string | null;
  class_end_time: string | null;
  session_id: string | null;
  session_cancelled: boolean | null;
  enrolment_id: string | null;
  student_id: string | null;
  student_name: string | null;
  enrolment_status: string | null;
  attendance_status: string | null;
  checked_in_at: string | null;
};

async function loadAssignedTeacherClasses(
  supabase: Awaited<ReturnType<typeof requireAttendanceStaff>>['supabase']
) {
  // This RPC deliberately returns only attendance-safe fields. Teachers never
  // receive direct profile-table access to student contact, DOB, medical or
  // emergency-contact information.
  const { data, error } = await supabase.rpc('attendance_staff_today_roster');
  if (error) throw error;

  const classes = new Map<string, CheckInClass>();
  for (const row of (data ?? []) as TeacherRosterRow[]) {
    let classRow = classes.get(row.class_id);
    if (!classRow) {
      classRow = {
        id: row.class_id,
        name: [row.class_name, row.class_term].filter(Boolean).join(' — '),
        location: row.class_location ?? '',
        dayOfWeek: row.class_day_of_week,
        startTime: row.class_start_time ? String(row.class_start_time).slice(0, 5) : '',
        endTime: row.class_end_time ? String(row.class_end_time).slice(0, 5) : '',
        sessionId: row.session_id,
        sessionCancelled: Boolean(row.session_cancelled),
        students: [],
      };
      classes.set(row.class_id, classRow);
    }

    if (row.enrolment_id && row.student_id && row.enrolment_status) {
      classRow.students.push({
        enrolmentId: row.enrolment_id,
        studentId: row.student_id,
        name: row.student_name?.trim() || 'Student',
        enrolmentStatus: row.enrolment_status,
        attendanceStatus: row.attendance_status,
        checkedInAt: row.checked_in_at,
      });
    }
  }

  return Array.from(classes.values())
    .map((classRow) => ({
      ...classRow,
      students: classRow.students.sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function loadTodayCheckInData() {
  const staff = await requireAttendanceStaff();
  const { supabase, role } = staff;
  const today = todaySydney();

  if (role === 'teacher') {
    const classes = await loadAssignedTeacherClasses(supabase);
    return { classes, today, staff };
  }

  const classQuery = supabase
    .from('classes')
    .select('id,name,term,location,day_of_week,start_time,end_time')
    .eq('active', true)
    .order('name');

  const { data: classes, error: classError } = await classQuery;
  if (classError) throw classError;

  const classIds = (classes ?? []).map((classRow) => classRow.id);

  const { data: enrolments, error: enrolmentError } = classIds.length
    ? await supabase
        .from('enrolments')
        .select('id,class_id,student_id,status,profiles!enrolments_student_id_fkey(first_name,last_name)')
        .in('class_id', classIds)
        .in('status', ['enrolled', 'suspended'])
    : { data: [], error: null };

  if (enrolmentError) throw enrolmentError;

  const { data: sessions, error: sessionError } = classIds.length
    ? await supabase
        .from('class_sessions')
        .select('id,class_id,session_date,cancelled')
        .in('class_id', classIds)
        .eq('session_date', today)
    : { data: [], error: null };

  if (sessionError) throw sessionError;

  const sessionByClass = new Map((sessions ?? []).map((session) => [session.class_id, session]));
  const sessionIds = (sessions ?? []).map((session) => session.id);

  const { data: attendance, error: attendanceError } = sessionIds.length
    ? await supabase
        .from('attendance')
        .select('enrolment_id,session_id,status,checked_in_at')
        .in('session_id', sessionIds)
    : { data: [], error: null };

  if (attendanceError) throw attendanceError;

  const attendanceByEnrolment = new Map(
    (attendance ?? []).map((record) => [record.enrolment_id, record])
  );

  const rows: CheckInClass[] = (classes ?? []).map((classRow) => {
    const session = sessionByClass.get(classRow.id);
    return {
      id: classRow.id,
      name: [classRow.name, classRow.term].filter(Boolean).join(' — '),
      location: classRow.location ?? '',
      dayOfWeek: classRow.day_of_week,
      startTime: classRow.start_time ? String(classRow.start_time).slice(0, 5) : '',
      endTime: classRow.end_time ? String(classRow.end_time).slice(0, 5) : '',
      sessionId: session?.id ?? null,
      sessionCancelled: Boolean(session?.cancelled),
      students: (enrolments ?? [])
        .filter((enrolment) => enrolment.class_id === classRow.id)
        .map((enrolment) => {
          const record = attendanceByEnrolment.get(enrolment.id);
          const profile = Array.isArray(enrolment.profiles)
            ? enrolment.profiles[0]
            : enrolment.profiles;
          return {
            enrolmentId: enrolment.id,
            studentId: enrolment.student_id,
            name: `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || 'Student',
            enrolmentStatus: enrolment.status,
            attendanceStatus: record?.status ?? null,
            checkedInAt: record?.checked_in_at ?? null,
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  });

  return { classes: rows, today, staff };
}
