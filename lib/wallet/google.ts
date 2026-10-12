import 'server-only';

import { createHash } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import {
  GoogleSigningMaterial,
  signSaveJwt,
  type GoogleSaveJwtClaims,
} from 'passmint';
import type { GoogleWalletConfiguration } from './config';
import { googleWalletObjectSuffix } from './identity';
import type { StudentWalletPassData } from './student-pass-data';

const GOOGLE_WALLET_JWT_INSERT_URL =
  'https://walletobjects.googleapis.com/walletobjects/v1/jwt';
const GOOGLE_WALLET_SCOPE =
  'https://www.googleapis.com/auth/wallet_object.issuer';
const GOOGLE_SAVE_URI_MAX_LENGTH = 4096;

type GoogleWalletJwtInsertResult = {
  status: number;
  data?: unknown;
};

export type GoogleWalletJwtRequester = (
  config: GoogleWalletConfiguration,
  jwt: string
) => Promise<GoogleWalletJwtInsertResult>;

type GoogleWalletFailureStage =
  | 'jwt_signing'
  | 'provider_request'
  | 'provider_rejected'
  | 'provider_response';

class GoogleWalletSaveError extends Error {
  constructor(
    readonly stage: GoogleWalletFailureStage,
    readonly status?: number,
    readonly providerStatus?: string,
    readonly providerReason?: string
  ) {
    super('Google Wallet save failed.');
    this.name = 'GoogleWalletSaveError';
  }
}

let signingMaterialCache: {
  fingerprint: string;
  material: Promise<GoogleSigningMaterial>;
} | null = null;

let walletAuthCache: {
  fingerprint: string;
  auth: GoogleAuth;
} | null = null;

function credentialFingerprint(config: GoogleWalletConfiguration) {
  return createHash('sha256')
    .update(config.clientEmail)
    .update('\u0000')
    .update(config.issuerId)
    .update('\u0000')
    .update(config.privateKeyPkcs8Pem)
    .digest('hex');
}

function signingMaterial(config: GoogleWalletConfiguration) {
  const fingerprint = credentialFingerprint(config);

  if (signingMaterialCache?.fingerprint !== fingerprint) {
    signingMaterialCache = {
      fingerprint,
      material: GoogleSigningMaterial.fromServiceAccount({
        clientEmail: config.clientEmail,
        privateKeyPkcs8Pem: config.privateKeyPkcs8Pem,
        issuerId: config.issuerId,
      }),
    };
  }

  return signingMaterialCache.material;
}

function walletAuth(config: GoogleWalletConfiguration) {
  const fingerprint = credentialFingerprint(config);

  if (walletAuthCache?.fingerprint !== fingerprint) {
    walletAuthCache = {
      fingerprint,
      auth: new GoogleAuth({
        credentials: {
          client_email: config.clientEmail,
          private_key: config.privateKeyPkcs8Pem,
        },
        scopes: [GOOGLE_WALLET_SCOPE],
      }),
    };
  }

  return walletAuthCache.auth;
}

function localized(value: string) {
  return {
    defaultValue: {
      language: 'en-AU',
      value,
    },
  };
}

function googleObject(
  data: StudentWalletPassData,
  config: GoogleWalletConfiguration
) {
  const object: Record<string, unknown> = {
    id: `${config.issuerId}.${googleWalletObjectSuffix(
      data.studentId,
      config.environment,
      config.idSecret
    )}`,
    classId: config.classId,
    state: 'ACTIVE',
    cardTitle: localized('ASWJ College'),
    header: localized(data.studentName.slice(0, 60)),
    barcode: {
      type: 'QR_CODE',
      value: data.qrValue,
      renderEncoding: 'UTF_8',
    },
    hexBackgroundColor: '#063c38',
  };

  object.subheader = localized(
    config.environment === 'dev' ? 'Student pass · DEV TEST' : 'Student pass'
  );
  object.logo = {
    sourceUri: {
      uri: new URL('/wallet/google-logo.png', config.appBaseUrl).toString(),
    },
  };
  object.textModulesData = [{
    id: 'check-in-status',
    header: 'Class Check-in',
    body: 'Current class, schedule and enrolment status are verified securely at check-in.',
  }];

  return object;
}

