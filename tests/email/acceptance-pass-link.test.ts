import assert from 'node:assert/strict';
import test from 'node:test';
import { loginDestination, safeLoginNext } from '../../lib/auth/login-next';
import { renderTransactionalEmail } from '../../lib/email/render';
import type {
  EmailTemplateDefinition,
  EmailTemplateKey,
} from '../../lib/email/templates';

const APP_BASE_URL = 'https://dev.aswj.example';
const CLASS_ID = '6f465170-81ed-451e-8b94-1110147bdb60';
const PAYLOAD = {
  firstName: 'Test',
  className: 'Quran Foundations',
  classTerm: 'Term 4',
  classId: CLASS_ID,
  classDayOfWeek: 6,
  classStartTime: '09:30:00',
  classEndTime: '11:00:00',
  waitlistPosition: null,
  token: 'secret-wallet-token',
  qrValue: 'aswj:secret-student-qr',
  walletUrl: 'https://pay.google.com/gp/v/save/attacker-token',
};

const NON_ACCEPTED_TEMPLATE_KEYS = [
  'account_welcome',
  'application_received',
  'application_waitlisted',
  'application_declined',
  'enrolment_suspended',
] as const satisfies readonly EmailTemplateKey[];

function assertNoWalletCredential(value: string) {
  assert.doesNotMatch(value, /pay\.google\.com/i);
  assert.doesNotMatch(value, /\/api\/student\/wallet\/(?:apple|google)/i);
  assert.doesNotMatch(value, /\.pkpass\b/i);
  assert.doesNotMatch(value, /secret-wallet-token/i);
  assert.doesNotMatch(value, /secret-student-qr/i);
}

test('accepted application email links to the protected student pass landing page', () => {
  const rendered = renderTransactionalEmail(
    'application_accepted',
    PAYLOAD,
    APP_BASE_URL
  );

  assert.match(rendered.html, /href="https:\/\/dev\.aswj\.example\/student\/pass"/);
  assert.match(rendered.html, />Open Student Pass<\/a>/);
  assert.match(
    rendered.html,
    new RegExp(`href="https:\\/\\/dev\\.aswj\\.example\\/student\\/calendar\\/${CLASS_ID}"`)
  );
  assert.match(rendered.html, />Add class to calendar<\/a>/);
  assert.match(rendered.html, /Class day and time: Saturday, 9:30 am–11:00 am\./);
  assert.match(rendered.html, /then select Add to Apple Wallet\./);
  assert.match(rendered.html, /Jazzakom Allahu Khaira/);
  assert.match(
    rendered.text,
    /Open Student Pass: https:\/\/dev\.aswj\.example\/student\/pass/
  );
  assert.match(
    rendered.text,
    new RegExp(`Add class to calendar: https:\\/\\/dev\\.aswj\\.example\\/student\\/calendar\\/${CLASS_ID}`)
  );
  assertNoWalletCredential(rendered.html);
  assertNoWalletCredential(rendered.text);
});

test('accepted custom database template keeps its copy but receives the pass link', () => {
  const definition: EmailTemplateDefinition = {
    templateKey: 'application_accepted',
    version: 'database:7',
    subjectTemplate: 'Accepted: {{class_label}}',
    previewTemplate: 'Your place is confirmed.',
    headingTemplate: 'Welcome to class',
    bodyTemplate: 'Assalamu alaikum {{first_name}},\n\nYour place is confirmed.',
    buttonLabel: 'View your pass',
  };
  const rendered = renderTransactionalEmail(
    'application_accepted',
    PAYLOAD,
    APP_BASE_URL,
    definition
  );

  assert.equal(rendered.templateVersion, 'database:7');
  assert.match(rendered.html, /Your place is confirmed\./);
  assert.match(rendered.html, />View your pass<\/a>/);
  assert.match(rendered.text, /View your pass: https:\/\/dev\.aswj\.example\/student\/pass/);
  assert.match(rendered.html, />Add class to calendar<\/a>/);
});

test('reinstated enrolment email links to the pass and class calendar', () => {
  const rendered = renderTransactionalEmail(
    'enrolment_reinstated',
    PAYLOAD,
    APP_BASE_URL
  );

  assert.match(rendered.html, /href="https:\/\/dev\.aswj\.example\/student\/pass"/);
  assert.match(rendered.html, />Open Student Pass<\/a>/);
  assert.match(rendered.html, />Add class to calendar<\/a>/);
  assert.match(rendered.text, /Class day and time: Saturday, 9:30 am–11:00 am\./);
  assertNoWalletCredential(rendered.html);
  assertNoWalletCredential(rendered.text);
});

