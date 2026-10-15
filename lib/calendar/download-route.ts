import {
  buildStudentClassCalendar,
  ClassCalendarUnavailableError,
  type StudentCalendarClass,
} from './ics';
import {
  canonicalClassId,
  loadStudentCalendarClass,
} from './student-class';
import { createSupabaseServerClient } from '../supabase/server';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Pragma': 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

function privateRedirect(destination: URL) {
  return new Response(null, {
    status: 303,
    headers: { ...PRIVATE_HEADERS, 'Location': destination.toString() },
  });
}

function unavailable() {
  return new Response('Class calendar not found.', {
    status: 404,
    headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export type CalendarRouteDependencies = {
  createServerClient: typeof createSupabaseServerClient;
  loadClass: (
    supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
    studentId: string,
    classId: string
  ) => Promise<StudentCalendarClass | null>;
  buildCalendar: typeof buildStudentClassCalendar;
};

const DEFAULT_DEPENDENCIES: CalendarRouteDependencies = {
  createServerClient: createSupabaseServerClient,
  loadClass: loadStudentCalendarClass,
  buildCalendar: buildStudentClassCalendar,
};

export async function handleStudentCalendarDownload(
  request: Request,
  { params }: { params: Promise<{ classId: string }> },
  dependencies: CalendarRouteDependencies = DEFAULT_DEPENDENCIES
) {
  const { classId: rawClassId } = await params;
  const classId = canonicalClassId(rawClassId);
  if (!classId) return unavailable();

  try {
    const supabase = await dependencies.createServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return privateRedirect(new URL(`/student/calendar/${classId}`, request.url));
    }

    const classInfo = await dependencies.loadClass(supabase, user.id, classId);
    if (!classInfo) return unavailable();

    const calendar = dependencies.buildCalendar(classInfo);
    return new Response(calendar, {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="aswj-class.ics"',
      },
    });
  } catch (error) {
    if (error instanceof ClassCalendarUnavailableError) return unavailable();
    return new Response('The class calendar could not be created.', {
      status: 500,
      headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
