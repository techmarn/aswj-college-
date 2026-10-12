const LOGIN_NEXT_PATHS = [
  '/student/apply',
  '/student/pass',
] as const;

export type LoginNextPath = (typeof LOGIN_NEXT_PATHS)[number];

export function safeLoginNext(value: unknown): LoginNextPath | null {
  if (typeof value !== 'string') return null;
  return (LOGIN_NEXT_PATHS as readonly string[]).includes(value)
    ? value as LoginNextPath
    : null;
}
