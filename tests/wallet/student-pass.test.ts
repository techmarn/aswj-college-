import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildAppleStudentPass } from '../../lib/wallet/apple';
import {
  buildGoogleStudentPassSaveUrl,
  googleWalletFailureDiagnostic,
  type GoogleWalletJwtRequester,
} from '../../lib/wallet/google';
import {
  applePassSerialNumber,
  googleWalletObjectSuffix,
} from '../../lib/wallet/identity';
import type {
  AppleWalletConfiguration,
  GoogleWalletConfiguration,
} from '../../lib/wallet/config';
import type { StudentWalletPassData } from '../../lib/wallet/student-pass-data';

const STUDENT_ID = 'f6f505d5-afb2-4ae5-b9d0-064f6e0b03b2';
const ID_SECRET = 'test-only-wallet-identity-secret-32-characters';
const QR_VALUE = 'aswj:4d8b20de-9a80-45a7-8df3-766189d67c3b';

const passData: StudentWalletPassData = {
  studentId: STUDENT_ID,
  studentName: 'Test Student',
  qrValue: QR_VALUE,
  classes: [{
    id: 'c22ac4c4-6214-4d99-babd-55956a721cc3',
    name: 'Brothers Shariah Level 1',
    term: 'Term 3',
    location: 'Belmore',
    dayOfWeek: 3,
    startTime: '18:30:00',
    endTime: '20:30:00',
  }],
};

function decodeJwtPayload(jwt: string) {
  const segments = jwt.split('.');
  assert.equal(segments.length, 3);
  return JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
}

function runOpenSsl(args: string[], cwd: string) {
  execFileSync('openssl', args, { cwd, stdio: 'pipe' });
}

test('wallet object identifiers are stable, provider-specific and opaque', () => {
  const apple = applePassSerialNumber(STUDENT_ID, 'dev', ID_SECRET);
  const appleAgain = applePassSerialNumber(STUDENT_ID, 'dev', ID_SECRET);
  const google = googleWalletObjectSuffix(STUDENT_ID, 'dev', ID_SECRET);

  assert.equal(apple, appleAgain);
  assert.notEqual(apple, google);
  assert.equal(apple.includes(STUDENT_ID), false);
  assert.equal(google.includes(STUDENT_ID), false);
  assert.match(apple, /^aswj-dev-[a-f0-9]{32}$/);
  assert.match(google, /^aswj_student_dev_[a-f0-9]{32}$/);
  assert.match(
    googleWalletObjectSuffix(STUDENT_ID, 'dev', ID_SECRET, 'v3'),
    /^aswj_student_dev_v3_[a-f0-9]{32}$/
  );
});

