import Image from 'next/image';
import { redirect } from 'next/navigation';
import { requireAttendanceStaff } from '../../lib/supabase/server';
import { logout } from '../login/actions';

export const metadata = {
  title: 'Class Check-in Scanner | ASWJ College',
  description: 'Secure ASWJ College student QR check-in scanner.',
};

export default async function ScannerLayout({ children }: { children: React.ReactNode }) {
  let staff: Awaited<ReturnType<typeof requireAttendanceStaff>>;

  try {
    staff = await requireAttendanceStaff();
  } catch (error) {
    if (error instanceof Error && error.message === 'Authentication required.') {
      redirect('/login?next=%2Fscanner');
    }
    redirect('/login?error=forbidden');
  }

  const name = `${staff.profile?.first_name ?? ''} ${staff.profile?.last_name ?? ''}`.trim()
    || staff.user.email
    || 'Attendance staff';
  const rosterHref = staff.role === 'teacher' ? '/teacher/check-in' : '/admin/check-in';

  return (
    <div className="teacher-portal">
      <header className="teacher-header">
        <a className="teacher-brand" href="/scanner" aria-label="ASWJ College check-in scanner home">
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
            <strong>Check-in scanner</strong>
          </span>
        </a>
        <div className="teacher-account">
          <div className="teacher-account-identity">
            <strong>{name}</strong>
            <span>{staff.role === 'teacher' ? 'Teacher' : 'Administrator'}</span>
          </div>
          <div className="teacher-account-actions">
            <a className="btn teacher-header-link" href={rosterHref}>Roster</a>
            <form action={logout}>
              <button className="btn teacher-signout" type="submit">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="teacher-main" id="main-content" tabIndex={-1}>{children}</main>
    </div>
  );
}
