import 'server-only';

import { createHash } from 'node:crypto';
import {
  GoogleSigningMaterial,
  signSaveJwt,
  type GoogleSaveJwtClaims,
} from 'passmint';
import type { GoogleWalletConfiguration } from './config';
import { googleWalletObjectSuffix } from './identity';
import type { StudentWalletPassData } from './student-pass-data';

const GOOGLE_SAFE_JWT_LENGTH = 1800;
const GOOGLE_SAVE_URL = 'https://pay.google.com/gp/v/save/';

let signingMaterialCache: {
  fingerprint: string;
  material: Promise<GoogleSigningMaterial>;
} | null = null;

function signingMaterial(config: GoogleWalletConfiguration) {
  const fingerprint = createHash('sha256')
    .update(config.clientEmail)
    .update('\u0000')
    .update(config.issuerId)
    .update('\u0000')
    .update(config.privateKeyPkcs8Pem)
    .digest('hex');

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
  config: GoogleWalletConfiguration,
  compact = false
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

  if (!compact) {
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
  }

  return object;
}

async function signedJwt(
  data: StudentWalletPassData,
  config: GoogleWalletConfiguration,
  compact = false
) {
  const material = await signingMaterial(config);
  const issuedAt = Math.floor(Date.now() / 1000);
  const claims: GoogleSaveJwtClaims = {
    iss: material.clientEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: issuedAt,
    exp: issuedAt + 10 * 60,
    origins: [config.appHostname],
    payload: {
      genericObjects: [googleObject(data, config, compact)],
    },
  };
  return signSaveJwt(claims, material);
}

export async function buildGoogleStudentPassSaveUrl(
  data: StudentWalletPassData,
  config: GoogleWalletConfiguration
) {
  let jwt = await signedJwt(data, config);
  if (jwt.length > GOOGLE_SAFE_JWT_LENGTH) {
    jwt = await signedJwt(data, config, true);
  }
  if (jwt.length > GOOGLE_SAFE_JWT_LENGTH) {
    throw new Error('The Google Wallet save link exceeded the safe size limit.');
  }
  return `${GOOGLE_SAVE_URL}${jwt}`;
}
