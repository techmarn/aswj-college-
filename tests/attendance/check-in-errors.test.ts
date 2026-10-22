import assert from 'node:assert/strict';
import test from 'node:test';

import { toCheckInErrorMessage } from '../../lib/attendance/check-in-errors';

test('wrong-class check-in uses clear roll guidance', () => {
  assert.equal(
    toCheckInErrorMessage('This student is not enrolled in the selected class'),
    'This student is not on the selected class roll. Choose the correct class and scan again.'
  );
});

test('other check-in errors keep their existing message', () => {
  assert.equal(
    toCheckInErrorMessage('This QR code is not valid or has been revoked'),
    'This QR code is not valid or has been revoked'
  );
});
