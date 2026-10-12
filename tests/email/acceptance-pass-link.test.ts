import assert from 'node:assert/strict';
import test from 'node:test';
import { safeLoginNext } from '../../lib/auth/login-next';
import { renderTransactionalEmail } from '../../lib/email/render';
import type {
  EmailTemplateDefinition,
  EmailTemplateKey,
} from '../../lib/email/templates';

const APP_BASE_URL = 'https://dev.aswj.example';
const PAYLOAD = {
  firstName: 'Test',
  className: 'Quran Foundations',
  classTerm: 'Term 4',
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
  'enrolment_reinstated',
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
    rendered.text,
    /Open Student Pass: https:\/\/dev\.aswj\.example\/student\/pass/
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
    assertNoWalletCredential(rendered.html);
    assertNoWalletCredential(rendered.text);
  });
}

test('post-login destinations use an exact allowlist', () => {
  assert.equal(safeLoginNext('/student/apply'), '/student/apply');
  assert.equal(safeLoginNext('/student/pass'), '/student/pass');
  assert.equal(safeLoginNext('https://attacker.example'), null);
  assert.equal(safeLoginNext('//attacker.example'), null);
  assert.equal(safeLoginNext('/api/student/wallet/google'), null);
  assert.equal(safeLoginNext('/student/pass?token=secret'), null);
});
