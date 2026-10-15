import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStudentClassCalendar,
  ClassCalendarUnavailableError,
  sydneyDateKey,
  type StudentCalendarClass,
} from '../../lib/calendar/ics';

const CLASS: StudentCalendarClass = {
  id: '6f465170-81ed-451e-8b94-1110147bdb60',
  name: 'Quran, Arabic; Foundations',
  term: 'Term 4',
  location: 'ASWJ College, Revesby',
  startsOn: '2026-10-01',
  endsOn: '2026-10-31',
  dayOfWeek: 6,
  startTime: '09:30:00',
  endTime: '11:00:00',
  effectiveAt: '2026-10-12T23:30:00Z',
};

test('calendar starts on the first enrolled class day and ends with an inclusive count', () => {
  const calendar = buildStudentClassCalendar(CLASS, new Date('2026-10-15T00:00:00Z'));

  assert.match(calendar, /DTSTART;TZID=Australia\/Sydney:20261017T093000/);
  assert.match(calendar, /DTEND;TZID=Australia\/Sydney:20261017T110000/);
  assert.match(calendar, /RRULE:FREQ=WEEKLY;BYDAY=SA;COUNT=3/);
  assert.match(calendar, /TZID:Australia\/Sydney/);
  assert.match(calendar, /UID:aswj-class-6f465170-81ed-451e-8b94-1110147bdb60@aswjcollege\.com\.au/);
  assert.match(calendar, /SUMMARY:Quran\\, Arabic\\; Foundations — Term 4/);
  assert.match(calendar, /LOCATION:ASWJ College\\, Revesby/);
  assert.ok(calendar.endsWith('\r\n'));
  assert.equal(calendar.replaceAll('\r\n', '').includes('\n'), false);
});

test('calendar supports an open weekly recurrence when the class has no end date', () => {
  const calendar = buildStudentClassCalendar({ ...CLASS, endsOn: null });
  assert.match(calendar, /RRULE:FREQ=WEEKLY;BYDAY=SA\r\n/);
  assert.doesNotMatch(calendar, /;COUNT=/);
  assert.doesNotMatch(calendar, /;UNTIL=/);
});

test('calendar does not invent an event after the class has ended', () => {
  assert.throws(
    () => buildStudentClassCalendar({ ...CLASS, endsOn: '2026-10-15' }),
    ClassCalendarUnavailableError
  );
});

test('Sydney date conversion uses the enrolment instant in the class timezone', () => {
  assert.equal(sydneyDateKey('2026-10-12T13:30:00Z'), '2026-10-13');
});

test('folded calendar lines stay within 75 UTF-8 bytes', () => {
  const calendar = buildStudentClassCalendar({
    ...CLASS,
    name: 'قرآن كريم '.repeat(20),
  });
  for (const line of calendar.split('\r\n').filter(Boolean)) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `${line.length}: ${line}`);
  }
});
