import 'server-only';

import { after } from 'next/server';
import {
  processEmailDeliveryQueue,
  type EmailDeliveryBatchResult,
} from './worker';

const IMMEDIATE_BATCH_SIZE = 10;
const IMMEDIATE_LEASE_SECONDS = 120;
const MAX_IMMEDIATE_BATCHES = 10;
const IMMEDIATE_WORKER_CONCURRENCY = 2;

export type ImmediateEmailTrigger =
  | 'account_welcome'
  | 'application_received'
  | 'application_decision'
  | 'bulk_application_acceptance'
  | 'enrolment_status'
  | 'forms_application';

type DeferredTask = () => void | Promise<void>;

type ImmediateEmailDependencies = {
  batchCount?: number;
  defer?: (task: DeferredTask) => void;
  processQueue?: (options: {
    limit: number;
    leaseSeconds: number;
  }) => Promise<EmailDeliveryBatchResult>;
  logger?: Pick<Console, 'error' | 'warn'>;
};

/**
 * Starts a best-effort outbox drain after the current response has completed.
 * The committed outbox row remains available to the scheduled worker if this
 * immediate attempt cannot run or the provider asks us to retry.
 */
export function scheduleImmediateEmailDelivery(
  trigger: ImmediateEmailTrigger,
  dependencies: ImmediateEmailDependencies = {}
) {
  const defer = dependencies.defer ?? after;
  const processQueue = dependencies.processQueue ?? processEmailDeliveryQueue;
  const logger = dependencies.logger ?? console;
  const requestedBatchCount = Number.isSafeInteger(dependencies.batchCount)
    ? Number(dependencies.batchCount)
    : 1;
  const batchCount = Math.min(
    Math.max(requestedBatchCount, 1),
    MAX_IMMEDIATE_BATCHES
  );

  try {
    defer(async () => {
      try {
        for (let offset = 0; offset < batchCount; offset += IMMEDIATE_WORKER_CONCURRENCY) {
          const workers = Array.from(
            { length: Math.min(IMMEDIATE_WORKER_CONCURRENCY, batchCount - offset) },
            () => processQueue({
              limit: IMMEDIATE_BATCH_SIZE,
              leaseSeconds: IMMEDIATE_LEASE_SECONDS,
            })
          );
          const results = await Promise.all(workers);
          const unavailable = results.find((result) => result.status !== 'processed');

          if (unavailable) {
            logger.warn(JSON.stringify({
              level: 'warn',
              message: 'Immediate email delivery was unavailable; the scheduled worker remains active.',
              trigger,
              status: unavailable.status,
            }));
            break;
          }

          if (results.every((result) => result.claimed === 0)) break;
        }
      } catch {
        // Never expose provider payloads, recipient addresses or configuration.
        // The durable outbox and scheduled worker retain responsibility for retry.
        logger.error(JSON.stringify({
          level: 'error',
          message: 'Immediate email delivery failed; the scheduled worker will retry.',
          trigger,
        }));
      }
    });
  } catch {
    // Scheduling must never turn a committed workflow into a visible failure.
    logger.error(JSON.stringify({
      level: 'error',
      message: 'Immediate email delivery could not be scheduled; the scheduled worker will retry.',
      trigger,
    }));
  }
}