test('Google Wallet JWT is provider-accepted, complete and excludes private registration data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aswj-google-wallet-test-'));

  try {
    runOpenSsl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', 'google-key.pem'], directory);
    runOpenSsl(['pkcs8', '-topk8', '-nocrypt', '-in', 'google-key.pem', '-out', 'google-key-pkcs8.pem'], directory);
    const privateKeyPkcs8Pem = await readFile(join(directory, 'google-key-pkcs8.pem'), 'utf8');
    const config: GoogleWalletConfiguration = {
      environment: 'dev',
      idSecret: ID_SECRET,
      appBaseUrl: 'https://dev.aswjcollege.example',
      appHostname: 'dev.aswjcollege.example',
      issuerId: '123456789012',
      classId: '123456789012.aswj_student_dev',
      clientEmail: 'wallet-test@example.iam.gserviceaccount.com',
      privateKeyPkcs8Pem,
    };

    const providerSaveUri = 'https://pay.google.com/gp/v/save/provider-issued-test-token';
    let jwt = '';
    const request: GoogleWalletJwtRequester = async (requestConfig, signedJwt) => {
      assert.equal(requestConfig, config);
      jwt = signedJwt;
      return { status: 200, data: { saveUri: providerSaveUri } };
    };
    const url = await buildGoogleStudentPassSaveUrl(passData, config, request);
    assert.equal(url, providerSaveUri);

    const payload = decodeJwtPayload(jwt);
    assert.equal(payload.iss, config.clientEmail);
    assert.deepEqual(payload.origins, [config.appBaseUrl]);
    assert.equal(new URL(payload.origins[0]).origin, config.appBaseUrl);
    assert.equal(payload.payload.genericObjects.length, 1);
    const object = payload.payload.genericObjects[0];
    assert.equal(object.classId, config.classId);
    assert.equal(object.genericType, 'GENERIC_OTHER');
    assert.match(object.id, /^123456789012\.aswj_student_dev_v3_[a-f0-9]{32}$/);
    assert.equal(object.id.includes(STUDENT_ID), false);
    assert.equal(object.hexBackgroundColor, '#063c38');
    assert.deepEqual(object.cardTitle, {
      defaultValue: { language: 'en-AU', value: 'ASWJ College' },
    });
    assert.deepEqual(object.subheader, {
      defaultValue: { language: 'en-AU', value: 'Student pass · Dev' },
    });
    assert.deepEqual(object.header, {
      defaultValue: { language: 'en-AU', value: passData.studentName },
    });
    assert.deepEqual(object.logo, {
      sourceUri: { uri: `${config.appBaseUrl}/wallet/google-logo-v2.png` },
      contentDescription: {
        defaultValue: { language: 'en-AU', value: 'ASWJ College mark' },
      },
    });
    assert.deepEqual(object.heroImage, {
      sourceUri: { uri: `${config.appBaseUrl}/wallet/google-hero.png` },
      contentDescription: {
        defaultValue: {
          language: 'en-AU',
          value: 'ASWJ College geometric artwork',
        },
      },
    });
    assert.deepEqual(object.barcode, {
      type: 'QR_CODE',
      value: QR_VALUE,
      alternateText: 'Class check-in',
      renderEncoding: 'UTF_8',
    });
    assert.deepEqual(object.textModulesData, [
      { id: 'row2left', header: 'Pass type', body: 'Student' },
      { id: 'row2right', header: 'Check-in', body: 'Show QR' },
    ]);
    assert.deepEqual(object.appLinkData, {
      webAppLinkInfo: {
        appTarget: {
          targetUri: {
            uri: `${config.appBaseUrl}/student`,
            description: 'Open the ASWJ College Student Portal',
          },
        },
      },
      displayText: {
        defaultValue: { language: 'en-AU', value: 'Student Portal' },
      },
    });

    const serialized = JSON.stringify(payload).toLowerCase();
    assert.equal(serialized.includes('brothers shariah level 1'), false);
    for (const forbidden of [
      'email address',
      'phone number',
      'date of birth',
      'guardian',
      'medical',
      'allergy',
      'learning notes',
    ]) {
      assert.equal(serialized.includes(forbidden), false, `unexpected private field: ${forbidden}`);
    }

    await assert.rejects(
      buildGoogleStudentPassSaveUrl(passData, config, async () => ({
        status: 400,
        data: {
          error: {
            status: 'INVALID_ARGUMENT',
            message: `Sensitive provider response ${jwt}`,
            errors: [{ reason: 'invalidJwt' }],
          },
        },
      })),
      (error) => {
        const diagnostic = googleWalletFailureDiagnostic(error);
        assert.deepEqual(diagnostic, {
          event: 'google_wallet_save_failed',
          stage: 'provider_rejected',
          status: 400,
          providerStatus: 'INVALID_ARGUMENT',
          providerReason: 'invalidJwt',
        });
        assert.equal(JSON.stringify(diagnostic).includes(jwt), false);
        return true;
      }
    );

    await assert.rejects(
      buildGoogleStudentPassSaveUrl(passData, config, async () => ({
        status: 200,
        data: { saveUri: 'https://example.com/not-google-wallet' },
      })),
      (error) => {
        assert.deepEqual(googleWalletFailureDiagnostic(error), {
          event: 'google_wallet_save_failed',
          stage: 'provider_response',
          status: 200,
        });
        return true;
      }
    );

    await assert.rejects(
      buildGoogleStudentPassSaveUrl(passData, config, async () => {
        throw new Error(`Sensitive network failure ${jwt}`);
      }),
      (error) => {
        const diagnostic = googleWalletFailureDiagnostic(error);
        assert.deepEqual(diagnostic, {
          event: 'google_wallet_save_failed',
          stage: 'provider_request',
        });
        assert.equal(JSON.stringify(diagnostic).includes(jwt), false);
        return true;
      }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Google Wallet artwork has the required provider dimensions', async () => {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const expectedAssets = [
    { filename: 'google-hero.png', width: 1032, height: 812 },
    { filename: 'google-logo-v2.png', width: 660, height: 660 },
  ];

  for (const asset of expectedAssets) {
    const bytes = await readFile(join(process.cwd(), 'public', 'wallet', asset.filename));
    assert.deepEqual(bytes.subarray(0, 8), pngSignature);
    assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
    assert.equal(bytes.readUInt32BE(16), asset.width);
    assert.equal(bytes.readUInt32BE(20), asset.height);
  }
});