async function signedJwt(
  data: StudentWalletPassData,
  config: GoogleWalletConfiguration
) {
  const material = await signingMaterial(config);
  const issuedAt = Math.floor(Date.now() / 1000);
  const claims: GoogleSaveJwtClaims = {
    iss: material.clientEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: issuedAt,
    exp: issuedAt + 10 * 60,
    origins: [config.appBaseUrl],
    payload: {
      genericObjects: [googleObject(data, config)],
    },
  };
  return signSaveJwt(claims, material);
}

async function defaultGoogleWalletJwtRequester(
  config: GoogleWalletConfiguration,
  jwt: string
): Promise<GoogleWalletJwtInsertResult> {
  const response = await walletAuth(config).request({
    url: GOOGLE_WALLET_JWT_INSERT_URL,
    method: 'POST',
    data: { jwt },
    responseType: 'json',
    validateStatus: () => true,
  });

  return { status: response.status, data: response.data };
}

function successful(status: number) {
  return status >= 200 && status < 300;
}

function safeProviderToken(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value)
    ? value
    : undefined;
}

function providerErrorDetails(data: unknown) {
  if (!data || typeof data !== 'object') return {};
  const error = 'error' in data && data.error && typeof data.error === 'object'
    ? data.error as Record<string, unknown>
    : null;
  if (!error) return {};

  const errors = Array.isArray(error.errors) ? error.errors : [];
  const firstError = errors[0] && typeof errors[0] === 'object'
    ? errors[0] as Record<string, unknown>
    : null;

  return {
    providerStatus: safeProviderToken(error.status),
    providerReason: safeProviderToken(firstError?.reason),
  };
}

function providerSaveUri(data: unknown) {
  if (!data || typeof data !== 'object' || !('saveUri' in data)) return null;
  const value = data.saveUri;
  if (typeof value !== 'string' || value.length > GOOGLE_SAVE_URI_MAX_LENGTH) {
    return null;
  }

  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
      || url.hostname !== 'pay.google.com'
      || !url.pathname.startsWith('/gp/v/save/')
      || url.username
      || url.password
      || url.hash
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function googleWalletFailureDiagnostic(error: unknown) {
  if (!(error instanceof GoogleWalletSaveError)) {
    return {
      event: 'google_wallet_save_failed' as const,
      stage: 'unexpected' as const,
    };
  }

  return {
    event: 'google_wallet_save_failed' as const,
    stage: error.stage,
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(error.providerStatus ? { providerStatus: error.providerStatus } : {}),
    ...(error.providerReason ? { providerReason: error.providerReason } : {}),
  };
}

export async function buildGoogleStudentPassSaveUrl(
  data: StudentWalletPassData,
  config: GoogleWalletConfiguration,
  request: GoogleWalletJwtRequester = defaultGoogleWalletJwtRequester
) {
  let jwt: string;
  try {
    jwt = await signedJwt(data, config);
  } catch {
    throw new GoogleWalletSaveError('jwt_signing');
  }

  let response: GoogleWalletJwtInsertResult;
  try {
    response = await request(config, jwt);
  } catch {
    throw new GoogleWalletSaveError('provider_request');
  }

  if (!successful(response.status)) {
    const details = providerErrorDetails(response.data);
    throw new GoogleWalletSaveError(
      'provider_rejected',
      response.status,
      details.providerStatus,
      details.providerReason
    );
  }

  const saveUri = providerSaveUri(response.data);
  if (!saveUri) {
    throw new GoogleWalletSaveError('provider_response', response.status);
  }

  return saveUri;
}
