export const EMAIL_TEMPLATE_KEYS = [
  'account_welcome',
  'application_received',
  'application_accepted',
  'application_waitlisted',
  'application_declined',
  'enrolment_suspended',
  'enrolment_reinstated',
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export const EMAIL_TEMPLATE_VARIABLES = [
  'first_name',
  'class_name',
  'class_term',
  'class_label',
  'class_day',
  'class_time',
  'class_schedule',
  'class_calendar_guidance',
  'waitlist_position',
  'waitlist_position_text',
  'student_portal_url',
] as const;

export type EmailTemplateVariable = (typeof EMAIL_TEMPLATE_VARIABLES)[number];

export type EmailTemplateDefinition = {
  templateKey: EmailTemplateKey;
  version: string;
  subjectTemplate: string;
  previewTemplate: string;
  headingTemplate: string;
  bodyTemplate: string;
  buttonLabel: string;
};

export type EmailTemplateDraft = Omit<
  EmailTemplateDefinition,
  'templateKey' | 'version'
>;

export type EmailTemplateValues = Record<EmailTemplateVariable, string>;

export const DEFAULT_EMAIL_TEMPLATES: Record<EmailTemplateKey, EmailTemplateDefinition> = {
  account_welcome: {
    templateKey: 'account_welcome',
    version: 'code:2',
    subjectTemplate: 'Welcome to ASWJ College',
    previewTemplate: 'Your ASWJ College student account is ready.',
    headingTemplate: 'Welcome to ASWJ College',
    bodyTemplate: 'Assalamu alaikum {{first_name}},\n\nYour email address has been confirmed and your ASWJ College student account is ready.\n\nYou can now sign in, apply for available classes and view your application updates in the Student Portal.\n\nJazzakom Allahu Khaira\nASWJ College',
    buttonLabel: 'Open Student Portal',
  },
  application_received: {
    templateKey: 'application_received',
    version: 'code:2',
    subjectTemplate: 'We received your ASWJ College application',
    previewTemplate: 'Your application for {{class_label}} is awaiting review.',
    headingTemplate: 'Application received',
    bodyTemplate: 'Assalamu alaikum {{first_name}},\n\nWe have received and are processing your application for {{class_label}}. You will receive further instructions shortly Inn Shaa Allah.\n\nJazzakom Allahu Khaira\nASWJ College',
    buttonLabel: 'Open Student Portal',
  },
  application_accepted: {
    templateKey: 'application_accepted',
    version: 'code:3',
    subjectTemplate: 'Your ASWJ College application was accepted',
    previewTemplate: 'Your application for {{class_label}} has been accepted.',
    headingTemplate: 'Application accepted',
    bodyTemplate: 'Assalamu alaikum {{first_name}},\n\nYour application for {{class_label}} has been accepted.\n\nClass day and time: {{class_schedule}}.\n\n{{class_calendar_guidance}}\n\nOn an iPhone, select Open Student Pass below, sign in, then select Add to Apple Wallet.\n\nJazzakom Allahu Khaira\nASWJ College',
    buttonLabel: 'Open Student Pass',
  },
  application_waitlisted: {
    templateKey: 'application_waitlisted',
    version: 'code:2',
    subjectTemplate: 'Your ASWJ College application is on the waiting list',
    previewTemplate: 'You have been placed on the waiting list for {{class_label}}.',
    headingTemplate: 'Waiting list update',
    bodyTemplate: 'Assalamu alaikum {{first_name}},\n\nYou have been placed on the waiting list for {{class_label}}.{{waitlist_position_text}}\n\nThe Student Portal will show your latest application status.\n\nJazzakom Allahu Khaira\nASWJ College',
    buttonLabel: 'Open Student Portal',
  },
  application_declined: {
    templateKey: 'application_declined',
    version: 'code:2',
    subjectTemplate: 'Update on your ASWJ College application',
    previewTemplate: 'A place was not offered for {{class_label}}.',
    headingTemplate: 'Application update',
    bodyTemplate: 'Assalamu alaikum {{first_name}},\n\nA place was not offered for your application to {{class_label}}.\n\nIf you need more information, reply to this email to contact administration.\n\nJazzakom Allahu Khaira\nASWJ College',
    buttonLabel: 'Open Student Portal',
  },
  enrolment_suspended: {
    templateKey: 'enrolment_suspended',
    version: 'code:2',
    subjectTemplate: 'Your ASWJ College enrolment was suspended',
    previewTemplate: 'Your enrolment in {{class_label}} has been suspended.',
    headingTemplate: 'Enrolment suspended',
    bodyTemplate: 'Assalamu alaikum {{first_name}},\n\nYour enrolment in {{class_label}} has been suspended.\n\nSign in to the Student Portal for your current enrolment status, or reply to this email to contact administration.\n\nJazzakom Allahu Khaira\nASWJ College',
    buttonLabel: 'Open Student Portal',
  },
  enrolment_reinstated: {
    templateKey: 'enrolment_reinstated',
    version: 'code:2',
    subjectTemplate: 'Your ASWJ College enrolment is active again',
    previewTemplate: 'Your enrolment in {{class_label}} has been reinstated.',
    headingTemplate: 'Enrolment reinstated',
    bodyTemplate: 'Assalamu alaikum {{first_name}},\n\nYour enrolment in {{class_label}} has been reinstated and is active again.\n\nClass day and time: {{class_schedule}}.\n\n{{class_calendar_guidance}}\n\nOn an iPhone, select Open Student Pass below, sign in, then select Add to Apple Wallet. You can re-add the pass if needed.\n\nJazzakom Allahu Khaira\nASWJ College',
    buttonLabel: 'Open Student Pass',
  },
};

export function isEmailTemplateKey(value: unknown): value is EmailTemplateKey {
  return typeof value === 'string'
    && (EMAIL_TEMPLATE_KEYS as readonly string[]).includes(value);
}

export function variableToken(variable: string) {
  return `{{${variable}}}`;
}

export function interpolateEmailTemplate(
  template: string,
  values: Partial<EmailTemplateValues>
) {
  return template.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (_match, variable: string) => (
    values[variable as EmailTemplateVariable] ?? ''
  ));
}

export function emailTemplateParagraphs(value: string) {
  return value
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}
