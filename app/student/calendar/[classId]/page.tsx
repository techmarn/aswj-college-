import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import {
  buildStudentClassCalendar,
  calendarClassSchedule,
  ClassCalendarUnavailableError,
} from '../../../../lib/calendar/ics';
import {
  canonicalClassId,
  loadStudentCalendarClass,
} from '../../../../lib/calendar/student-class';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function StudentClassCalendarPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId: rawClassId } = await params;
  const classId = canonicalClassId(rawClassId);
  if (!classId) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    const nextPath = `/student/calendar/${classId}`;
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const classInfo = await loadStudentCalendarClass(supabase, user.id, classId);
  if (!classInfo) notFound();

  const classLabel = classInfo.term
    ? `${classInfo.name} — ${classInfo.term}`
    : classInfo.name;
  let calendarAvailable = true;
  try {
    buildStudentClassCalendar(classInfo);
  } catch (calendarError) {
    if (!(calendarError instanceof ClassCalendarUnavailableError)) throw calendarError;
    calendarAvailable = false;
  }

  return (
    <main id="main-content" className="login-shell" tabIndex={-1}>
      <section className="login-card" aria-labelledby="calendar-heading">
        <Image
          className="login-logo"
          src="/aswj-logo.png"
          alt="ASWJ Islamic College"
          width={650}
          height={390}
          priority
        />
        <span className="eyebrow">Student Portal</span>
        <h1 id="calendar-heading">Add class to calendar</h1>
        <p className="subtitle">{classLabel}</p>
        <div className="card section">
          <strong>{calendarClassSchedule(classInfo)}</strong>
          {classInfo.location && <p className="small">{classInfo.location}</p>}
        </div>
        <p className="small section">
          {calendarAvailable
            ? 'This downloads a weekly calendar event. Check the Student Portal for current schedule changes or cancellations.'
            : 'This class has no remaining scheduled dates to add. Check the Student Portal for the current class status.'}
        </p>
        <div className="actions section">
          {calendarAvailable && (
            <a
              className="btn btn-primary"
              href={`/api/student/calendar/${classId}`}
              download="aswj-class.ics"
            >
              Download class calendar
            </a>
          )}
          <a className="btn btn-outline" href="/student">
            Back to Student Portal
          </a>
        </div>
      </section>
    </main>
  );
}
