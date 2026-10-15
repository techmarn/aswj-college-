import { formatClassTime } from '../class-time';

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/;

export type StudentCalendarClass = {
  id: string;
  name: string;
  term: string | null;
  location: string | null;
  startsOn: string | null;
  endsOn: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  effectiveAt: string;
};

export class ClassCalendarUnavailableError extends Error {}

function dateValue(dateKey: string) {
  if (!DATE_PATTERN.test(dateKey)) {
    throw new ClassCalendarUnavailableError('The class calendar date is invalid.');
  }
  const [year, month, day] = dateKey.split('-').map(Number);
  const value = Date.UTC(year, month - 1, day);
  const date = new Date(value);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new ClassCalendarUnavailableError('The class calendar date is invalid.');
  }
  return value;
}

function dateKey(value: number) {
  return new Date(value).toISOString().slice(0, 10);
}

function compactDate(value: string) {
  return value.replaceAll('-', '');
}

function compactTime(value: string) {
  if (!TIME_PATTERN.test(value)) {
    throw new ClassCalendarUnavailableError('The class calendar time is invalid.');
  }
  return `${value.slice(0, 2)}${value.slice(3, 5)}00`;
}

function timeMinutes(value: string) {
  if (!TIME_PATTERN.test(value)) {
    throw new ClassCalendarUnavailableError('The class calendar time is invalid.');
  }
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

function escapeText(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replace(/\r\n?|\n/g, '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;');
}

function foldLine(value: string) {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let segment = '';
  let continuation = false;

  for (const character of value) {
    const prefix = continuation ? ' ' : '';
    if (segment && encoder.encode(`${prefix}${segment}${character}`).byteLength > 75) {
      lines.push(`${prefix}${segment}`);
      segment = character;
      continuation = true;
    } else {
      segment += character;
    }
  }
  lines.push(`${continuation ? ' ' : ''}${segment}`);
  return lines.join('\r\n');
}

function cleanText(value: string, fallback: string, maximum = 200) {
  const cleaned = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || fallback).slice(0, maximum);
}

export function sydneyDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ClassCalendarUnavailableError('The enrolment date is invalid.');
  }
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function calendarClassSchedule(value: StudentCalendarClass) {
  return `${DAY_NAMES[value.dayOfWeek]}, ${formatClassTime(value.startTime)}–${
    formatClassTime(value.endTime)
  }`;
}

export function buildStudentClassCalendar(
  value: StudentCalendarClass,
  generatedAt = new Date()
) {
  if (!Number.isInteger(value.dayOfWeek) || value.dayOfWeek < 0 || value.dayOfWeek > 6) {
    throw new ClassCalendarUnavailableError('The class calendar day is invalid.');
  }
  if (timeMinutes(value.endTime) <= timeMinutes(value.startTime)) {
    throw new ClassCalendarUnavailableError('The class calendar time range is invalid.');
  }

  const effectiveOn = sydneyDateKey(value.effectiveAt);
  const baseOn = value.startsOn && value.startsOn > effectiveOn
    ? value.startsOn
    : effectiveOn;
  let firstValue = dateValue(baseOn);
  const dayOffset = (value.dayOfWeek - new Date(firstValue).getUTCDay() + 7) % 7;
  firstValue += dayOffset * 86_400_000;
  const firstOn = dateKey(firstValue);

  let count: number | null = null;
  if (value.endsOn) {
    const endValue = dateValue(value.endsOn);
    if (firstValue > endValue) {
      throw new ClassCalendarUnavailableError('The class has no remaining calendar dates.');
    }
    count = Math.floor((endValue - firstValue) / (7 * 86_400_000)) + 1;
  }

  const className = cleanText(value.name, 'ASWJ College class');
  const term = value.term ? cleanText(value.term, '', 100) : '';
  const summary = term ? `${className} — ${term}` : className;
  const timestamp = generatedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const rule = `FREQ=WEEKLY;BYDAY=${DAY_CODES[value.dayOfWeek]}${count ? `;COUNT=${count}` : ''}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ASWJ College//Student Class Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE',
    'TZID:Australia/Sydney',
    'X-LIC-LOCATION:Australia/Sydney',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+1000',
    'TZOFFSETTO:+1100',
    'TZNAME:AEDT',
    'DTSTART:19701004T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+1100',
    'TZOFFSETTO:+1000',
    'TZNAME:AEST',
    'DTSTART:19700405T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:aswj-class-${value.id.toLowerCase()}@aswjcollege.com.au`,
    `DTSTAMP:${timestamp}`,
    `DTSTART;TZID=Australia/Sydney:${compactDate(firstOn)}T${compactTime(value.startTime)}`,
    `DTEND;TZID=Australia/Sydney:${compactDate(firstOn)}T${compactTime(value.endTime)}`,
    `RRULE:${rule}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText('Weekly ASWJ College class. Check the Student Portal for current changes or cancellations.')}`,
    ...(value.location ? [`LOCATION:${escapeText(cleanText(value.location, '', 200))}`] : []),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
