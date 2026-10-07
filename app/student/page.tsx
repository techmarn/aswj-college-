import Image from 'next/image';
import QRCode from 'qrcode';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../../lib/supabase/server';
import { logout } from '../login/actions';
import {
  markAllPortalNotificationsRead,
  markPortalNotificationRead,
} from './actions';
import {
  loadStudentPortalData,
  PortalApplication,
  PortalAttendanceRecord,
  PortalEnrolment,
  PortalNotification,
} from './portal-data';
import { formatClassTime } from '../../lib/class-time';
import { getWalletAvailability } from '../../lib/wallet/config';
import PortalAutoRefresh from './PortalAutoRefresh';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function titleCase(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00+10:00`
    : value;
  return new Date(isoDate).toLocaleDateString('en-AU', {
    timeZone: 'Australia/Sydney',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function className(name: string, term: string | null) {
  return term ? `${name} — ${term}` : name;
}

function schedule(enrolment: PortalEnrolment) {
  const { dayOfWeek, startTime, endTime, location } = enrolment.classInfo;
  const time = startTime
    ? `${formatClassTime(startTime)}${endTime ? `–${formatClassTime(endTime)}` : ''}`
    : null;
  return [dayOfWeek === null ? null : DAYS[dayOfWeek], time, location]
    .filter(Boolean)
    .join(' · ');
}

function statusBadge(status: string) {
  if (['accepted', 'enrolled', 'present'].includes(status)) return 'green';
  if (['pending', 'warning', 'not_recorded'].includes(status)) return 'amber';
  if (['declined', 'suspended', 'absent_unexcused', 'review_required'].includes(status)) return 'red';
  if (['waitlisted', 'late'].includes(status)) return 'blue';
  return 'grey';
}

function applicationMessage(application: PortalApplication) {
  switch (application.status) {
    case 'pending':
      return 'Your application is waiting for an administrator to review it.';
    case 'accepted':
      return 'Your application was accepted. Your class enrolment appears below.';
    case 'waitlisted':
      return application.waitlistPosition
        ? `You are currently number ${application.waitlistPosition} on the waiting list.`
        : 'You are currently on the waiting list.';
    case 'declined':
      return 'A place was not offered for this application. Contact administration if you need help.';
    case 'withdrawn':
      return 'This application has been withdrawn.';
    default:
      return 'Contact administration if you need more information about this application.';
  }
}

function notificationCopy(notification: PortalNotification) {
  const classLabel = notification.className
    ? className(notification.className, notification.classTerm)
    : 'your class';

  switch (notification.templateKey) {
    case 'application_accepted':
      return {
        title: 'Application accepted',
        body: `Your application for ${classLabel} has been accepted.`,
      };
    case 'application_waitlisted':
      return {
        title: 'Application waitlisted',
        body: notification.waitlistPosition
          ? `You are number ${notification.waitlistPosition} on the waiting list for ${classLabel}.`
          : `You have been placed on the waiting list for ${classLabel}.`,
      };
    case 'application_declined':
      return {
        title: 'Application update',
        body: `A place was not offered for ${classLabel}. Contact administration if you need help.`,
      };
    case 'attendance_warning':
      return {
        title: 'Attendance warning',
        body: `Your consecutive unexcused absences in ${classLabel} are approaching the review threshold.`,
      };
    case 'attendance_review_required':
      return {
        title: 'Attendance review required',
        body: `Your attendance in ${classLabel} requires an administrator review. Suspension is not automatic.`,
      };
    case 'attendance_excused':
      return {
        title: 'Absence excused',
        body: `An absence in ${classLabel} has been marked as excused.`,
      };
    case 'attendance_review_resolved':
      return {
        title: 'Attendance review resolved',
        body: `Administration has completed the attendance review for ${classLabel} and kept your enrolment active.`,
      };
    case 'enrolment_suspended':
      return {
        title: 'Enrolment suspended',
        body: `Your enrolment in ${classLabel} has been suspended. Other class enrolments are not affected.`,
      };
    case 'enrolment_reinstated':
      return {
        title: 'Enrolment reinstated',
        body: `Your enrolment in ${classLabel} is active again.`,
      };
    default:
      return {
        title: 'College update',
        body: 'There is a new update in your ASWJ College student record.',
      };
  }
}

function attendanceLabel(record: PortalAttendanceRecord) {
  switch (record.status) {
    case 'present': return 'Present';
    case 'late': return 'Late';
    case 'absent_excused': return 'Excused absence';
    case 'absent_unexcused': return 'Unexcused absence';
    case 'cancelled': return 'Session cancelled';
    case 'not_recorded': return 'Awaiting attendance';
    default: return titleCase(record.status);
  }
}

function AttendanceStanding({ enrolment }: { enrolment: PortalEnrolment }) {
  if (enrolment.reviewState === 'suspended') {
    return (
      <div className="portal-alert danger">
        <strong>This class enrolment is suspended.</strong>
        {enrolment.suspensionReason && <span>{enrolment.suspensionReason}</span>}
      </div>
    );
  }
  if (enrolment.reviewState === 'review_required') {
    return (
      <div className="portal-alert danger">
        <strong>Attendance review required</strong>
        <span>
          {enrolment.consecutiveAbsences} consecutive unexcused absences have reached
          the class threshold of {enrolment.absenceThreshold}. Administration will
          review this enrolment; suspension is not automatic.
        </span>
      </div>
    );
  }
  if (enrolment.reviewState === 'warning') {
    return (
      <div className="portal-alert warning">
        <strong>Attendance warning</strong>
        <span>
          You have {enrolment.consecutiveAbsences} consecutive unexcused
          {enrolment.consecutiveAbsences === 1 ? ' absence' : ' absences'}.
          The review threshold for this class is {enrolment.absenceThreshold}.
        </span>
      </div>
    );
  }
  if (enrolment.status !== 'enrolled') return null;
  return (
    <div className="portal-alert success">
      <strong>Attendance standing is clear</strong>
      <span>No consecutive-absence warning is active for this class.</span>
    </div>
  );
}

export default async function StudentPortal({
  searchParams,
}: {
  searchParams: Promise<{
    applied?: string | string[];
    already?: string | string[];
    wallet?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const applied = (Array.isArray(params.applied) ? params.applied[0] : params.applied) === '1';
  const already = (Array.isArray(params.already) ? params.already[0] : params.already) === '1';
  const walletStatus = Array.isArray(params.wallet) ? params.wallet[0] : params.wallet;
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login');

  const data = await loadStudentPortalData(supabase, user.id);
  const qrValue = data.qrToken ? `aswj:${data.qrToken}` : null;
  const qrImage = qrValue
    ? await QRCode.toDataURL(qrValue, {
        width: 320,
        margin: 2,
        errorCorrectionLevel: 'M',
      })
    : null;
  const name = `${data.profile?.firstName ?? ''} ${data.profile?.lastName ?? ''}`.trim() || 'Student';
  const walletAvailability = getWalletAvailability();
  const activeEnrolments = data.enrolments.filter((enrolment) => enrolment.status === 'enrolled');
  const walletEligible = Boolean(qrImage && activeEnrolments.length);
  const unread = data.unreadNotificationCount;
  const currentEnrolments = data.enrolments.filter((enrolment) =>
    ['enrolled', 'suspended'].includes(enrolment.status)
  ).length;
  const openApplications = data.applications.filter((application) =>
    ['pending', 'waitlisted'].includes(application.status)
  ).length;

  return (
    <main id="main-content" className="student-portal" tabIndex={-1}>
      <PortalAutoRefresh />
      <header className="student-header">
        <div className="student-brand-row">
          <Image
            className="student-logo"
            src="/aswj-logo.png"
            alt="ASWJ Islamic College"
            width={360}
            height={225}
            priority
          />
          <div>
            <div className="student-eyebrow">ASWJ College Student Portal</div>
            <h1>Assalamu alaikum, {name}</h1>
            <p>{user.email}</p>
          </div>
        </div>
        <form action={logout}>
          <button className="btn student-signout" type="submit">Sign out</button>
        </form>
      </header>

      {applied && (
        <div className="portal-alert success" role="status">
          <strong>Application submitted</strong>
          <span>Your application is pending and will be reviewed by ASWJ College administration.</span>
        </div>
      )}
      {already && (
        <div className="portal-alert warning" role="status">
          <strong>Application already received</strong>
          <span>Your existing application has not been changed. Its current status appears below.</span>
        </div>
      )}

      {walletStatus === 'not_eligible' && (
        <div className="portal-alert warning" role="status">
          <strong>Your wallet pass is not ready yet.</strong>
          <span>A pass becomes available after you have an active class enrolment and student QR.</span>
        </div>
      )}
      {['apple_setup', 'google_setup'].includes(walletStatus ?? '') && (
        <div className="portal-alert warning" role="status">
          <strong>This wallet option is still being set up.</strong>
          <span>Your enrolment and student QR have not been changed. Please try again after administration completes the setup.</span>
        </div>
      )}
      {['apple_failed', 'google_failed'].includes(walletStatus ?? '') && (
        <div className="portal-alert danger" role="alert">
          <strong>Your wallet pass could not be created.</strong>
          <span>Your enrolment and student QR have not been changed. Please try again or contact ASWJ College administration.</span>
        </div>
      )}

      <section className="portal-overview" aria-label="Student portal summary">
        <div className="card portal-metric">
          <span className="small">Applications</span>
          <strong>{data.applications.length}</strong>
          <span>{openApplications} awaiting an outcome</span>
        </div>
        <div className="card portal-metric">
          <span className="small">Current classes</span>
          <strong>{currentEnrolments}</strong>
          <span>Enrolled or under review</span>
        </div>
        <div className="card portal-metric" aria-live="polite" aria-atomic="true">
          <span className="small">Unread updates</span>
          <strong>{unread}</strong>
          <span>{data.notifications.length} recent notifications</span>
        </div>
      </section>

      <section className="portal-section card">
        <div className="portal-section-head">
          <div>
            <span className="small">Latest updates</span>
            <h2>Notifications</h2>
          </div>
          {unread > 0 && (
            <form action={markAllPortalNotificationsRead}>
              <button className="btn btn-outline" type="submit">Mark all as read</button>
            </form>
          )}
        </div>

        {data.notifications.length ? (
          <div className="notification-list">
            {data.notifications.map((notification) => {
              const copy = notificationCopy(notification);
              return (
                <article
                  className={`notification-item ${notification.readAt ? '' : 'unread'}`}
                  key={notification.id}
                >
                  <span className="notification-dot" aria-hidden="true" />
                  <div className="notification-copy">
                    <div className="notification-title-row">
                      <strong>{copy.title}</strong>
                      <time dateTime={notification.createdAt}>{formatDate(notification.createdAt)}</time>
                    </div>
                    <p>{copy.body}</p>
                  </div>
                  {!notification.readAt && (
                    <form action={markPortalNotificationRead.bind(null, notification.id)}>
                      <button className="btn btn-secondary" type="submit">Mark read</button>
                    </form>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="portal-empty">
            <strong>No notifications yet</strong>
            <span>Application and attendance updates will appear here.</span>
          </div>
        )}
      </section>

      <section className="portal-section">
        <div className="portal-section-head">
          <div>
            <span className="small">Registration workflow</span>
            <h2>Applications</h2>
          </div>
          <a className="btn btn-primary" href="/student/apply">Apply for a class</a>
        </div>

        {data.applications.length ? (
          <div className="application-grid">
            {data.applications.map((application) => (
              <article className="card application-card" key={application.id}>
                <div className="application-card-head">
                  <div>
                    <h3>{className(application.classInfo.name, application.classInfo.term)}</h3>
                    <span className="small">Submitted {formatDate(application.submittedAt)}</span>
                  </div>
                  <span className={`badge ${statusBadge(application.status)}`}>
                    {titleCase(application.status)}
                    {application.status === 'waitlisted' && application.waitlistPosition
                      ? ` #${application.waitlistPosition}`
                      : ''}
                  </span>
                </div>
                <p>{applicationMessage(application)}</p>
                {application.reviewedAt && (
                  <span className="small">Last reviewed {formatDate(application.reviewedAt)}</span>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="card portal-empty">
            <strong>No applications are linked to this account.</strong>
            <span>Choose an available class to begin an application.</span>
            <a className="btn btn-primary" href="/student/apply">Apply for a class</a>
          </div>
        )}
      </section>

      <section className="portal-section">
        <div className="portal-section-head">
          <div>
            <span className="small">Per-class status</span>
            <h2>Classes &amp; attendance</h2>
          </div>
        </div>

        {data.enrolments.length ? (
          <div className="enrolment-list">
            {data.enrolments.map((enrolment) => (
              <article className="card enrolment-card" key={enrolment.id}>
                <div className="enrolment-head">
                  <div>
                    <h3>{className(enrolment.classInfo.name, enrolment.classInfo.term)}</h3>
                    {schedule(enrolment) && <p className="small">{schedule(enrolment)}</p>}
                  </div>
                  <span className={`badge ${statusBadge(enrolment.status)}`}>
                    {titleCase(enrolment.status)}
                  </span>
                </div>

                <AttendanceStanding enrolment={enrolment} />

                <div className="attendance-layout">
                  <div className="attendance-stats">
                    <div className="attendance-rate">
                      <span className="small">Attendance rate</span>
                      <strong>{enrolment.attendanceRate === null ? '—' : `${enrolment.attendanceRate}%`}</strong>
                      <span>{enrolment.attendedSessions} of {enrolment.totalSessions} attended</span>
                    </div>
                    <dl>
                      <div><dt>Present</dt><dd>{enrolment.attendedSessions - enrolment.lateSessions}</dd></div>
                      <div><dt>Late</dt><dd>{enrolment.lateSessions}</dd></div>
                      <div><dt>Excused</dt><dd>{enrolment.excusedAbsences}</dd></div>
                      <div><dt>Unexcused</dt><dd>{enrolment.unexcusedAbsences}</dd></div>
                    </dl>
                  </div>

                  <div className="attendance-history">
                    <h4>Recent sessions</h4>
                    {enrolment.recentAttendance.length ? (
                      <ul>
                        {enrolment.recentAttendance.map((record) => (
                          <li key={record.sessionId}>
                            <time dateTime={record.sessionDate}>{formatDate(record.sessionDate)}</time>
                            <span className={`badge ${statusBadge(record.status)}`}>
                              {attendanceLabel(record)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="small">No completed class sessions are recorded yet.</p>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="card portal-empty">
            <strong>No class enrolments yet.</strong>
            <span>Your classes will appear here after an application is accepted.</span>
          </div>
        )}
      </section>

      <section id="student-pass" className="portal-section card student-pass-card">
        <div className="student-pass-heading">
          <div>
            <span className="small">Class check-in</span>
            <h2>Your student pass</h2>
          </div>
          <span className={`badge ${walletEligible ? 'green' : 'amber'}`}>
            {walletEligible ? 'Ready' : 'Pending'}
          </span>
        </div>

        <div className="student-pass-grid">
          <div className="student-pass-details">
            <p>
              Add this pass to your phone or present the QR code below. The code contains
              a private random token, not your personal details.
            </p>

            {activeEnrolments.length > 0 && (
              <div className="student-pass-classes">
                <span className="small">Active {activeEnrolments.length === 1 ? 'class' : 'classes'}</span>
                <ul>
                  {activeEnrolments.map((enrolment) => (
                    <li key={enrolment.id}>
                      <strong>{className(enrolment.classInfo.name, enrolment.classInfo.term)}</strong>
                      {schedule(enrolment) && <span>{schedule(enrolment)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {walletEligible ? (
              <>
                <div className="wallet-actions" aria-label="Add student pass to a mobile wallet">
                  {walletAvailability.apple && (
                    <a className="apple-wallet-badge-link" href="/api/student/wallet/apple">
                      <img
                        className="apple-wallet-badge"
                        src="/wallet/add-to-apple-wallet.svg"
                        alt="Add to Apple Wallet"
                        width="160"
                        height="50"
                      />
                    </a>
                  )}
                  {walletAvailability.google && (
                    <a className="google-wallet-link" href="/api/student/wallet/google">
                      <img
                        className="google-wallet-badge"
                        src="/wallet/add-to-google-wallet.svg"
                        alt="Add to Google Wallet"
                        width="283"
                        height="50"
                      />
                    </a>
                  )}
                </div>
                {!walletAvailability.apple && !walletAvailability.google && (
                  <div className="portal-alert warning">
                    <strong>Mobile wallet setup is still being completed.</strong>
                    <span>You can use the student QR below for check-in in the meantime.</span>
                  </div>
                )}
              </>
            ) : (
              <div className="portal-alert warning">
                <strong>Your mobile wallet pass is not available yet.</strong>
                <span>It will become available after your application is accepted and your class enrolment is active.</span>
              </div>
            )}
          </div>

          <div className="student-pass-qr">
            {qrImage ? (
              <img src={qrImage} alt="Student check-in QR code" />
            ) : (
              <div className="portal-alert warning">
                <strong>Your QR code could not be issued yet.</strong>
                <span>Contact ASWJ College administration for help.</span>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
