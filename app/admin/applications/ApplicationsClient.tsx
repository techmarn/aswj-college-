'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ApplicationDecision,
  ApplicationRegistrationDetails,
  acceptApplications,
  decideApplication,
  getApplicationRegistrationDetails,
} from '../actions/application-actions';
import { useAdminDialog } from '../useAdminDialog';
import { MAX_BULK_ACTION_SIZE } from '../../../lib/bulk-actions';

export type ApplicationAdminRow = {
  id: string;
  studentId: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  dateOfBirth: string | null;
  emergencyContactName: string;
  emergencyContactMobile: string;
  classId: string;
  className: string;
  classCapacity: number;
  classEnrolled: number;
  classActive: boolean;
  status: string;
  waitlistPosition: number | null;
  source: string;
  externalResponseId: string;
  submittedAt: string;
  reviewedAt: string | null;
  adminNotes: string;
};

const FILTERS = ['all', 'pending', 'accepted', 'waitlisted', 'declined'] as const;

function statusLabel(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' ') : 'Unknown';
}

function badgeClass(value: string) {
  if (value === 'accepted') return 'green';
  if (value === 'pending') return 'amber';
  if (value === 'declined') return 'red';
  if (value === 'waitlisted') return 'blue';
  return 'grey';
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function ApplicationsClient({ rows }: { rows: ApplicationAdminRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('pending');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ApplicationAdminRow | null>(null);
  const [registrationDetails, setRegistrationDetails] = useState<ApplicationRegistrationDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkError, setBulkError] = useState('');
  const detailRequest = useRef(0);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => {
    const result: Record<string, number> = { all: rows.length };
    for (const row of rows) result[row.status] = (result[row.status] ?? 0) + 1;
    return result;
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter !== 'all' && row.status !== filter) return false;
      if (!q) return true;
      return [
        row.name,
        row.email,
        row.mobile,
        row.className,
        row.id,
        row.externalResponseId,
      ].some((value) => String(value ?? '').toLowerCase().includes(q));
    });
  }, [rows, filter, query]);

  const bulkEligible = useMemo(
    () => visible.filter((row) => row.status === 'pending' && row.classActive),
    [visible]
  );
  const selectedEligibleIds = useMemo(
    () => bulkEligible.filter((row) => selectedIds.has(row.id)).map((row) => row.id),
    [bulkEligible, selectedIds]
  );
  const allVisibleSelected = bulkEligible.length > 0
    && bulkEligible.every((row) => selectedIds.has(row.id));
  const someVisibleSelected = selectedEligibleIds.length > 0 && !allVisibleSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleSelected;
  }, [someVisibleSelected]);

  useEffect(() => {
    const eligibleIds = new Set(bulkEligible.map((row) => row.id));
    setSelectedIds((current) => {
      const next = new Set(Array.from(current).filter((id) => eligibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [bulkEligible]);

  const clearBulkSelection = () => {
    setSelectedIds(new Set());
    setBulkMessage('');
    setBulkError('');
  };

  const toggleApplication = (applicationId: string, checked: boolean) => {
    setBulkMessage('');
    setBulkError('');
    if (checked && !selectedIds.has(applicationId) && selectedIds.size >= MAX_BULK_ACTION_SIZE) {
      setBulkError(`You can accept up to ${MAX_BULK_ACTION_SIZE} applications at a time.`);
      return;
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!checked) {
        next.delete(applicationId);
        return next;
      }
      if (!next.has(applicationId) && next.size >= MAX_BULK_ACTION_SIZE) return current;
      next.add(applicationId);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setBulkMessage('');
    setBulkError('');
    if (bulkEligible.length > MAX_BULK_ACTION_SIZE) {
      setBulkError(
        `More than ${MAX_BULK_ACTION_SIZE} pending applications are shown. Narrow the search before using Select all, or choose up to ${MAX_BULK_ACTION_SIZE} individually.`
      );
      return;
    }
    setSelectedIds(
      allVisibleSelected
        ? new Set()
        : new Set(bulkEligible.map((row) => row.id))
    );
  };

  const acceptSelected = () => {
    const ids = selectedEligibleIds.slice(0, MAX_BULK_ACTION_SIZE);
    if (ids.length === 0 || pending) return;
    const noun = ids.length === 1 ? 'application' : 'applications';
    if (!window.confirm(
      `Accept ${ids.length} selected ${noun}? Acceptance messages will be queued for all accepted students.`
    )) return;

    setBulkMessage('');
    setBulkError('');
    startTransition(async () => {
      try {
        const result = await acceptApplications(ids);
        setSelectedIds(new Set());
        setBulkMessage(
          result.processed === 1
            ? '1 application accepted. Its acceptance message has been queued.'
            : `${result.processed} applications accepted. Their acceptance messages have been queued.`
        );
        router.refresh();
      } catch (err) {
        setBulkError(
          `The result could not be confirmed. ${err instanceof Error ? err.message : 'The applications could not be accepted.'} The list has been refreshed.`
        );
        router.refresh();
      }
    });
  };

  const open = (row: ApplicationAdminRow) => {
    const request = detailRequest.current + 1;
    detailRequest.current = request;
    setSelected(row);
    setNote(row.adminNotes);
    setError('');
    setRegistrationDetails(null);
    setDetailsError('');
    setDetailsLoading(true);

    void getApplicationRegistrationDetails(row.id)
      .then((details) => {
        if (detailRequest.current === request) setRegistrationDetails(details);
      })
      .catch(() => {
        if (detailRequest.current === request) {
          setDetailsError('Registration details could not be loaded.');
        }
      })
      .finally(() => {
        if (detailRequest.current === request) setDetailsLoading(false);
      });
  };

  const close = () => {
    if (pending) return;
    detailRequest.current += 1;
    setSelected(null);
    setRegistrationDetails(null);
    setDetailsLoading(false);
    setDetailsError('');
  };
  const dialogRef = useAdminDialog<HTMLDivElement>({
    open: selected !== null,
    onClose: close,
  });

  const decide = (decision: ApplicationDecision) => {
    if (!selected) return;
    setError('');

    startTransition(async () => {
      try {
        await decideApplication(selected.id, decision, note);
        setSelectedIds((current) => {
          const next = new Set(current);
          next.delete(selected.id);
          return next;
        });
        setSelected(null);
        setNote('');
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The application could not be updated.');
      }
    });
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-row" style={{ alignItems: 'end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="admin-application-search">Search applications</label>
            <input
              id="admin-application-search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                clearBulkSelection();
              }}
              placeholder="Name, email, mobile, class or response ID"
            />
          </div>
          <div className="small">
            Showing {visible.length} of {rows.length} applications
          </div>
        </div>
      </div>

      <div className="filters" role="group" aria-label="Application status filters">
        {FILTERS.map((item) => (
          <button
            key={item}
            className={`filter ${filter === item ? 'active' : ''}`}
            type="button"
            aria-pressed={filter === item}
            onClick={() => {
              setFilter(item);
              clearBulkSelection();
            }}
          >
            {statusLabel(item)} ({counts[item] ?? 0})
          </button>
        ))}
      </div>

      <div className="bulk-toolbar" aria-busy={pending}>
        <div>
          <strong>
            {selectedEligibleIds.length === 0
              ? 'Select pending applications to accept'
              : `${selectedEligibleIds.length} ${selectedEligibleIds.length === 1 ? 'application' : 'applications'} selected`}
          </strong>
          <span>
            {bulkEligible.length > MAX_BULK_ACTION_SIZE
              ? `More than ${MAX_BULK_ACTION_SIZE} pending applications are shown. Narrow the search to use Select all.`
              : `Only pending applications for active classes can be selected, up to ${MAX_BULK_ACTION_SIZE} at a time.`}
          </span>
        </div>
        <button
          className="btn btn-primary"
          type="button"
          disabled={pending || selectedEligibleIds.length === 0}
          onClick={acceptSelected}
        >
          {pending ? 'Accepting…' : 'Accept selected'}
        </button>
      </div>

      {bulkError && <div className="notice" role="alert">{bulkError}</div>}
      {bulkMessage && <div className="notice success" role="status">{bulkMessage}</div>}

      <div
        className="table-wrap"
        role="region"
        aria-label="Applications"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th className="bulk-select-column">
                <label className="bulk-select-control">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allVisibleSelected}
                    disabled={pending || bulkEligible.length === 0 || bulkEligible.length > MAX_BULK_ACTION_SIZE}
                    onChange={toggleAllVisible}
                  />
                    <span className="sr-only">Select shown pending applications, up to {MAX_BULK_ACTION_SIZE}</span>
                </label>
              </th>
              <th>Applicant</th>
              <th>Class</th>
              <th>Submitted</th>
              <th>Status</th>
              <th>Class places</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7}><span className="small">No applications match this view.</span></td>
              </tr>
            ) : visible.map((row) => (
              <tr key={row.id} className={selectedIds.has(row.id) ? 'bulk-row-selected' : undefined}>
                <td className="bulk-select-column">
                  <label className="bulk-select-control">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.id)}
                      disabled={
                        pending
                        || row.status !== 'pending'
                        || !row.classActive
                        || (!selectedIds.has(row.id) && selectedIds.size >= MAX_BULK_ACTION_SIZE)
                      }
                      onChange={(event) => toggleApplication(row.id, event.target.checked)}
                    />
                    <span className="sr-only">Select application from {row.name}</span>
                  </label>
                </td>
                <td>
                  <strong>{row.name}</strong><br/>
                  <span className="small">{row.email || row.mobile || row.id}</span>
                </td>
                <td>{row.className}</td>
                <td>{formatDate(row.submittedAt)}</td>
                <td>
                  <span className={`badge ${badgeClass(row.status)}`}>
                    {statusLabel(row.status)}
                    {row.status === 'waitlisted' && row.waitlistPosition ? ` #${row.waitlistPosition}` : ''}
                  </span>
                </td>
                <td>{row.classEnrolled} / {row.classCapacity}</td>
                <td><button className="btn btn-outline" disabled={pending} onClick={() => open(row)}>Review</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="modal-backdrop" onMouseDown={close}>
          <div
            ref={dialogRef}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="application-review-title"
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
            style={{ width: 'min(680px,100%)', maxHeight: '92vh', overflow: 'auto' }}
          >
            <h3 id="application-review-title">{selected.name}</h3>
            <p className="subtitle">{selected.className}</p>

            {error && <div className="notice" role="alert" style={{ marginTop: 16 }}>{error}</div>}

            <div className="portal-grid" style={{ marginTop: 18 }}>
              <div className="card">
                <div className="small">Applicant details</div>
                <p><strong>Email</strong><br/>{selected.email || '—'}</p>
                <p><strong>Mobile</strong><br/>{selected.mobile || '—'}</p>
                <p><strong>Date of birth</strong><br/>{formatDate(selected.dateOfBirth)}</p>
                <p><strong>Emergency contact</strong><br/>{selected.emergencyContactName || '—'}{selected.emergencyContactMobile ? ` · ${selected.emergencyContactMobile}` : ''}</p>
              </div>
              <div className="card">
                <div className="small">Application</div>
                <p><strong>Status</strong><br/><span className={`badge ${badgeClass(selected.status)}`}>{statusLabel(selected.status)}</span></p>
                <p><strong>Submitted</strong><br/>{formatDate(selected.submittedAt)}</p>
                <p><strong>Source</strong><br/>{selected.source}</p>
                {selected.externalResponseId && <p><strong>External response</strong><br/>{selected.externalResponseId}</p>}
                <p><strong>Class capacity</strong><br/>{selected.classEnrolled} / {selected.classCapacity}</p>
              </div>
            </div>

            <div className="card" style={{ marginTop: 14 }}>
              <div className="small">Submitted registration details</div>
              {detailsLoading ? (
                <p>Loading protected details…</p>
              ) : detailsError ? (
                <p style={{ color: 'var(--danger)' }}>{detailsError}</p>
              ) : registrationDetails ? (
                <div className="portal-grid">
                  <div>
                    <p><strong>Submitted student name</strong><br/>{registrationDetails.studentFirstName} {registrationDetails.studentLastName}</p>
                    <p><strong>Confirmed email</strong><br/>{registrationDetails.emailAddress}</p>
                    <p><strong>Phone</strong><br/>{registrationDetails.phoneNumber}</p>
                    <p><strong>Date of birth</strong><br/>{formatDate(registrationDetails.dateOfBirth)}</p>
                    <p><strong>Guardian</strong><br/>{registrationDetails.guardianFullName || '—'}{registrationDetails.guardianPhoneNumber ? ` · ${registrationDetails.guardianPhoneNumber}` : ''}</p>
                    <p><strong>WhatsApp consent</strong><br/>{registrationDetails.whatsappOptIn ? 'Yes' : 'No'}</p>
                  </div>
                  <div>
                    <p><strong>Medical, learning or allergy notes</strong><br/><span style={{ whiteSpace: 'pre-wrap' }}>{registrationDetails.medicalLearningAllergyNotes || '—'}</span></p>
                    <p><strong>Previous studies</strong><br/><span style={{ whiteSpace: 'pre-wrap' }}>{registrationDetails.previousStudies || '—'}</span></p>
                    <p className="small">Privacy notice {registrationDetails.privacyNoticeVersion} accepted {formatDate(registrationDetails.consentedAt)}</p>
                  </div>
                </div>
              ) : (
                <p className="small">No native registration snapshot is attached to this application.</p>
              )}
            </div>

            <div className="field" style={{ marginTop: 18 }}>
              <label htmlFor="application-admin-notes">Admin notes</label>
              <textarea
                id="application-admin-notes"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Internal review notes"
              />
            </div>

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <button className="btn btn-outline" disabled={pending} onClick={close}>Close</button>
              <div className="actions">
                <button className="btn btn-outline" disabled={pending} onClick={() => decide('declined')}>Decline</button>
                <button className="btn btn-secondary" disabled={pending} onClick={() => decide('waitlisted')}>Waitlist</button>
                <button className="btn btn-primary" disabled={pending || !selected.classActive} onClick={() => decide('accepted')}>
                  {pending ? 'Saving…' : 'Accept'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
