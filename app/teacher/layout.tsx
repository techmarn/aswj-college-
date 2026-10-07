import Image from 'next/image';
import { redirect } from 'next/navigation';
import { requireAttendanceStaff } from '../../lib/supabase/server';
import { logout } from '../login/actions';

export const metadata = {
  title: 'Teacher Attendance | ASWJ College',
  description: 'Secure ASWJ College class attendance and QR check-in.',
};

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  let staff: Awaited<ReturnType<typeof requireAttendanceStaff>>;

  try {
    staff = await requireAttendanceStaff();
  } catch {
    redirect('/login?error=forbidden');
  }

  const name = `${staff.profile?.first_name ?? ''} ${staff.profile?.last_name ?? ''}`.trim()
    || staff.user.email
    || 'Teacher';

  return (
    <div className="teacher-portal">
      <header className="teacher-header">
        <a className="teacher-brand" href="/teacher/check-in" aria-label="ASWJ College teacher attendance home">
          <Image
            className="teacher-logo"
            src="/aswj-logo.png"
            alt="ASWJ Islamic College"
            width={360}
            height={225}
            priority
          />
          <span>
            <small>ASWJ College</small>
            <strong>Teacher attendance</strong>
          </span>
        </a>
        <div className="teacher-account">
          <div>
            <strong>{name}</strong>
            <span>{staff.role === 'teacher' ? 'Teacher' : 'Administrator'}</span>
          </div>
          <form action={logout}>
            <button className="btn teacher-signout" type="submit">Sign out</button>
          </form>
        </div>
      </header>
      <main className="teacher-main" id="main-content" tabIndex={-1}>{children}</main>
    </div>
  );
}
