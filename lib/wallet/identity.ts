import 'server-only';

import { createHmac } from 'node:crypto';
import type { WalletEnvironment } from './config';

function digestIdentifier(
  kind: 'apple-serial' | 'google-object',
  studentId: string,
  environment: WalletEnvironment,
  secret: string
) {
  return createHmac('sha256', secret)
    .update(`aswj-wallet:${environment}:${kind}:${studentId}`)
    .digest('hex')
    .slice(0, 32);
}

export function applePassSerialNumber(
  studentId: string,
  environment: WalletEnvironment,
  secret: string
) {
  return `aswj-${environment}-${digestIdentifier('apple-serial', studentId, environment, secret)}`;
}

export function googleWalletObjectSuffix(
  studentId: string,
  environment: WalletEnvironment,
  secret: string,
  version?: string
) {
  const versionSegment = version ? `_${version}` : '';
  return `aswj_student_${environment}${versionSegment}_${digestIdentifier('google-object', studentId, environment, secret)}`;
}
