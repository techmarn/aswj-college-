import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleImmediateEmailDelivery } from '../../lib/email/immediate';

type DeferredTask = () => void | Promise<void>;

function deliveryResult(
  status: 'disabled' | 'not_configured' | 'processed' = 'processed'
) {
  return {
    status,
    claimed: 0,
    submitted: 0,
    retryScheduled: 0,
    failed: 0,
  } as const;
}

test('immediate email processing is deferred with the bounded worker settings', async () => {
  let task: DeferredTask | null = null;
  const calls: Array<{ limit: number; leaseSeconds: number }> = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  scheduleImmediateEmailDelivery('application_received', {
    defer: (candidate) => {
      task = candidate;
    },
    processQueue: async (options) => {
      calls.push(options);
      return deliveryResult();
    },
    logger: {
      warn: (message) => warnings.push(String(message)),
      error: (message) => errors.push(String(message)),
    },
  });

  assert.ok(task, 'an after-response task should be registered');
  assert.deepEqual(calls, [], 'the provider worker must not block the request');
  await task();
  assert.deepEqual(calls, [{ limit: 10, leaseSeconds: 120 }]);
  assert.deepEqual(warnings, []);
  assert.deepEqual(errors, []);
});

test('an immediate processing failure is contained for the scheduled fallback', async () => {
  let task: DeferredTask | null = null;
  const errors: string[] = [];

  scheduleImmediateEmailDelivery('application_decision', {
    defer: (candidate) => {
      task = candidate;
    },
    processQueue: async () => {
      throw new Error('provider response containing private details');
    },
    logger: {
      warn: () => undefined,
      error: (message) => errors.push(String(message)),
    },
  });

  assert.ok(task);
  await assert.doesNotReject(async () => {
    await task!();
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /scheduled worker will retry/i);
  assert.doesNotMatch(errors[0], /private details/i);
});

test('a scheduling failure cannot misreport a committed workflow as failed', () => {
  const errors: string[] = [];

  assert.doesNotThrow(() => {
    scheduleImmediateEmailDelivery('application_received', {
      defer: () => {
        throw new Error('request context unavailable');
      },
      processQueue: async () => deliveryResult(),
      logger: {
        warn: () => undefined,
        error: (message) => errors.push(String(message)),
      },
    });
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /could not be scheduled/i);
  assert.doesNotMatch(errors[0], /request context unavailable/i);
});

test('bulk delivery drains enough bounded batches for the selected applications', async () => {
  let task: DeferredTask | null = null;
  let calls = 0;

  scheduleImmediateEmailDelivery('bulk_application_acceptance', {
    batchCount: 3,
    defer: (candidate) => {
      task = candidate;
    },
    processQueue: async () => {
      calls += 1;
      return {
        ...deliveryResult(),
        claimed: 10,
        submitted: 10,
      };
    },
    logger: {
      warn: () => undefined,
      error: () => undefined,
    },
  });

  assert.ok(task);
  await task();
  assert.equal(calls, 3);
});

test('unavailable immediate delivery records a sanitized fallback warning', async () => {
  let task: DeferredTask | null = null;
  const warnings: string[] = [];

  scheduleImmediateEmailDelivery('account_welcome', {
    defer: (candidate) => {
      task = candidate;
    },
    processQueue: async () => deliveryResult('not_configured'),
    logger: {
      warn: (message) => warnings.push(String(message)),
      error: () => undefined,
    },
  });

  assert.ok(task);
  await task();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /scheduled worker remains active/i);
  assert.match(warnings[0], /not_configured/);
  assert.doesNotMatch(warnings[0], /recipient|api[_ -]?key|secret/i);
});
