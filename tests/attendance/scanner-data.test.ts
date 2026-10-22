import assert from 'node:assert/strict';
import test from 'node:test';
import { toScannerClasses } from '../../lib/attendance/scanner-data';

test('scanner class data contains only the approved class summary fields', () => {
  const classes = toScannerClasses([{
    class_id: 'class-1',
    class_name: 'Quran Foundations',
    class_term: 'Term 4',
    class_location: 'Revesby',
    class_day_of_week: 6,
    class_start_time: '09:30:00',
    class_end_time: '11:00:00',
    session_cancelled: false,
    enrolled_count: '2',
    checked_in_count: '1',
    student_id: 'private-student-id',
    enrolment_id: 'private-enrolment-id',
    student_name: 'Private Student Name',
    email: 'private@example.com',
  } as any]);

  assert.deepEqual(classes, [{
    id: 'class-1',
    name: 'Quran Foundations — Term 4',
    location: 'Revesby',
    dayOfWeek: 6,
    startTime: '09:30',
    endTime: '11:00',
    sessionCancelled: false,
    enrolledCount: 2,
    checkedInCount: 1,
  }]);

  assert.deepEqual(Object.keys(classes[0]).sort(), [
    'checkedInCount',
    'dayOfWeek',
    'endTime',
    'enrolledCount',
    'id',
    'location',
    'name',
    'sessionCancelled',
    'startTime',
  ]);

  const serialized = JSON.stringify(classes);
  for (const privateValue of [
    'private-student-id',
    'private-enrolment-id',
    'Private Student Name',
    'private@example.com',
  ]) {
    assert.doesNotMatch(serialized, new RegExp(privateValue, 'i'));
  }
});
