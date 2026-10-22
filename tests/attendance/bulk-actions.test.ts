import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_BULK_ACTION_SIZE,
  normalizeBulkIds,
  toDatabaseAttendanceStatus,
} from '../../lib/bulk-actions';

const FIRST_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';

test('bulk IDs are normalized, deduplicated and sorted', () => {
  assert.deepEqual(
    normalizeBulkIds([SECOND_ID, ` ${FIRST_ID.toUpperCase()} `, SECOND_ID], 'student', 'students'),
    [FIRST_ID, SECOND_ID]
  );
});

test('bulk ID validation rejects empty, malformed and oversized requests', () => {
  assert.throws(
    () => normalizeBulkIds([], 'application', 'applications'),
    /Select at least one application/
  );
  assert.throws(
    () => normalizeBulkIds(['not-a-uuid'], 'application', 'applications'),
    /not valid/
  );
  assert.throws(
    () => normalizeBulkIds(
      Array.from({ length: MAX_BULK_ACTION_SIZE + 1 }, () => FIRST_ID),
      'application',
      'applications'
    ),
    new RegExp(`up to ${MAX_BULK_ACTION_SIZE}`)
  );
});

test('friendly attendance statuses map to the existing database values', () => {
  assert.equal(toDatabaseAttendanceStatus('present'), 'present');
  assert.equal(toDatabaseAttendanceStatus('late'), 'late');
  assert.equal(toDatabaseAttendanceStatus('absent'), 'absent_unexcused');
  assert.equal(toDatabaseAttendanceStatus('excused'), 'absent_excused');
  assert.throws(() => toDatabaseAttendanceStatus('missing'), /Unsupported attendance status/);
});
