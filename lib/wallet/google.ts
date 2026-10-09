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

const GOOGLE_SAFE_JWT_LENGTH = 1800;
const GOOGLE_SAVE_URL = 'https://pay.google.com/gp/v/save/';
const GOOGLE_WALLET_OBJECTS_URL =
  'https://walletobjects.googleapis.com/walletobjects/v1/genericObject';
const GOOGLE_WALLET_CLASSES_URL =
  'https://walletobjects.googleapis.com/walletobjects/v1/genericClass';
const GOOGLE_WALLET_SCOPE =
  'https://www.googleapis.com/auth/wallet_object.issuer';
const GOOGLE_DEV_OBJECT_VERSION = 'v2';

export type GoogleStudentPassObject = Record<string, unknown> & {
  id: string;
  classId: string;
};

type GoogleWalletRequest =
  | {
      method: 'GET';
      url: string;
    }
  | {
      method: 'PATCH' | 'POST';
      url: string;
      body: GoogleStudentPassObject;
    };

type GoogleWalletRequestResult = {
  status: number;
  data?: unknown;
};

export type GoogleWalletRequester = (
  config: GoogleWalletConfiguration,
  request: GoogleWalletRequest
) => Promise<GoogleWalletRequestResult>;

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

export function buildGoogleStudentPassObject(
  data: StudentWalletPassData,
  config: GoogleWalletConfiguration
): GoogleStudentPassObject {
  const objectId = `${config.issuerId}.${googleWalletObjectSuffix(
    data.studentId,
    config.environment,
    config.idSecret,
    config.environment === 'dev' ? GOOGLE_DEV_OBJECT_VERSION : undefined
  )}`;
  const portalUrl = new URL('/student', config.appBaseUrl).toString();

  return {
    id: objectId,
    classId: config.classId,
    state: 'ACTIVE',
    genericType: 'GENERIC_OTHER',
    cardTitle: localized('ASWJ College'),
    subheader: localized(
      config.environment === 'dev' ? 'Student pass · Dev' : 'Student pass'
    ),
    header: localized(data.studentName.slice(0, 60)),
    logo: {
      sourceUri: {
        uri: new URL('/wallet/google-logo-v2.png', config.appBaseUrl).toString(),
      },
      contentDescription: localized('ASWJ College mark'),
    },
    heroImage: {
      sourceUri: {
        uri: new URL('/wallet/google-hero.png', config.appBaseUrl).toString(),
      },
      contentDescription: localized('ASWJ College geometric artwork'),
    },
    barcode: {
      type: 'QR_CODE',
      value: data.qrValue,
      alternateText: 'Class check-in',
      renderEncoding: 'UTF_8',
    },
    hexBackgroundColor: '#063c38',
    textModulesData: [
      {
        id: 'row2left',
        header: 'Pass type',
        body: 'Student',
      },
      {
        id: 'row2right',
        header: 'Check-in',
        body: 'Show QR',
      },
    ],
    appLinkData: {
      webAppLinkInfo: {
        appTarget: {
          targetUri: {
            uri: portalUrl,
            description: 'Open the ASWJ College Student Portal',
          },
        },
      },
      displayText: localized('Student Portal'),
    },
  };
}

async function defaultGoogleWalletRequester(
  config: GoogleWalletConfiguration,
  request: GoogleWalletRequest
) {
  const response = await walletAuth(config).request({
    url: request.url,
    method: request.method,
    ...('body' in request ? { data: request.body } : {}),
    responseType: 'json',
    validateStatus: () => true,
  });

  return { status: response.status, data: response.data };
}

function successful(status: number) {
  return status >= 200 && status < 300;
}

async function requireSingleHolderClass(
  config: GoogleWalletConfiguration,
  request: GoogleWalletRequester
) {
  const classUrl = `${GOOGLE_WALLET_CLASSES_URL}/${encodeURIComponent(config.classId)}`;
  const response = await request(config, {
    method: 'GET',
    url: classUrl,
  });

  if (!successful(response.status)) {
    throw new Error(`Google Wallet class lookup failed with status ${response.status}.`);
  }

  const classData = response.data && typeof response.data === 'object'
    ? response.data as Record<string, unknown>
    : null;
  if (classData?.multipleDevicesAndHoldersAllowedStatus !== 'ONE_USER_ALL_DEVICES') {
    throw new Error('Google Wallet class must use ONE_USER_ALL_DEVICES.');
  }
}

async function upsertGoogleStudentPassObject(
  object: GoogleStudentPassObject,
  config: GoogleWalletConfiguration,
  request: GoogleWalletRequester
) {
  const objectUrl = `${GOOGLE_WALLET_OBJECTS_URL}/${encodeURIComponent(object.id)}`;
  const patch = await request(config, {
    method: 'PATCH',
    url: objectUrl,
    body: object,
  });

  if (successful(patch.status)) return;
  if (patch.status !== 404) {
    throw new Error(`Google Wallet object update failed with status ${patch.status}.`);
  }

  const insert = await request(config, {
    method: 'POST',
    url: GOOGLE_WALLET_OBJECTS_URL,
    body: object,
  });

  if (successful(insert.status)) return;

  // If another request created the object between PATCH and POST, update it now.
  if (insert.status === 409) {
    const retry = await request(config, {
      method: 'PATCH',
      url: objectUrl,
      body: object,
    });
    if (successful(retry.status)) return;
    throw new Error(`Google Wallet object update failed with status ${retry.status}.`);
  }

  throw new Error(`Google Wallet object creation failed with status ${insert.status}.`);
}

async function signedJwt(
  object: GoogleStudentPassObject,
  config: GoogleWalletConfiguration
) {
  const material = await signingMaterial(config);
  const issuedAt = Math.floor(Date.now() / 1000);
  const claims: GoogleSaveJwtClaims = {
    iss: material.clientEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: issuedAt,
    origins: [config.appHostname],
    payload: {
      genericObjects: [{
        id: object.id,
        classId: object.classId,
      }],
    },
  };
  return signSaveJwt(claims, material);
}

export async function buildGoogleStudentPassSaveUrl(
  data: StudentWalletPassData,
  config: GoogleWalletConfiguration,
  request: GoogleWalletRequester = defaultGoogleWalletRequester
) {
  const object = buildGoogleStudentPassObject(data, config);
  await requireSingleHolderClass(config, request);
  await upsertGoogleStudentPassObject(object, config, request);
  const jwt = await signedJwt(object, config);
  if (jwt.length > GOOGLE_SAFE_JWT_LENGTH) {
    throw new Error('The Google Wallet save link exceeded the safe size limit.');
  }
  return `${GOOGLE_SAVE_URL}${jwt}`;
}
