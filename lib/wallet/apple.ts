import 'server-only';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pass, SigningMaterial } from 'passmint';
import type { AppleWalletConfiguration } from './config';
import { applePassSerialNumber } from './identity';
import type { StudentWalletPassData } from './student-pass-data';

type ApplePassAssets = {
  icon: Uint8Array<ArrayBuffer>;
  icon2x: Uint8Array<ArrayBuffer>;
  icon3x: Uint8Array<ArrayBuffer>;
};

let assetsPromise: Promise<ApplePassAssets> | null = null;
let signingMaterialCache: {
  fingerprint: string;
  material: Promise<SigningMaterial>;
} | null = null;

function copiedBytes(input: Uint8Array): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(new ArrayBuffer(input.byteLength));
  output.set(input);
  return output;
}

function loadApplePassAssets() {
  assetsPromise ??= Promise.all([
    readFile(join(process.cwd(), 'public', 'wallet', 'apple-icon.png')),
    readFile(join(process.cwd(), 'public', 'wallet', 'apple-icon@2x.png')),
    readFile(join(process.cwd(), 'public', 'wallet', 'apple-icon@3x.png')),
  ]).then(([icon, icon2x, icon3x]) => ({
    icon: copiedBytes(icon),
    icon2x: copiedBytes(icon2x),
    icon3x: copiedBytes(icon3x),
  }));
  return assetsPromise;
}

function signingMaterial(config: AppleWalletConfiguration) {
  const fingerprint = createHash('sha256')
    .update(config.signerCertPem)
    .update('\u0000')
    .update(config.wwdrPem)
    .update('\u0000')
    .update(config.privateKeyPkcs8Pem)
    .digest('hex');

  if (signingMaterialCache?.fingerprint !== fingerprint) {
    signingMaterialCache = {
      fingerprint,
      material: SigningMaterial.fromPem({
        signerCertPem: config.signerCertPem,
        wwdrPem: config.wwdrPem,
        privateKeyPkcs8Pem: config.privateKeyPkcs8Pem,
      }),
    };
  }

  return signingMaterialCache.material;
}

export async function buildAppleStudentPass(
  data: StudentWalletPassData,
  config: AppleWalletConfiguration
) {
  const [assets, material] = await Promise.all([
    loadApplePassAssets(),
    signingMaterial(config),
  ]);
  const serialNumber = applePassSerialNumber(
    data.studentId,
    config.environment,
    config.idSecret
  );
  const builder = Pass.generic({
    passTypeIdentifier: config.passTypeIdentifier,
    serialNumber,
    teamIdentifier: config.teamIdentifier,
    organizationName: 'ASWJ College',
    description: 'ASWJ College student pass',
    logoText: 'ASWJ College',
    sharingProhibited: true,
    colors: {
      background: '#063c38',
      foreground: '#ffffff',
      label: '#d9e8e3',
    },
    images: {
      icon: {
        x1: { bytes: assets.icon },
        x2: { bytes: assets.icon2x },
        x3: { bytes: assets.icon3x },
      },
    },
    barcodes: [{
      format: 'qr',
      message: data.qrValue,
      messageEncoding: 'utf-8',
      altText: 'ASWJ student check-in',
    }],
  });

  if (config.environment === 'dev') {
    builder.headerField({
      key: 'environment',
      label: 'ENVIRONMENT',
      value: 'DEV TEST',
    });
  }

  builder
    .primaryField({
      key: 'student',
      label: 'STUDENT',
      value: data.studentName,
    })
    .secondaryField({
      key: 'pass-type',
      label: 'PASS',
      value: 'Student check-in',
    })
    .auxiliaryField({
      key: 'verification',
      label: 'STATUS',
      value: 'Verified at check-in',
    });

  builder.backField({
    key: 'check-in-help',
    label: 'Class Check-in',
    value: 'Present the QR code at the classroom entrance. Current class, schedule and enrolment status are always verified securely by ASWJ College.',
  });

  return builder.sign(material);
}
