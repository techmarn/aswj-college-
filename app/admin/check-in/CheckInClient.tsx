'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { closeTodayRoll, setBulkManualAttendance, setManualAttendance } from '../actions/checkin-actions';
import { formatClassTime } from '../../../lib/class-time';
import type { CheckInClass, CheckInStudent } from '../../../lib/attendance/check-in-data';
import { MAX_BULK_ACTION_SIZE } from '../../../lib/bulk-actions';

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [pending, startTransition] = useTransition();
  const selectAllRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => classes.find((c) => c.id === classId) ?? null, [classes, classId]);
  const bulkEligible = useMemo(
    () => selected?.students.filter((student) => student.enrolmentStatus === 'enrolled') ?? [],
    [selected]
  );
  const selectedEligibleIds = useMemo(
    () => bulkEligible.filter((student) => selectedIds.has(student.enrolmentId)).map((student) => student.enrolmentId),
    [bulkEligible, selectedIds]
  );
  const allEligibleSelected = bulkEligible.length > 0
    && bulkEligible.every((student) => selectedIds.has(student.enrolmentId));
  const someEligibleSelected = selectedEligibleIds.length > 0 && !allEligibleSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someEligibleSelected;
  }, [someEligibleSelected]);

  useEffect(() => {
    const eligibleIds = new Set(bulkEligible.map((student) => student.enrolmentId));
    setSelectedIds((current) => {
      const next = new Set(Array.from(current).filter((id) => eligibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [bulkEligible]);

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
    setError('');
    setMessage('');
    startTransition(async () => {
      try {
        await setManualAttendance(student.enrolmentId, selected.id, status);
        router.refresh();
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Attendance could not be saved.');
      }
    });
  };

  const toggleStudent = (enrolmentId: string, checked: boolean) => {
    setError('');
    setMessage('');
    if (checked && !selectedIds.has(enrolmentId) && selectedIds.size >= MAX_BULK_ACTION_SIZE) {
      setError(`You can update up to ${MAX_BULK_ACTION_SIZE} students at a time.`);
      return;
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(enrolmentId);
      else next.delete(enrolmentId);
      if (checked && !current.has(enrolmentId) && current.size >= MAX_BULK_ACTION_SIZE) return current;
      return next;
    });
  };

  const toggleAllStudents = () => {
    setError('');
    setMessage('');
    if (allEligibleSelected) {
      setSelectedIds(new Set());
      return;
    }
    if (bulkEligible.length > MAX_BULK_ACTION_SIZE) {
      setError(
        `This roster has more than ${MAX_BULK_ACTION_SIZE} enrolled students. Choose up to ${MAX_BULK_ACTION_SIZE} individually.`
      );
      return;
    }
    setSelectedIds(new Set(bulkEligible.map((student) => student.enrolmentId)));
  };

  const bulkAttendance = (status: 'present'|'late'|'absent'|'excused') => {
    if (!selected || selected.sessionCancelled || pending || selectedEligibleIds.length === 0) return;
    const label = attendanceLabel(status);
    const noun = selectedEligibleIds.length === 1 ? 'student' : 'students';
    if (!window.confirm(
      `Mark ${selectedEligibleIds.length} selected ${noun} as ${label} for ${selected.name}? This will replace any existing attendance marks for today.`
    )) return;

    setError('');
    setMessage('');
    startTransition(async () => {
      try {
        const result = await setBulkManualAttendance(selectedEligibleIds, selected.id, status);
        setSelectedIds(new Set());
        setMessage(
          result.processed === 1
            ? `Attendance is set to ${label} for 1 selected student.`
            : `Attendance is set to ${label} for ${result.processed} selected students.`
        );
        router.refresh();
      } catch (err) {
        setError(
          `The result could not be confirmed. ${err instanceof Error ? err.message : 'Attendance could not be saved.'} The roster has been refreshed.`
        );
        router.refresh();
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
            <select
              id="check-in-class"
              value={classId}
              disabled={pending}
              onChange={(e) => {
                setClassId(e.target.value);
                setSelectedIds(new Set());
                setMessage('');
                setError('');
              }}
            >
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
          {!selected.sessionCancelled && (
            <div className="bulk-toolbar" aria-busy={pending}>
              <div>
                <label className="bulk-select-all">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allEligibleSelected}
                    disabled={
                      pending
                      || selected.sessionCancelled
                      || bulkEligible.length === 0
                      || bulkEligible.length > MAX_BULK_ACTION_SIZE
                    }
                    onChange={toggleAllStudents}
                  />
                  <span>
                    {bulkEligible.length > MAX_BULK_ACTION_SIZE
                      ? `Select all unavailable — choose up to ${MAX_BULK_ACTION_SIZE} students`
                      : 'Select all enrolled students'}
                  </span>
                </label>
                <strong>
                  {selectedEligibleIds.length === 0
                    ? 'Select students to update attendance'
                    : `${selectedEligibleIds.length} ${selectedEligibleIds.length === 1 ? 'student' : 'students'} selected`}
                </strong>
                <span>Choose one attendance status for every selected student.</span>
              </div>
              <div className="actions bulk-attendance-actions">
                <button type="button" className="btn btn-primary" disabled={pending || selectedEligibleIds.length === 0} onClick={() => bulkAttendance('present')}>Present</button>
                <button type="button" className="btn btn-secondary" disabled={pending || selectedEligibleIds.length === 0} onClick={() => bulkAttendance('late')}>Late</button>
                <button type="button" className="btn btn-outline" disabled={pending || selectedEligibleIds.length === 0} onClick={() => bulkAttendance('excused')}>Excused</button>
                <button type="button" className="btn btn-outline" disabled={pending || selectedEligibleIds.length === 0} onClick={() => bulkAttendance('absent')}>Absent</button>
              </div>
            </div>
          )}
          <div className="table-wrap checkin-roll" role="region" aria-label="Today's class roll" tabIndex={0}>
            <table>
              <thead><tr>
                <th className="bulk-select-column">Select</th>
                <th>Student</th><th>Enrolment</th><th>Attendance</th><th>Manual action</th>
              </tr></thead>
              <tbody>
                {selected.students.length === 0 ? (
                  <tr><td colSpan={5}><span className="small">No students are enrolled in this class.</span></td></tr>
                ) : selected.students.map((student) => (
                  <tr key={student.enrolmentId} className={selectedIds.has(student.enrolmentId) ? 'bulk-row-selected' : undefined}>
                    <td data-label="Select" className="bulk-select-column">
                      <label className="bulk-select-control">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(student.enrolmentId)}
                          disabled={
                            pending
                            || selected.sessionCancelled
                            || student.enrolmentStatus !== 'enrolled'
                            || (!selectedIds.has(student.enrolmentId) && selectedIds.size >= MAX_BULK_ACTION_SIZE)
                          }
                          onChange={(event) => toggleStudent(student.enrolmentId, event.target.checked)}
                        />
                        <span className="sr-only">Select {student.name}</span>
                      </label>
                    </td>
                    <td data-label="Student"><strong>{student.name}</strong></td>
                    <td data-label="Enrolment"><span className={`badge ${student.enrolmentStatus === 'suspended' ? 'red' : 'green'}`}>{student.enrolmentStatus}</span></td>
                    <td data-label="Attendance"><span className={`badge ${badge(student.attendanceStatus)}`}>{attendanceLabel(student.attendanceStatus)}</span></td>
                    <td data-label="Manual action">
                      {student.enrolmentStatus === 'suspended' ? <span className="small">Suspended</span> : (
                        <div className="actions checkin-row-actions">
                          <button type="button" disabled={pending || selected.sessionCancelled} className="btn btn-primary" onClick={() => manualAttendance(student,'present')}>Present</button>
                          <button type="button" disabled={pending || selected.sessionCancelled} className="btn btn-secondary" onClick={() => manualAttendance(student,'late')}>Late</button>
                          <button type="button" disabled={pending || selected.sessionCancelled} className="btn btn-outline" onClick={() => manualAttendance(student,'excused')}>Excused</button>
                          <button type="button" disabled={pending || selected.sessionCancelled} className="btn btn-outline" onClick={() => manualAttendance(student,'absent')}>Absent</button>
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