test('Apple Wallet output is a signed pkpass containing the expected student QR and no registration data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aswj-apple-wallet-test-'));

  try {
    runOpenSsl(['genrsa', '-out', 'ca-key.pem', '2048'], directory);
    runOpenSsl([
      'req', '-x509', '-new', '-key', 'ca-key.pem', '-sha256', '-days', '2',
      '-subj', '/C=US/O=ASWJ Test/OU=G4/CN=Test WWDR', '-out', 'wwdr.pem',
    ], directory);
    runOpenSsl(['genrsa', '-out', 'signer-rsa.pem', '2048'], directory);
    runOpenSsl([
      'req', '-new', '-key', 'signer-rsa.pem',
      '-subj', '/C=AU/O=ASWJ College/OU=TEAMID1234/CN=ASWJ Test Pass',
      '-out', 'signer.csr',
    ], directory);
    runOpenSsl([
      'x509', '-req', '-in', 'signer.csr', '-CA', 'wwdr.pem', '-CAkey', 'ca-key.pem',
      '-CAcreateserial', '-out', 'signer.pem', '-days', '2', '-sha256',
    ], directory);
    runOpenSsl([
      'pkcs8', '-topk8', '-nocrypt', '-in', 'signer-rsa.pem', '-out', 'signer-key-pkcs8.pem',
    ], directory);

    const config: AppleWalletConfiguration = {
      environment: 'dev',
      idSecret: ID_SECRET,
      appBaseUrl: 'https://dev.aswjcollege.example',
      appHostname: 'dev.aswjcollege.example',
      passTypeIdentifier: 'pass.com.aswjcollege.student.dev',
      teamIdentifier: 'TEAMID1234',
      signerCertPem: await readFile(join(directory, 'signer.pem'), 'utf8'),
      privateKeyPkcs8Pem: await readFile(join(directory, 'signer-key-pkcs8.pem'), 'utf8'),
      wwdrPem: await readFile(join(directory, 'wwdr.pem'), 'utf8'),
    };

    const signed = await buildAppleStudentPass(passData, config);
    const bytes = signed.toUint8Array();
    assert.equal(bytes[0], 0x50);
    assert.equal(bytes[1], 0x4b);

    const passPath = join(directory, 'student.pkpass');
    await writeFile(passPath, bytes);
    execFileSync('unzip', ['-t', passPath], { stdio: 'pipe' });
    const archiveList = execFileSync('unzip', ['-Z1', passPath], { encoding: 'utf8' });
    for (const required of [
      'pass.json',
      'manifest.json',
      'signature',
      'icon.png',
      'icon@2x.png',
      'icon@3x.png',
      'logo.png',
      'logo@2x.png',
      'logo@3x.png',
    ]) {
      assert.match(archiveList, new RegExp(`(^|\\n)${required.replace('.', '\\.')}($|\\n)`));
    }

    const passJson = JSON.parse(execFileSync('unzip', ['-p', passPath, 'pass.json'], { encoding: 'utf8' }));
    assert.equal(passJson.passTypeIdentifier, config.passTypeIdentifier);
    assert.equal(passJson.teamIdentifier, config.teamIdentifier);
    assert.equal(passJson.organizationName, 'ASWJ College');
    assert.equal(passJson.logoText, 'ASWJ College');
    assert.equal(passJson.sharingProhibited, true);
    assert.equal(passJson.backgroundColor, 'rgb(6, 60, 56)');
    assert.equal(passJson.foregroundColor, 'rgb(255, 255, 255)');
    assert.equal(passJson.labelColor, 'rgb(247, 216, 134)');
    assert.equal(passJson.barcodes[0].message, QR_VALUE);
    assert.equal(passJson.barcodes[0].altText, 'Class check-in');
    assert.equal(passJson.serialNumber.includes(STUDENT_ID), false);
    assert.deepEqual(passJson.generic.headerFields[0], {
      key: 'environment',
      label: 'ENVIRONMENT',
      value: 'DEV TEST',
    });
    assert.equal(passJson.generic.primaryFields[0].value, passData.studentName);
    assert.deepEqual(passJson.generic.secondaryFields[0], {
      key: 'pass-type',
      label: 'PASS TYPE',
      value: 'STUDENT',
    });
    assert.deepEqual(passJson.generic.auxiliaryFields[0], {
      key: 'check-in',
      label: 'CHECK-IN',
      value: 'SHOW QR',
    });
    assert.equal(passJson.generic.backFields[0].label, 'HOW TO CHECK IN');
    assert.deepEqual(passJson.generic.backFields[1], {
      key: 'student-portal',
      label: 'STUDENT PORTAL',
      value: `${config.appBaseUrl}/student`,
      dataDetectorTypes: ['PKDataDetectorTypeLink'],
    });
    assert.equal(passJson.generic.backFields[2].label, 'PASS SECURITY');

    const serialized = JSON.stringify(passJson).toLowerCase();
    assert.equal(serialized.includes('brothers shariah level 1'), false);
    for (const forbidden of ['email', 'phone', 'birth', 'guardian', 'medical', 'allergy', 'learning']) {
      assert.equal(serialized.includes(forbidden), false, `unexpected private field: ${forbidden}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
