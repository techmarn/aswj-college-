const LOGIN_NEXT_PATHS = [
  '/scanner',
  '/student/apply',
  '/student/pass',
] as const;

const CLASS_CALENDAR_PATH_PATTERN = /^\/student\/calendar\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LoginNextPath = (typeof LOGIN_NEXT_PATHS)[number]
  | `/student/calendar/${string}`;

export function safeLoginNext(value: unknown): LoginNextPath | null {
  if (typeof value !== 'string') return null;
  if ((LOGIN_NEXT_PATHS as readonly string[]).includes(value)) {
    return value as LoginNextPath;
  }
  return CLASS_CALENDAR_PATH_PATTERN.test(value)
    ? value.toLowerCase() as LoginNextPath
    : null;
}

export function loginDestination(role: string, nextPath: LoginNextPath | null) {
  if (
    nextPath === '/scanner'
    && ['teacher', 'admin', 'super_admin'].includes(role)
  ) {
    return nextPath;
  }
  if (['admin', 'super_admin'].includes(role)) return '/admin';
  if (role === 'teacher') return '/teacher/check-in';
  if (role === 'student' && nextPath && nextPath !== '/scanner') return nextPath;
  return '/student';
}
