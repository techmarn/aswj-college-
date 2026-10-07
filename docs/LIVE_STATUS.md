# ASWJ College live status — v0.9

The production site remains on the existing release. The v0.9 teacher attendance
portal and its database protections are being verified in the separate dev environment.

## Production live
- Students / profiles
- Classes and class sessions
- Applications: pending, accepted, waitlisted, declined
- Enrolments: enrolled, waitlisted, suspended, withdrawn, completed
- Attendance: present, late, unexcused absent, excused absent, cancelled
- Consecutive-unexcused-absence review view with per-class threshold (default 3)
- Suspension review records
- Notifications queue
- Audit log
- Random student QR identity tokens
- RLS-based admin/student access controls
- Automatic profile + QR creation on Supabase Auth signup
- Student application and enrolment status views
- Per-class attendance history and consecutive-absence standing
- Portal notification feed with student-scoped read acknowledgement
- Automatic warning/review notifications with 14-day duplicate suppression
- Sydney-local attendance calculations based on recorded roll outcomes and bounded by enrolment/reinstatement dates
- Atomic application, suspension, review, reinstatement and check-in workflows
- Internal application notes exposed only through an administrator-authorised database function
- Immutable Microsoft Forms intake with exact field parsing and response-id deduplication
- Existing-student email matching without automatic Auth-user creation
- Exact Forms course registry with no fallback to the test class
- Protected Forms import review, class assignment and reprocessing workflow
- Public Apply entry page and authenticated Student Portal application form
- Native application choices derived directly from classes explicitly enabled by administrators
- Explicit per-class Portal application switch and registration-window enforcement
- Confirmed-account identity, atomic duplicate protection and pending Admin Applications hand-off
- Protected one-to-one native registration details loaded only for an authorised administrator

## Dev preview — v0.9

- Dedicated, role-routed teacher attendance portal at `/teacher/check-in`
- Assigned-class-only teacher roster and attendance mutations enforced in the database
- Attendance-safe teacher roster response with no student contact, guardian, DOB, medical or learning fields
- Complete-schedule, Sydney-date, class-date and scheduled-weekday enforcement for teacher attendance
- Idempotent QR check-in, manual marking and roll closure with preserved audit history
- Closed-roll protection for teachers with administrator correction access preserved
- Mobile-first scanner, roster fallback and large attendance controls for Android tablets

## First admin bootstrap
Create an account through `/login?mode=signup`. After the user confirms the account,
promote that exact Auth user to `super_admin` using a trusted server/admin operation.
Do not expose an open "claim admin" endpoint.

## Teacher access bootstrap
Create or identify the staff member's confirmed Supabase Auth account. Through a trusted
Dashboard or admin operation, set that Auth user's `app_metadata.role` to `teacher`, and
set the matching `profiles.role` to `teacher`. Assign the staff member under
**Admin → Classes**, complete the class weekday and start/end time, then have them
sign out and back in so the refreshed session contains the trusted role. Do not
place staff roles in user-editable `user_metadata`.

The teacher can then sign in through `/login` and is routed to `/teacher/check-in`.
An unassigned teacher sees an empty state and receives no student roster data.

## Environment
Local source control contains only the environment template. Browser values use the public Supabase URL/publishable key; service-role and Forms secrets remain server-only deployment values.

## Registration cutover
The ASWJ form in the Student Portal is now the primary registration path. Create each real class with confirmed operational details under **Admin → Classes** and explicitly enable Portal applications on that class. It then appears automatically in the application form without a second mapping step. Existing Microsoft receipts and reprocessing remain available under **Legacy Forms**; Power Automate is not required for the native form.