test('legacy reinstatement payload keeps the Student Portal action', () => {
  const rendered = renderTransactionalEmail(
    'enrolment_reinstated',
    { ...PAYLOAD, classId: undefined },
    APP_BASE_URL
  );

  assert.match(rendered.html, /href="https:\/\/dev\.aswj\.example\/student"/);
  assert.match(rendered.html, />Open Student Portal<\/a>/);
  assert.doesNotMatch(rendered.html, /\/student\/calendar\//);
  assert.doesNotMatch(rendered.html, /Use Add class to calendar below/);
  assert.match(rendered.html, /calendar link will be available once the complete schedule is confirmed/i);
});

test('an incomplete schedule never promises a calendar action', () => {
  const rendered = renderTransactionalEmail(
    'application_accepted',
    { ...PAYLOAD, classEndTime: null },
    APP_BASE_URL
  );

  assert.doesNotMatch(rendered.html, /\/student\/calendar\//);
  assert.doesNotMatch(rendered.html, /Use Add class to calendar below/);
  assert.match(rendered.html, /calendar link will be available once the complete schedule is confirmed/i);
});

test('a legacy accepted definition and payload stay free of new schedule promises', () => {
  const definition: EmailTemplateDefinition = {
    templateKey: 'application_accepted',
    version: 'database:2',
    subjectTemplate: 'Your application was accepted',
    previewTemplate: 'Your application has been accepted.',
    headingTemplate: 'Application accepted',
    bodyTemplate: 'Assalamu alaikum {{first_name}},\n\nYour application for {{class_label}} has been accepted.\n\nOpen your Student Pass to add it to Apple Wallet or Google Wallet.',
    buttonLabel: 'Open Student Pass',
  };
  const rendered = renderTransactionalEmail(
    'application_accepted',
    { ...PAYLOAD, classId: undefined, classDayOfWeek: undefined, classStartTime: undefined, classEndTime: undefined },
    APP_BASE_URL,
    definition
  );

  assert.doesNotMatch(rendered.html, /\/student\/calendar\//);
  assert.doesNotMatch(rendered.html, /Class day and time:/);
  assert.doesNotMatch(rendered.html, /calendar link will be available/i);
});

for (const templateKey of NON_ACCEPTED_TEMPLATE_KEYS) {
  test(`${templateKey} email continues to link to the Student Portal`, () => {
    const rendered = renderTransactionalEmail(
      templateKey,
      PAYLOAD,
      APP_BASE_URL
    );

    assert.match(rendered.html, /href="https:\/\/dev\.aswj\.example\/student"/);
    assert.match(rendered.text, /Open Student Portal: https:\/\/dev\.aswj\.example\/student/);
    assert.doesNotMatch(rendered.html, /\/student\/pass/);
    assert.doesNotMatch(rendered.text, /\/student\/pass/);
    assert.doesNotMatch(rendered.html, /\/student\/calendar\//);
    assert.doesNotMatch(rendered.text, /\/student\/calendar\//);
    assertNoWalletCredential(rendered.html);
    assertNoWalletCredential(rendered.text);
  });
}

test('post-login destinations use an exact allowlist', () => {
  assert.equal(safeLoginNext('/scanner'), '/scanner');
  assert.equal(safeLoginNext('/student/apply'), '/student/apply');
  assert.equal(safeLoginNext('/student/pass'), '/student/pass');
  assert.equal(
    safeLoginNext(`/student/calendar/${CLASS_ID.toUpperCase()}`),
    `/student/calendar/${CLASS_ID}`
  );
  assert.equal(safeLoginNext('https://attacker.example'), null);
  assert.equal(safeLoginNext('//attacker.example'), null);
  assert.equal(safeLoginNext('/scanner/'), null);
  assert.equal(safeLoginNext('/scanner/check-in'), null);
  assert.equal(safeLoginNext('/scanner?mode=admin'), null);
  assert.equal(safeLoginNext('/scanner#camera'), null);
  assert.equal(safeLoginNext('/api/student/wallet/google'), null);
  assert.equal(safeLoginNext('/student/pass?token=secret'), null);
  assert.equal(safeLoginNext(`/student/calendar/${CLASS_ID}?token=secret`), null);
  assert.equal(safeLoginNext(`/student/calendar/${CLASS_ID}#fragment`), null);
  assert.equal(safeLoginNext('/student/calendar/not-a-uuid'), null);
  assert.equal(safeLoginNext(`/api/student/calendar/${CLASS_ID}`), null);
});

test('scanner post-login destination is limited to staff roles', () => {
  for (const role of ['teacher', 'admin', 'super_admin']) {
    assert.equal(loginDestination(role, '/scanner'), '/scanner');
  }

  assert.equal(loginDestination('student', '/scanner'), '/student');
  assert.equal(loginDestination('unknown', '/scanner'), '/student');
  assert.equal(loginDestination('teacher', null), '/teacher/check-in');
  assert.equal(loginDestination('admin', null), '/admin');
  assert.equal(loginDestination('super_admin', null), '/admin');
  assert.equal(loginDestination('student', '/student/pass'), '/student/pass');
});

for (const templateKey of [
  'account_welcome',
  'application_received',
  'application_accepted',
  'application_waitlisted',
  'application_declined',
  'enrolment_suspended',
  'enrolment_reinstated',
] as const satisfies readonly EmailTemplateKey[]) {
  test(`${templateKey} default message includes the ASWJ sign-off`, () => {
    const rendered = renderTransactionalEmail(templateKey, PAYLOAD, APP_BASE_URL);
    assert.match(rendered.text, /Jazzakom Allahu Khaira\nASWJ College/);
  });
}
