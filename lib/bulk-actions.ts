export const MAX_BULK_ACTION_SIZE = 100;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeBulkIds(
  values: unknown,
  singularLabel: string,
  pluralLabel: string
) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`Select at least one ${singularLabel}.`);
  }

  if (values.length > MAX_BULK_ACTION_SIZE) {
    throw new Error(`You can update up to ${MAX_BULK_ACTION_SIZE} ${pluralLabel} at a time.`);
  }

  const normalized = values.map((value) => {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
      throw new Error(`One or more selected ${pluralLabel} are not valid.`);
    }
    return value.trim().toLowerCase();
  });

  return Array.from(new Set(normalized)).sort();
}

export function toDatabaseAttendanceStatus(
  status: unknown
) {
  if (status === 'absent') return 'absent_unexcused' as const;
  if (status === 'excused') return 'absent_excused' as const;
  if (
    status === 'present'
    || status === 'late'
    || status === 'absent_unexcused'
    || status === 'absent_excused'
  ) {
    return status;
  }
  throw new Error('Unsupported attendance status.');
}
