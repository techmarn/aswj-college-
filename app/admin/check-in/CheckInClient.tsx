'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { closeTodayRoll, setManualAttendance } from '../actions/checkin-actions';
import { formatClassTime } from '../../../lib/class-time';
import type { CheckInClass, CheckInStudent } from '../../../lib/attendance/check-in-data';

export type { CheckInClass, CheckInStudent } from '../../../lib/attendance/check-in-data';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function badge(status: string | null) {
  if (status === 'present') return 'green';
  if (status === 'late') return 'blue';
  if (status === 'absent' || status === 'absent_unexcused') return 'red';
  if (status === 'excused' || status === 'absent_excused') return 'grey';
  return 'amber';
}

function attendanceLabel(status: string | null) {
  if (status === 'absent_unexcused') return 'Absent';
  if (status === 'absent_excused') return 'Excused';
  if (!status) return 'Not marked';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function CheckInClient({
  classes,
  today,
  audience = 'admin',
}: {
  classes: CheckInClass[];
  today: string;
  audience?: 'admin' | 'teacher';
}) {
  const router = useRouter();
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const selected = useMemo(() => classes.find((c) => c.id === classId) ?? null, [classes, classId]);
  const selectedSchedule = selected
    ? [
        selected.dayOfWeek === null ? null : DAYS[selected.dayOfWeek],
        selected.startTime
          ? `${formatClassTime(selected.startTime)}${selected.endTime ? `–${formatClassTime(selected.endTime)}` : ''}`
          : null,
        selected.location || 'No location set',
      ].filter(Boolean).join(' · ')
    : '';

  const manualAttendance = (student: CheckInStudent, status: 'present'|'late'|'absent'|'excused') => {
    if (!selected) return;
    startTransition(async () => {
      try {
        await setManualAttendance(student.enrolmentId, selected.id, status);
        router.refresh();
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Attendance could not be saved.');
      }
    });
  };

  const closeRoll = () => {
    if (!selected || !window.confirm(
      'Close today’s roll? Every active student who is still unmarked will be recorded as an unexcused absence.'
    )) return;

    setError('');
    setMessage('');
    startTransition(async () => {
      try {
        const result = await closeTodayRoll(selected.id);
        setMessage(
          result.markedAbsent === 1
            ? 'Roll closed. 1 student was marked absent.'
            : `Roll closed. ${result.markedAbsent} students were marked absent.`
        );
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The roll could not be closed.');
      }
    });
  };

  return (
    <>
      <div className="topbar">
        <div>
          <span className="eyebrow">{audience === 'teacher' ? 'Teacher attendance' : 'Attendance'}</span>
          <h1>{audience === 'teacher' ? 'Class roster' : 'Attendance roster'}</h1>
          <p className="subtitle">Review the roll and record manual attendance — {today}.</p>
        </div>
        <a className="btn btn-primary" href="/scanner">Open scanner</a>
      </div>

      <section className="card">
        <div className="form-row">
          <div className="field">
            <label htmlFor="check-in-class">Select class</label>
            <select id="check-in-class" value={classId} onChange={(e) => { setClassId(e.target.value); setMessage(''); setError(''); }}>
              {classes.length === 0 && <option value="">No active classes</option>}
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            {selected && (
              <div className="small checkin-class-summary">
                {selectedSchedule}
                {' · '}{selected.students.filter((s) => s.attendanceStatus === 'present' || s.attendanceStatus === 'late').length}/{selected.students.filter((s) => s.enrolmentStatus === 'enrolled').length} checked in
              </div>
            )}
          </div>
        </div>

        {error && <div className="notice" role="alert">{error}</div>}
        {message && <div className="card" role="status" style={{ background: 'var(--brand-soft)', borderColor: 'var(--brand)', marginBottom: 16 }}><strong>{message}</strong></div>}

        {!selected ? (
          <div className="portal-empty checkin-empty">
            <strong>{audience === 'teacher' ? 'No classes scheduled today' : 'No active classes'}</strong>
            <span>
              {audience === 'teacher'
                ? 'Only active classes assigned to you and scheduled for today appear here.'
                : 'Create or reactivate a class before taking attendance.'}
            </span>
          </div>
        ) : selected.sessionCancelled ? (
          <div className="notice"><strong>Session cancelled</strong>Attendance cannot be recorded for this class today.</div>
        ) : null}
      </section>

      {selected && (
        <section className="section">
          <div className="section-head">
            <div><h2>Today’s roll</h2><div className="small">{selected.name}</div></div>
            {!selected.sessionCancelled && (
              <button className="btn btn-outline" disabled={pending} onClick={closeRoll}>
                Close roll
              </button>
            )}
          </div>
          <div className="table-wrap checkin-roll" role="region" aria-label="Today's class roll" tabIndex={0}>
            <table>
              <thead><tr><th>Student</th><th>Enrolment</th><th>Attendance</th><th>Manual action</th></tr></thead>
              <tbody>
                {selected.students.length === 0 ? (
                  <tr><td colSpan={4}><span className="small">No students are enrolled in this class.</span></td></tr>
                ) : selected.students.map((student) => (
                  <tr key={student.enrolmentId}>
                    <td data-label="Student"><strong>{student.name}</strong></td>
                    <td data-label="Enrolment"><span className={`badge ${student.enrolmentStatus === 'suspended' ? 'red' : 'green'}`}>{student.enrolmentStatus}</span></td>
                    <td data-label="Attendance"><span className={`badge ${badge(student.attendanceStatus)}`}>{attendanceLabel(student.attendanceStatus)}</span></td>
                    <td data-label="Manual action">
                      {student.enrolmentStatus === 'suspended' ? <span className="small">Suspended</span> : (
                        <div className="actions checkin-row-actions">
                          <button type="button" disabled={pending} className="btn btn-primary" onClick={() => manualAttendance(student,'present')}>Present</button>
                          <button type="button" disabled={pending} className="btn btn-secondary" onClick={() => manualAttendance(student,'late')}>Late</button>
                          <button type="button" disabled={pending} className="btn btn-outline" onClick={() => manualAttendance(student,'excused')}>Excused</button>
                          <button type="button" disabled={pending} className="btn btn-outline" onClick={() => manualAttendance(student,'absent')}>Absent</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
