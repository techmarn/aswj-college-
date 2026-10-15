import 'server-only';

import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import TransactionalEmail from '../../emails/TransactionalEmail';
import { formatClassTime } from '../class-time';
import {
  studentClassCalendarUrl,
  studentPassUrl,
  studentPortalUrl,
} from './config';
import {
  DEFAULT_EMAIL_TEMPLATES,
  emailTemplateParagraphs,
  interpolateEmailTemplate,
  type EmailTemplateDefinition,
  type EmailTemplateKey,
  type EmailTemplateValues,
} from './templates';

export { isEmailTemplateKey, type EmailTemplateKey } from './templates';

// Next.js reserves direct react-dom/server imports for its component renderer.
// This queue is an explicitly Node-only operational renderer, so load React's
// existing Node renderer without adding a second email-rendering dependency.
const nodeRequire = createRequire(import.meta.url);
const { renderToStaticMarkup } = nodeRequire(
  'react-dom/server'
) as typeof import('react-dom/server');

export type EmailTemplatePayload = {
  firstName: string;
  className: string;
  classTerm: string | null;
  classId: string | null;
  classDayOfWeek: number | null;
  classStartTime: string | null;
  classEndTime: string | null;
  waitlistPosition: number | null;
};

export type RenderedEmail = {
  templateVersion: string;
  subject: string;
  html: string;
  text: string;
};

function cleanText(value: unknown, fallback: string, maxLength = 200) {
  if (typeof value !== 'string') return fallback;
  const cleaned = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, maxLength) : fallback;
}

function nullableText(value: unknown, maxLength = 200) {
  const cleaned = cleanText(value, '', maxLength);
  return cleaned || null;
}

function integerOrNull(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

const CLASS_DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLASS_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/;

function classIdOrNull(value: unknown) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return UUID_PATTERN.test(cleaned) ? cleaned.toLowerCase() : null;
}

function classDayOrNull(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 6 ? parsed : null;
}

function classTimeOrNull(value: unknown) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return CLASS_TIME_PATTERN.test(cleaned) ? cleaned : null;
}

function hasCompleteClassSchedule(payload: EmailTemplatePayload) {
  return Boolean(
    payload.classId
    && payload.classDayOfWeek !== null
    && payload.classStartTime
    && payload.classEndTime
  );
}

function valueFrom(payload: Record<string, unknown>, camel: string, snake: string) {
  return payload[camel] ?? payload[snake];
}

export function normalizeEmailTemplatePayload(payload: unknown): EmailTemplatePayload {
  const data = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};

  return {
    firstName: cleanText(valueFrom(data, 'firstName', 'first_name'), 'Student', 100),
    className: cleanText(valueFrom(data, 'className', 'class_name'), 'your class', 200),
    classTerm: nullableText(valueFrom(data, 'classTerm', 'class_term'), 100),
    classId: classIdOrNull(valueFrom(data, 'classId', 'class_id')),
    classDayOfWeek: classDayOrNull(
      valueFrom(data, 'classDayOfWeek', 'class_day_of_week')
    ),
    classStartTime: classTimeOrNull(
      valueFrom(data, 'classStartTime', 'class_start_time')
    ),
    classEndTime: classTimeOrNull(
      valueFrom(data, 'classEndTime', 'class_end_time')
    ),
    waitlistPosition: integerOrNull(
      valueFrom(data, 'waitlistPosition', 'waitlist_position')
    ),
  };
}

function classLabel(payload: EmailTemplatePayload) {
  return payload.classTerm
    ? `${payload.className} — ${payload.classTerm}`
    : payload.className;
}

function templateValues(
  payload: EmailTemplatePayload,
  portalUrl: string
): EmailTemplateValues {
  const label = classLabel(payload);
  const waitlistPosition = payload.waitlistPosition?.toString() ?? '';
  const classDay = payload.classDayOfWeek === null
    ? ''
    : CLASS_DAYS[payload.classDayOfWeek];
  const classTime = payload.classStartTime
    ? `${formatClassTime(payload.classStartTime)}${
      payload.classEndTime ? `–${formatClassTime(payload.classEndTime)}` : ''
    }`
    : '';
  const classSchedule = [classDay, classTime].filter(Boolean).join(', ')
    || 'Schedule to be confirmed';
  return {
    first_name: payload.firstName,
    class_name: payload.className,
    class_term: payload.classTerm ?? '',
    class_label: label,
    class_day: classDay || 'Day to be confirmed',
    class_time: classTime || 'Time to be confirmed',
    class_schedule: classSchedule,
    class_calendar_guidance: hasCompleteClassSchedule(payload)
      ? 'Use Add class to calendar below to save the schedule.'
      : 'The calendar link will be available once the complete schedule is confirmed.',
    waitlist_position: waitlistPosition,
    waitlist_position_text: waitlistPosition
      ? ` Your position at the time of this update is ${waitlistPosition}.`
      : '',
    student_portal_url: portalUrl,
  };
}

