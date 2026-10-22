'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { checkInByQr } from '../admin/actions/checkin-actions';
import { formatClassTime } from '../../lib/class-time';
import type { ScannerClass } from '../../lib/attendance/scanner-data';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function attendanceLabel(status: string | null) {
  if (status === 'absent_unexcused') return 'Absent';
  if (status === 'absent_excused') return 'Excused';
  if (!status) return 'Not marked';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function ScannerClient({
  classes,
  today,
  rosterHref,
}: {
  classes: ScannerClass[];
  today: string;
  rosterHref: '/admin/check-in' | '/teacher/check-in';
}) {
  const router = useRouter();
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [scannerOn, setScannerOn] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequestId = useRef(0);
  const scanLock = useRef(false);
  const lastScan = useRef<{ token: string; at: number } | null>(null);
  const unlockTimerRef = useRef<number | null>(null);

  const selected = useMemo(() => classes.find((classRow) => classRow.id === classId) ?? null, [classes, classId]);
  const selectedSchedule = selected
    ? [
        selected.dayOfWeek === null ? null : DAYS[selected.dayOfWeek],
        selected.startTime
          ? `${formatClassTime(selected.startTime)}${selected.endTime ? `–${formatClassTime(selected.endTime)}` : ''}`
          : null,
        selected.location || 'No location set',
      ].filter(Boolean).join(' · ')
    : '';

  const clearUnlockTimer = () => {
    if (unlockTimerRef.current !== null) {
      window.clearTimeout(unlockTimerRef.current);
      unlockTimerRef.current = null;
    }
  };

  const stopScanner = () => {
    cameraRequestId.current += 1;
    clearUnlockTimer();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScannerOn(false);
    setCameraStarting(false);
    scanLock.current = false;
    lastScan.current = null;
  };

  useEffect(() => () => {
    cameraRequestId.current += 1;
    if (unlockTimerRef.current !== null) window.clearTimeout(unlockTimerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const processToken = (raw: string) => {
    const normalizedToken = raw.trim();
    if (!classId || !normalizedToken || pending || scanLock.current) return;

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
        clearUnlockTimer();
        unlockTimerRef.current = window.setTimeout(() => {
          unlockTimerRef.current = null;
          scanLock.current = false;
        }, 1400);
      } catch (scanError) {
        setError(scanError instanceof Error ? scanError.message : 'The QR code could not be processed.');
        clearUnlockTimer();
        unlockTimerRef.current = window.setTimeout(() => {
          unlockTimerRef.current = null;
          scanLock.current = false;
        }, 1800);
      }
    });
  };

  const startScanner = async () => {
    if (cameraStarting || scannerOn) return;

    clearUnlockTimer();
    scanLock.current = false;
    const requestId = ++cameraRequestId.current;
    setCameraStarting(true);
    setError('');
    setMessage('');

    try {
      const Detector = (window as any).BarcodeDetector;
      if (!Detector) {
        setError('This browser does not provide built-in QR scanning. Use the manual token box below or open this page in Chrome or Edge on a supported device.');
        setCameraStarting(false);
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });

      if (requestId !== cameraRequestId.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      setScannerOn(true);
      setCameraStarting(false);

      const video = videoRef.current;
      if (!video) {
        stopScanner();
        throw new Error('The camera preview could not be started.');
      }

      video.srcObject = stream;
      await video.play();

      const detector = new Detector({ formats: ['qr_code'] });
      const scan = async () => {
        if (requestId !== cameraRequestId.current || !streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (requestId !== cameraRequestId.current || streamRef.current !== stream) return;
          const value = codes?.[0]?.rawValue;
          if (value && !scanLock.current) processToken(value);
        } catch {}
        if (requestId === cameraRequestId.current && streamRef.current) requestAnimationFrame(scan);
      };

      requestAnimationFrame(scan);
    } catch (cameraError) {
      if (requestId !== cameraRequestId.current) return;
      setError(cameraError instanceof Error ? cameraError.message : 'Camera access could not be started.');
      stopScanner();
    }
  };

  return (
    <>
      <div className="topbar scanner-topbar">
        <div>
          <span className="eyebrow">Dedicated scanner</span>
          <h1>Class check-in scanner</h1>
          <p className="subtitle">Scan student QR codes for today’s classes — {today}.</p>
        </div>
        <a className="btn btn-outline" href={rosterHref}>Open attendance roster</a>
      </div>

      <section className="card">
        <div className="form-row">
          <div className="field">
            <label htmlFor="scanner-class">Select class</label>
            <select
              id="scanner-class"
              value={classId}
              disabled={pending || cameraStarting}
              onChange={(event) => {
                stopScanner();
                setClassId(event.target.value);
                setMessage('');
                setError('');
              }}
            >
              {classes.length === 0 && <option value="">No classes available today</option>}
              {classes.map((classRow) => <option key={classRow.id} value={classRow.id}>{classRow.name}</option>)}
            </select>
          </div>
          <div>
            {selected && (
              <div className="small checkin-class-summary">
                {selectedSchedule}
                {' · '}{selected.checkedInCount}/{selected.enrolledCount} checked in
              </div>
            )}
          </div>
        </div>

        {error && <div className="notice" role="alert">{error}</div>}
        {message && (
          <div className="card scanner-result" role="status" aria-live="polite">
            <strong>{message}</strong>
          </div>
        )}

        {!selected ? (
          <div className="portal-empty checkin-empty">
            <strong>No classes available today</strong>
            <span>Only active classes that this account is authorised to check in appear here.</span>
          </div>
        ) : selected.sessionCancelled ? (
          <div className="notice"><strong>Session cancelled</strong>Attendance cannot be recorded for this class today.</div>
        ) : (
          <>
            <div className="checkin-scanner">
              <video ref={videoRef} playsInline muted className={scannerOn ? 'is-active' : undefined} />
              {!scannerOn && (
                <>
                  <strong>Camera QR scanner</strong>
                  <p className="small">Ask the student to present their ASWJ College Student Portal QR code.</p>
                </>
              )}
              <div className="actions checkin-scanner-actions">
                {!scannerOn ? (
                  <button type="button" className="btn btn-primary" disabled={pending || cameraStarting} onClick={startScanner}>
                    {cameraStarting ? 'Starting camera…' : 'Start scanner'}
                  </button>
                ) : (
                  <button type="button" className="btn btn-outline" onClick={stopScanner}>Stop scanner</button>
                )}
              </div>
            </div>

            <div className="field checkin-manual-entry">
              <label htmlFor="manual-qr-token">Manual QR token fallback</label>
              <div className="actions checkin-manual-actions">
                <input
                  id="manual-qr-token"
                  autoComplete="off"
                  value={manualToken}
                  onChange={(event) => setManualToken(event.target.value)}
                  placeholder="Paste or type QR token"
                />
                <button type="button" className="btn btn-primary" disabled={!manualToken.trim() || pending} onClick={() => processToken(manualToken)}>Check in</button>
              </div>
              <span className="small">Use this if camera scanning is unavailable.</span>
            </div>
          </>
        )}
      </section>
    </>
  );
}
