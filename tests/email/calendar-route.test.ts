import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleStudentCalendarDownload,
  type CalendarRouteDependencies,
} from '../../lib/calendar/download-route';
import {
  buildStudentClassCalendar,
  type StudentCalendarClass,
} from '../../lib/calendar/ics';

const CLASS_ID = '6f465170-81ed-451e-8b94-1110147bdb60';
const STUDENT_ID = 'student-123';
const REQUEST_URL = `https://dev.aswj.example/api/student/calendar/${CLASS_ID}`;

const CLASS: StudentCalendarClass = {
  id: CLASS_ID,
  name: 'Quran Foundations',
  term: 'Term 4',
  location: 'ASWJ College, Revesby',
  startsOn: '2026-10-01',
  endsOn: '2026-10-31',
  dayOfWeek: 6,
  startTime: '09:30:00',
  endTime: '11:00:00',
  effectiveAt: '2026-10-12T23:30:00Z',
};

function routeDependencies({
  userId,
  classInfo,
  onLoad,
}: {
  userId: string | null;
  classInfo: StudentCalendarClass | null;
  onLoad?: (studentId: string, classId: string) => void;
}) {
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  };

  return {
    createServerClient: async () => client,
    loadClass: async (_client, studentId, classId) => {
      onLoad?.(studentId, classId);
      return classInfo;
    },
    buildCalendar: buildStudentClassCalendar,
  } as unknown as CalendarRouteDependencies;
}

function requestContext(classId = CLASS_ID) {
  return { params: Promise.resolve({ classId }) };
}

test('signed-out calendar download redirects to the authenticated landing page', async () => {
  let loadCalled = false;
  const response = await handleStudentCalendarDownload(
    new Request(REQUEST_URL),
    requestContext(),
    routeDependencies({
      userId: null,
      classInfo: null,
      onLoad: () => {
        loadCalled = true;
      },
    })
  );

  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get('location'),
    `https://dev.aswj.example/student/calendar/${CLASS_ID}`
  );
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(loadCalled, false);
});

for (const deniedCase of ['another student', 'a suspended enrolment']) {
  test(`${deniedCase} receives the same private 404`, async () => {
    const loadCalls: Array<[string, string]> = [];
    const response = await handleStudentCalendarDownload(
      new Request(REQUEST_URL),
      requestContext(),
      routeDependencies({
        userId: STUDENT_ID,
        classInfo: null,
        onLoad: (studentId, classId) => loadCalls.push([studentId, classId]),
      })
    );

    assert.equal(response.status, 404);
    assert.equal(await response.text(), 'Class calendar not found.');
    assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
    assert.deepEqual(loadCalls, [[STUDENT_ID, CLASS_ID]]);
  });
}

test('eligible student receives a private downloadable Sydney calendar', async () => {
  const response = await handleStudentCalendarDownload(
    new Request(REQUEST_URL),
    requestContext(),
    routeDependencies({ userId: STUDENT_ID, classInfo: CLASS })
  );
  const calendar = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/calendar; charset=utf-8');
  assert.equal(
    response.headers.get('content-disposition'),
    'attachment; filename="aswj-class.ics"'
  );
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(calendar, /BEGIN:VCALENDAR\r\n/);
  assert.match(calendar, /DTSTART;TZID=Australia\/Sydney:/);
  assert.match(calendar, /SUMMARY:Quran Foundations — Term 4/);
  assert.match(calendar, new RegExp(`UID:aswj-class-${CLASS_ID}@aswjcollege\\.com\\.au`));
});