function usableDefinition(
  templateKey: EmailTemplateKey,
  definition?: EmailTemplateDefinition
) {
  if (definition?.templateKey === templateKey) return definition;
  return DEFAULT_EMAIL_TEMPLATES[templateKey];
}

function assertRenderedText(
  value: string,
  maximum: number,
  allowNewlines = false
) {
  const forbidden = allowNewlines
    ? /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/
    : /[\u0000-\u001F\u007F]/;
  if (!value.trim() || value.length > maximum || forbidden.test(value)) {
    throw new Error('The email template rendered invalid content.');
  }
}

export function renderTransactionalEmail(
  templateKey: EmailTemplateKey,
  rawPayload: unknown,
  appBaseUrl: string,
  suppliedDefinition?: EmailTemplateDefinition
): RenderedEmail {
  const definition = usableDefinition(templateKey, suppliedDefinition);
  const payload = normalizeEmailTemplatePayload(rawPayload);
  const portalUrl = studentPortalUrl(appBaseUrl);
  const isActiveEnrolmentMessage = templateKey === 'application_accepted'
    || templateKey === 'enrolment_reinstated';
  const useStudentPassAction = templateKey === 'application_accepted'
    || (templateKey === 'enrolment_reinstated' && Boolean(payload.classId));
  const actionUrl = useStudentPassAction
    ? studentPassUrl(appBaseUrl)
    : portalUrl;
  const hasCompleteSchedule = hasCompleteClassSchedule(payload);
  const secondaryActions = isActiveEnrolmentMessage && hasCompleteSchedule
    ? [{
      label: 'Add class to calendar',
      url: studentClassCalendarUrl(appBaseUrl, payload.classId!),
    }]
    : [];
  const values = templateValues(payload, portalUrl);
  const subject = interpolateEmailTemplate(definition.subjectTemplate, values);
  const preview = interpolateEmailTemplate(definition.previewTemplate, values);
  const heading = interpolateEmailTemplate(definition.headingTemplate, values);
  const body = interpolateEmailTemplate(definition.bodyTemplate, values);
  const configuredButtonLabel = interpolateEmailTemplate(definition.buttonLabel, values);
  const buttonLabel = templateKey === 'enrolment_reinstated' && !useStudentPassAction
    ? 'Open Student Portal'
    : configuredButtonLabel;
  assertRenderedText(subject, 500);
  assertRenderedText(preview, 1000);
  assertRenderedText(heading, 1000);
  assertRenderedText(body, 40_000, true);
  assertRenderedText(buttonLabel, 200);
  const paragraphs = emailTemplateParagraphs(body);
  const html = '<!doctype html>' + renderToStaticMarkup(
    <TransactionalEmail
      preview={preview}
      heading={heading}
      actionUrl={actionUrl}
      buttonLabel={buttonLabel}
      secondaryActions={secondaryActions}
    >
      {paragraphs.map((paragraph, index) => createElement(
        'p',
        { key: index, style: { margin: '0 0 16px', whiteSpace: 'pre-line' } },
        paragraph
      ))}
    </TransactionalEmail>
  );
  const actionText = [
    `${buttonLabel}: ${actionUrl}`,
    ...secondaryActions.map((action) => `${action.label}: ${action.url}`),
  ].join('\n');
  const text = `${body}\n\n${actionText}\n\nThis is an operational message about your ASWJ College record.`;
  if (Buffer.byteLength(html, 'utf8') > 200_000 || Buffer.byteLength(text, 'utf8') > 50_000) {
    throw new Error('The rendered email exceeded the delivery size limit.');
  }

  return {
    templateVersion: definition.version,
    subject,
    html,
    text,
  };
}
