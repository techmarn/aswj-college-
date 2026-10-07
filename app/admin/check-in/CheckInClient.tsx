'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { checkInByQr, closeTodayRoll, setManualAttendance } from '../actions/checkin-actions';
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
  const [scannerOn, setScannerOn] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLock = useRef(false);
  const lastScan = useRef<{ token: string; at: number } | null>(null);

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

  const stopScanner = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScannerOn(false);
    scanLock.current = false;
    lastScan.current = null;
  };

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const processToken = (raw: string) => {
    if (!classId || pending || scanLock.current) return;
    const normalizedToken = raw.trim();
    const previous = lastScan.current;
    if (previous?.token === normalizedToken && Date.now() - previous.at < 8_000) return;

    scanLock.current = true;
    lastScan.current = { token: normalizedToken, at: Date.now() };
    setError('');
    setMessage('');

    startTransition(async () => {
      try {
        const result = await checkInByQr(classId, normalizedToken);
        setMessage(
          result.alreadyCheckedIn
            ? `${result.name} already has attendance recorded as ${attendanceLabel(result.status)}. The original record was kept.`
            : `${result.name} checked in successfully.`
        );
        setManualToken('');
        router.refresh();
        window.setTimeout(() => { scanLock.current = false; }, 1400);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The QR code could not be processed.');
        window.setTimeout(() => { scanLock.current = false; }, 1800);
      }
    });
  };

  const startScanner = async () => {
    setError('');
    setMessage('');

    try {
      const Detector = (window as any).BarcodeDetector;
      if (!Detector) {
        setError('This browser does not provide built-in QR scanning. Use the manual token box below or open this page in Chrome/Edge on a supported device.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });

      streamRef.current = stream;
      setScannerOn(true);

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();

      const detector = new Detector({ formats: ['qr_code'] });

      const scan = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          const value = codes?.[0]?.rawValue;
          if (value && !scanLock.current) processToken(value);
        } catch {}
        if (streamRef.current) requestAnimationFrame(scan);
      };

      requestAnimationFrame(scan);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Camera access could not be started.');
      stopScanner();
    }
  };

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
          <h1>{audience === 'teacher' ? 'Class check-in' : 'QR Check-in'}</h1>
          <p className="subtitle">Scan student QR codes and manage today’s attendance — {today}.</p>
        </div>
      </div>

      <section className="card">
        <div className="form-row">
          <div className="field">
            <label htmlFor="check-in-class">Select class</label>
            <select id="check-in-class" value={classId} onChange={(e) => { stopScanner(); setClassId(e.target.value); setMessage(''); setError(''); }}>
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
        ) : (
          <>
            <div className="checkin-scanner">
              <video ref={videoRef} playsInline muted className={scannerOn ? 'is-active' : undefined} />
              {!scannerOn && <><strong>Camera QR scanner</strong><p className="small">The student presents their ASWJ College Student Portal QR code.</p></>}
              <div className="actions checkin-scanner-actions">
                {!scannerOn ? (
                  <button type="button" className="btn btn-primary" disabled={pending} onClick={startScanner}>Start scanner</button>
                ) : (
                  <button type="button" className="btn btn-outline" onClick={stopScanner}>Stop scanner</button>
                )}
              </div>
            </div>

            <div className="field checkin-manual-entry">
              <label htmlFor="manual-qr-token">Manual QR token fallback</label>
              <div className="actions checkin-manual-actions">
                <input id="manual-qr-token" autoComplete="off" value={manualToken} onChange={(e) => setManualToken(e.target.value)} placeholder="Paste or type QR token" />
                <button type="button" className="btn btn-primary" disabled={!manualToken.trim() || pending} onClick={() => processToken(manualToken)}>Check in</button>
              </div>
              <span className="small">Use this if camera scanning is unavailable.</span>
            </div>
          </>
        )}
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
