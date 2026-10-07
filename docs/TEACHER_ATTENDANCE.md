# Teacher attendance portal

The teacher portal provides a narrow, mobile-first attendance screen at
`/teacher/check-in`. Teachers use the normal `/login` page and are routed to the
teacher portal automatically.

## Access model

- A teacher must have the trusted Auth `app_metadata.role` value `teacher`.
- The matching `profiles.role` must also be `teacher`, so the staff member appears
  in the class-assignment list.
- The class must be active and its `teacher_id` must match the signed-in teacher.
- The class must have a configured weekday and start/end time, be within its
  configured start/end dates and be scheduled for the current weekday in Sydney.
- Administrators and super administrators keep their existing attendance access.
- Teachers do not receive direct access to profile, QR-token, audit, attendance,
  enrolment or session tables.

The roster function returns only class schedule data, student ID/name, enrolment
state and today's attendance. It deliberately omits email, phone, date of birth,
guardian, emergency, medical, allergy and learning information.

## Provision a teacher

1. Create or identify the teacher's confirmed account in Supabase Auth.
2. In a trusted Supabase Dashboard or admin operation, set that Auth user's
   `app_metadata.role` to `teacher`. Do not use user-editable `user_metadata`.
3. Set the matching row in `public.profiles` to `role = 'teacher'`.
4. In the ASWJ Admin portal, open **Classes**, edit the class, confirm its weekday
   and start/end time, choose the teacher and save.
5. Ask the teacher to sign out and sign in again so the new trusted role is in the
   session token.
6. Open `/teacher/check-in` on the attendance device and test one roster action
   and one QR scan before the first live class.

An unassigned teacher sees a safe empty state rather than all classes or student
records. Removing the assignment blocks the teacher's next attendance request,
even if the old page remains open.

## Attendance behaviour

- A repeated QR scan reports that attendance is already recorded and preserves
  the original status, check-in time and audit record.
- Repeating the same manual status is a no-op.
- Closing the roll marks eligible unrecorded students absent once and records one
  closure audit event.
- A teacher cannot change attendance after closing the roll. An administrator can
  make a correction through the existing Admin check-in screen.
- The camera uses the browser's QR support. The on-screen roster buttons remain
  available if a device or browser cannot scan.

## Device check before launch

On each Android tablet, confirm HTTPS access, camera permission, rear-camera
selection, QR reading, screen rotation, sign-out and Wi-Fi recovery. Keep the
tablet locked to the teacher portal and use a dedicated staff account rather than
an administrator account.
