import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildAppleStudentPass } from '../../lib/wallet/apple';
import {
  buildGoogleStudentPassObject,
  buildGoogleStudentPassSaveUrl,
  type GoogleWalletRequester,
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
});

test('Google Wallet object is branded, upserted and issued by a short reference-only JWT', async () => {
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

    const requests: Parameters<GoogleWalletRequester>[1][] = [];
    const request: GoogleWalletRequester = async (requestConfig, walletRequest) => {
      assert.equal(requestConfig, config);
      requests.push(walletRequest);
      if (walletRequest.method === 'GET') {
        return {
          status: 200,
          data: { multipleDevicesAndHoldersAllowedStatus: 'ONE_USER_ALL_DEVICES' },
        };
      }
      return { status: walletRequest.method === 'PATCH' ? 404 : 200 };
    };
    const expectedObject = buildGoogleStudentPassObject(passData, config);
    const url = await buildGoogleStudentPassSaveUrl(passData, config, request);

    assert.equal(requests.length, 3);
    assert.equal(requests[0].method, 'GET');
    assert.equal(
      requests[0].url,
      `https://walletobjects.googleapis.com/walletobjects/v1/genericClass/${encodeURIComponent(config.classId)}`
    );
    assert.equal(requests[1].method, 'PATCH');
    assert.equal(
      requests[1].url,
      `https://walletobjects.googleapis.com/walletobjects/v1/genericObject/${encodeURIComponent(expectedObject.id)}`
    );
    assert.deepEqual('body' in requests[1] ? requests[1].body : null, expectedObject);
    assert.equal(requests[2].method, 'POST');
    assert.equal(
      requests[2].url,
      'https://walletobjects.googleapis.com/walletobjects/v1/genericObject'
    );
    assert.deepEqual('body' in requests[2] ? requests[2].body : null, expectedObject);

    assert.equal(expectedObject.classId, config.classId);
    assert.equal(expectedObject.genericType, 'GENERIC_STUDENT_CARD');
    assert.equal(expectedObject.hexBackgroundColor, '#063c38');
    assert.deepEqual(expectedObject.cardTitle, {
      defaultValue: { language: 'en-AU', value: 'ASWJ College' },
    });
    assert.deepEqual(expectedObject.subheader, {
      defaultValue: { language: 'en-AU', value: 'Student pass · Dev' },
    });
    assert.deepEqual(expectedObject.header, {
      defaultValue: { language: 'en-AU', value: passData.studentName },
    });
    assert.deepEqual(expectedObject.logo, {
      sourceUri: { uri: `${config.appBaseUrl}/wallet/google-logo-v2.png` },
      contentDescription: {
        defaultValue: { language: 'en-AU', value: 'ASWJ College mark' },
      },
    });
    assert.deepEqual(expectedObject.heroImage, {
      sourceUri: { uri: `${config.appBaseUrl}/wallet/google-hero.png` },
      contentDescription: {
        defaultValue: {
          language: 'en-AU',
          value: 'ASWJ College geometric artwork',
        },
      },
    });
    assert.deepEqual(expectedObject.barcode, {
      type: 'QR_CODE',
      value: QR_VALUE,
      alternateText: 'Class check-in',
      renderEncoding: 'UTF_8',
    });
    assert.deepEqual(expectedObject.textModulesData, [
      { id: 'row2left', header: 'Pass type', body: 'Student' },
      { id: 'row2right', header: 'Check-in', body: 'Show QR' },
    ]);
    assert.deepEqual(expectedObject.appLinkData, {
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

    assert.match(url, /^https:\/\/pay\.google\.com\/gp\/v\/save\//);
    const jwt = url.slice(url.lastIndexOf('/') + 1);
    assert.ok(jwt.length < 1000, `Reference JWT length was ${jwt.length}`);
    assert.ok(jwt.length <= 1800, `JWT length was ${jwt.length}`);

    const payload = decodeJwtPayload(jwt);
    assert.equal(payload.iss, config.clientEmail);
    assert.deepEqual(payload.origins, [config.appHostname]);
    assert.equal(payload.payload.genericObjects.length, 1);
    assert.deepEqual(payload.payload.genericObjects[0], {
      id: expectedObject.id,
      classId: config.classId,
    });
    assert.equal(expectedObject.id.includes(STUDENT_ID), false);

    const serialized = JSON.stringify(expectedObject).toLowerCase();
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
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Google Wallet updates an existing object without trying to create a duplicate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aswj-google-wallet-update-test-'));

  try {
    runOpenSsl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', 'google-key.pem'], directory);
    runOpenSsl(['pkcs8', '-topk8', '-nocrypt', '-in', 'google-key.pem', '-out', 'google-key-pkcs8.pem'], directory);
    const config: GoogleWalletConfiguration = {
      environment: 'dev',
      idSecret: ID_SECRET,
      appBaseUrl: 'https://aswj-college-git-dev-aswj-college.vercel.app',
      appHostname: 'aswj-college-git-dev-aswj-college.vercel.app',
      issuerId: '3388000000023211796',
      classId: '3388000000023211796.aswj_student_dev',
      clientEmail: 'aswj-college-wallet-dev@aswj-college-wallet-dev.iam.gserviceaccount.com',
      privateKeyPkcs8Pem: await readFile(join(directory, 'google-key-pkcs8.pem'), 'utf8'),
    };
    const requests: Parameters<GoogleWalletRequester>[1][] = [];
    const request: GoogleWalletRequester = async (_config, walletRequest) => {
      requests.push(walletRequest);
      if (walletRequest.method === 'GET') {
        return {
          status: 200,
          data: { multipleDevicesAndHoldersAllowedStatus: 'ONE_USER_ALL_DEVICES' },
        };
      }
      return { status: 200 };
    };

    const url = await buildGoogleStudentPassSaveUrl(passData, config, request);
    assert.match(url, /^https:\/\/pay\.google\.com\/gp\/v\/save\//);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[1].method, 'PATCH');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Google Wallet does not issue a stale save link when the provider update fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aswj-google-wallet-failure-test-'));

  try {
    runOpenSsl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', 'google-key.pem'], directory);
    runOpenSsl(['pkcs8', '-topk8', '-nocrypt', '-in', 'google-key.pem', '-out', 'google-key-pkcs8.pem'], directory);
    const config: GoogleWalletConfiguration = {
      environment: 'dev',
      idSecret: ID_SECRET,
      appBaseUrl: 'https://dev.aswjcollege.example',
      appHostname: 'dev.aswjcollege.example',
      issuerId: '123456789012',
      classId: '123456789012.aswj_student_dev',
      clientEmail: 'wallet-failure-test@example.iam.gserviceaccount.com',
      privateKeyPkcs8Pem: await readFile(join(directory, 'google-key-pkcs8.pem'), 'utf8'),
    };
    const request: GoogleWalletRequester = async (_config, walletRequest) => {
      if (walletRequest.method === 'GET') {
        return {
          status: 200,
          data: { multipleDevicesAndHoldersAllowedStatus: 'ONE_USER_ALL_DEVICES' },
        };
      }
      return { status: 500 };
    };

    await assert.rejects(
      buildGoogleStudentPassSaveUrl(passData, config, request),
      /Google Wallet object update failed with status 500/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Google Wallet refuses a class that permits multiple account holders', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aswj-google-wallet-holder-test-'));

  try {
    runOpenSsl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', 'google-key.pem'], directory);
    runOpenSsl(['pkcs8', '-topk8', '-nocrypt', '-in', 'google-key.pem', '-out', 'google-key-pkcs8.pem'], directory);
    const config: GoogleWalletConfiguration = {
      environment: 'dev',
      idSecret: ID_SECRET,
      appBaseUrl: 'https://dev.aswjcollege.example',
      appHostname: 'dev.aswjcollege.example',
      issuerId: '123456789012',
      classId: '123456789012.aswj_student_dev',
      clientEmail: 'wallet-holder-test@example.iam.gserviceaccount.com',
      privateKeyPkcs8Pem: await readFile(join(directory, 'google-key-pkcs8.pem'), 'utf8'),
    };
    const requests: Parameters<GoogleWalletRequester>[1][] = [];
    const request: GoogleWalletRequester = async (_config, walletRequest) => {
      requests.push(walletRequest);
      return {
        status: 200,
        data: { multipleDevicesAndHoldersAllowedStatus: 'MULTIPLE_HOLDERS' },
      };
    };

    await assert.rejects(
      buildGoogleStudentPassSaveUrl(passData, config, request),
      /Google Wallet class must use ONE_USER_ALL_DEVICES/
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
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
