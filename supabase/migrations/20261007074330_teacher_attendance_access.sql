-- Give assigned teachers a narrowly scoped attendance API without exposing
-- profiles, QR tokens, audit rows, or generic table writes through the Data API.
-- Existing student/admin RLS policies remain unchanged.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- Central authorization gate used by every class-specific attendance RPC.
-- Auth roles come only from trusted app_metadata. A teacher must also be the
-- current classes.teacher_id for the requested class.
create or replace function private.attendance_access_scope(
  p_class_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := coalesce(auth.jwt()->'app_metadata'->>'role', '');
begin
  if coalesce(auth.jwt()->>'role', '') = 'service_role' then
    return 'service_role';
  end if;

  if v_actor is not null and v_role in ('admin', 'super_admin') then
    return v_role;
  end if;

  if v_actor is not null
     and v_role = 'teacher'
     and exists (
       select 1
       from public.classes c
       where c.id = p_class_id
         and c.teacher_id = v_actor
     ) then
    return 'teacher';
  end if;

  raise exception 'Administrator or assigned teacher access required'
    using errcode = '42501';
end;
$$;

revoke all on function private.attendance_access_scope(uuid)
from public, anon, authenticated;

-- A flattened, least-privilege read model for today's check-in screen. It
-- returns only class schedule details, roster identity/name, and attendance.
-- In particular, it does not expose DOB, email, phone, guardian, medical, or
-- QR-token data from the underlying tables.
create or replace function public.attendance_staff_today_roster()
returns table (
  class_id uuid,
  class_name text,
  class_term text,
  class_location text,
  class_day_of_week smallint,
  class_start_time time,
  class_end_time time,
  session_id uuid,
  session_cancelled boolean,
  enrolment_id uuid,
  student_id uuid,
  student_name text,
  enrolment_status text,
  attendance_status text,
  checked_in_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := coalesce(auth.jwt()->'app_metadata'->>'role', '');
  v_is_service boolean := coalesce(auth.jwt()->>'role', '') = 'service_role';
  v_today date := (now() at time zone 'Australia/Sydney')::date;
begin
  if not v_is_service
     and (
       v_actor is null
       or v_role not in ('teacher', 'admin', 'super_admin')
     ) then
    raise exception 'Teacher or administrator access required'
      using errcode = '42501';
  end if;

  return query
  select
    c.id,
    c.name,
    c.term,
    c.location,
    c.day_of_week,
    c.start_time,
    c.end_time,
    cs.id,
    coalesce(cs.cancelled, false),
    e.id,
    e.student_id,
    case
      when e.id is null then null
      else coalesce(
        nullif(
          btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')),
          ''
        ),
        'Student'
      )
    end,
    e.status::text,
    a.status::text,
    a.checked_in_at
  from public.classes c
  left join public.class_sessions cs
    on cs.class_id = c.id
   and cs.session_date = v_today
  left join public.enrolments e
    on e.class_id = c.id
   and e.status in (
     'enrolled'::public.enrolment_status,
     'suspended'::public.enrolment_status
   )
  left join public.profiles p on p.id = e.student_id
  left join public.attendance a
    on a.enrolment_id = e.id
   and a.session_id = cs.id
  where c.active = true
    and (
      v_is_service
      or v_role in ('admin', 'super_admin')
      or (
        v_role = 'teacher'
        and c.teacher_id = v_actor
        and (c.starts_on is null or v_today >= c.starts_on)
        and (c.ends_on is null or v_today <= c.ends_on)
        and (
          c.day_of_week is null
          or c.day_of_week = extract(dow from v_today)::smallint
        )
      )
    )
  order by c.name, p.last_name nulls last, p.first_name nulls last;
end;
$$;

revoke execute on function public.attendance_staff_today_roster()
from public, anon;
grant execute on function public.attendance_staff_today_roster()
to authenticated, service_role;

-- Preserve the existing RPC contract while extending authorization to the
-- assigned teacher. Teacher calls are limited to the configured class dates and
-- weekday; administrators/service-role retain their existing operational scope.
create or replace function public.admin_today_session(
  p_class_id uuid
)
returns table (
  session_id uuid,
  session_cancelled boolean,
  session_starts_at timestamptz,
  session_ends_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_scope text := private.attendance_access_scope(p_class_id);
  v_today date := (now() at time zone 'Australia/Sydney')::date;
  v_active boolean;
  v_starts_on date;
  v_ends_on date;
  v_day_of_week smallint;
  v_start_time time;
  v_end_time time;
  v_session_existed boolean;
  v_old_starts_at timestamptz;
  v_old_ends_at timestamptz;
begin
  select
    c.active,
    c.starts_on,
    c.ends_on,
    c.day_of_week,
    c.start_time,
    c.end_time
  into
    v_active,
    v_starts_on,
    v_ends_on,
    v_day_of_week,
    v_start_time,
    v_end_time
  from public.classes c
  where c.id = p_class_id
  for update;

  if not found then
    raise exception 'Class not found';
  end if;
  if not v_active then
    raise exception 'This class is archived';
  end if;

  if v_scope = 'teacher' then
    if v_starts_on is not null and v_today < v_starts_on then
      raise exception 'This class has not started yet';
    end if;
    if v_ends_on is not null and v_today > v_ends_on then
      raise exception 'This class has ended';
    end if;
    if v_day_of_week is not null
       and v_day_of_week <> extract(dow from v_today)::smallint then
      raise exception 'This class is not scheduled today';
    end if;
  end if;

  session_starts_at := case
    when v_start_time is null then null
    else (v_today + v_start_time) at time zone 'Australia/Sydney'
  end;
  session_ends_at := case
    when v_end_time is null then null
    else (v_today + v_end_time) at time zone 'Australia/Sydney'
  end;

  select cs.starts_at, cs.ends_at
  into v_old_starts_at, v_old_ends_at
  from public.class_sessions cs
  where cs.class_id = p_class_id
    and cs.session_date = v_today
  for update;
  v_session_existed := found;

  insert into public.class_sessions as existing (
    class_id,
    session_date,
    starts_at,
    ends_at,
    cancelled
  ) values (
    p_class_id,
    v_today,
    session_starts_at,
    session_ends_at,
    false
  )
  on conflict (class_id, session_date)
  do update set
    starts_at = coalesce(existing.starts_at, excluded.starts_at),
    ends_at = coalesce(existing.ends_at, excluded.ends_at)
  returning
    existing.id,
    existing.cancelled,
    existing.starts_at,
    existing.ends_at
  into
    session_id,
    session_cancelled,
    session_starts_at,
    session_ends_at;

  if not v_session_existed
     or v_old_starts_at is distinct from session_starts_at
     or v_old_ends_at is distinct from session_ends_at then
    insert into public.audit_log (
      actor_id,
      entity_type,
      entity_id,
      action,
      old_values,
      new_values
    ) values (
      v_actor,
      'class_session',
      session_id::text,
      case
        when v_session_existed then 'class_session_schedule_synced'
        else 'class_session_created'
      end,
      case
        when v_session_existed then jsonb_build_object(
          'starts_at', v_old_starts_at,
          'ends_at', v_old_ends_at
        )
        else '{}'::jsonb
      end,
      jsonb_build_object(
        'class_id', p_class_id,
        'session_date', v_today,
        'starts_at', session_starts_at,
        'ends_at', session_ends_at
      )
    );
  end if;

  return next;
end;
$$;

revoke execute on function public.admin_today_session(uuid)
from public, anon;
grant execute on function public.admin_today_session(uuid)
to authenticated, service_role;

-- The response adds idempotency metadata. Repeated scans preserve the original
-- attendance row and audit history rather than changing its status/time.
drop function if exists public.admin_check_in_by_qr(uuid, uuid);
create function public.admin_check_in_by_qr(
  p_class_id uuid,
  p_token uuid
)
returns table (
  student_name text,
  attendance_status text,
  checked_in_at timestamptz,
  already_checked_in boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_scope text := private.attendance_access_scope(p_class_id);
  v_session_id uuid;
  v_session_cancelled boolean;
  v_student_id uuid;
  v_first_name text;
  v_last_name text;
  v_enrolment_id uuid;
  v_enrolment_status public.enrolment_status;
  v_existing_attendance_id uuid;
  v_existing_status public.attendance_status;
  v_existing_checked_in_at timestamptz;
  v_now timestamptz := now();
begin
  perform v_scope;

  select s.session_id, s.session_cancelled
  into v_session_id, v_session_cancelled
  from public.admin_today_session(p_class_id) s;

  if v_session_cancelled then
    raise exception 'Today''s class session is cancelled';
  end if;

  select q.student_id, p.first_name, p.last_name
  into v_student_id, v_first_name, v_last_name
  from public.student_qr_tokens q
  join public.profiles p on p.id = q.student_id
  where q.token = p_token
    and q.active = true
  for share of q;

  if v_student_id is null then
    raise exception 'This QR code is not valid or has been revoked';
  end if;

  select e.id, e.status
  into v_enrolment_id, v_enrolment_status
  from public.enrolments e
  where e.student_id = v_student_id
    and e.class_id = p_class_id
  for update;

  if v_enrolment_id is null then
    raise exception 'This student is not enrolled in the selected class';
  end if;
  if v_enrolment_status = 'suspended'::public.enrolment_status then
    raise exception 'This student is currently suspended from this class';
  end if;
  if v_enrolment_status is distinct from 'enrolled'::public.enrolment_status then
    raise exception 'This enrolment is not active';
  end if;

  student_name := coalesce(
    nullif(btrim(coalesce(v_first_name, '') || ' ' || coalesce(v_last_name, '')), ''),
    'Student'
  );

  select a.id, a.status, a.checked_in_at
  into v_existing_attendance_id, v_existing_status, v_existing_checked_in_at
  from public.attendance a
  where a.enrolment_id = v_enrolment_id
    and a.session_id = v_session_id
  for update;

  if v_existing_attendance_id is not null then
    attendance_status := v_existing_status::text;
    checked_in_at := v_existing_checked_in_at;
    already_checked_in := true;
    return next;
    return;
  end if;

  if v_scope = 'teacher'
     and exists (
       select 1
       from public.audit_log al
       where al.entity_type = 'class_session'
         and al.entity_id = v_session_id::text
         and al.action = 'attendance_roll_closed'
     ) then
    raise exception 'Today''s attendance roll is closed';
  end if;

  insert into public.attendance (
    enrolment_id,
    session_id,
    status,
    checked_in_at,
    checkin_method,
    recorded_by,
    updated_at
  ) values (
    v_enrolment_id,
    v_session_id,
    'present',
    v_now,
    'qr',
    v_actor,
    v_now
  );

  insert into public.audit_log (
    actor_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  ) values (
    v_actor,
    'attendance',
    v_enrolment_id::text,
    'qr_checkin',
    jsonb_build_object('status', null),
    jsonb_build_object(
      'class_id', p_class_id,
      'session_id', v_session_id,
      'student_id', v_student_id,
      'status', 'present',
      'checked_in_at', v_now
    )
  );

  attendance_status := 'present';
  checked_in_at := v_now;
  already_checked_in := false;
  return next;
end;
$$;

revoke execute on function public.admin_check_in_by_qr(uuid, uuid)
from public, anon;
grant execute on function public.admin_check_in_by_qr(uuid, uuid)
to authenticated, service_role;

create or replace function public.admin_set_manual_attendance(
  p_enrolment_id uuid,
  p_class_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_scope text := private.attendance_access_scope(p_class_id);
  v_session_id uuid;
  v_session_cancelled boolean;
  v_enrolment_status public.enrolment_status;
  v_attendance_status public.attendance_status;
  v_old_attendance_status public.attendance_status;
  v_now timestamptz := now();
begin
  perform v_scope;

  if p_status not in ('present', 'late', 'absent_unexcused', 'absent_excused') then
    raise exception 'Unsupported attendance status';
  end if;
  v_attendance_status := p_status::public.attendance_status;

  select s.session_id, s.session_cancelled
  into v_session_id, v_session_cancelled
  from public.admin_today_session(p_class_id) s;

  if v_session_cancelled then
    raise exception 'Today''s class session is cancelled';
  end if;

  select e.status
  into v_enrolment_status
  from public.enrolments e
  where e.id = p_enrolment_id
    and e.class_id = p_class_id
  for update;

  if not found then
    raise exception 'The enrolment does not belong to the selected class';
  end if;
  if v_enrolment_status is distinct from 'enrolled'::public.enrolment_status then
    raise exception 'Attendance can only be recorded for an active enrolment';
  end if;

  select a.status
  into v_old_attendance_status
  from public.attendance a
  where a.enrolment_id = p_enrolment_id
    and a.session_id = v_session_id
  for update;

  -- Repeating the same manual mark is a no-op: preserve the original timestamp,
  -- recorder, and audit history.
  if found and v_old_attendance_status = v_attendance_status then
    return;
  end if;

  if v_scope = 'teacher'
     and exists (
       select 1
       from public.audit_log al
       where al.entity_type = 'class_session'
         and al.entity_id = v_session_id::text
         and al.action = 'attendance_roll_closed'
     ) then
    raise exception 'Today''s attendance roll is closed';
  end if;

  insert into public.attendance (
    enrolment_id,
    session_id,
    status,
    checked_in_at,
    checkin_method,
    recorded_by,
    updated_at
  ) values (
    p_enrolment_id,
    v_session_id,
    v_attendance_status,
    case
      when v_attendance_status in (
        'present'::public.attendance_status,
        'late'::public.attendance_status
      ) then v_now
      else null
    end,
    'manual',
    v_actor,
    v_now
  )
  on conflict (enrolment_id, session_id)
  do update set
    status = excluded.status,
    checked_in_at = excluded.checked_in_at,
    checkin_method = excluded.checkin_method,
    recorded_by = excluded.recorded_by,
    updated_at = excluded.updated_at;

  insert into public.audit_log (
    actor_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  ) values (
    v_actor,
    'attendance',
    p_enrolment_id::text,
    'manual_attendance',
    jsonb_build_object('status', v_old_attendance_status),
    jsonb_build_object(
      'class_id', p_class_id,
      'session_id', v_session_id,
      'status', v_attendance_status
    )
  );
end;
$$;

revoke execute on function public.admin_set_manual_attendance(uuid, uuid, text)
from public, anon;
grant execute on function public.admin_set_manual_attendance(uuid, uuid, text)
to authenticated, service_role;

create or replace function public.admin_close_today_roll(
  p_class_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_scope text := private.attendance_access_scope(p_class_id);
  v_session_id uuid;
  v_session_cancelled boolean;
  v_session_starts_at timestamptz;
  v_marked_enrolments uuid[] := '{}'::uuid[];
  v_now timestamptz := now();
begin
  perform v_scope;

  select s.session_id, s.session_cancelled, s.session_starts_at
  into v_session_id, v_session_cancelled, v_session_starts_at
  from public.admin_today_session(p_class_id) s;

  if v_session_cancelled then
    raise exception 'This session is cancelled';
  end if;
  if v_session_starts_at is not null and v_session_starts_at > v_now then
    raise exception 'The class session has not started yet';
  end if;

  -- The session row is locked by admin_today_session, so this check also
  -- serializes concurrent close attempts and guarantees one close audit row.
  if exists (
    select 1
    from public.audit_log al
    where al.entity_type = 'class_session'
      and al.entity_id = v_session_id::text
      and al.action = 'attendance_roll_closed'
  ) then
    return 0;
  end if;

  with inserted as (
    insert into public.attendance (
      enrolment_id,
      session_id,
      status,
      checkin_method,
      recorded_by
    )
    select
      e.id,
      v_session_id,
      'absent_unexcused'::public.attendance_status,
      'roll_close',
      v_actor
    from public.enrolments e
    where e.class_id = p_class_id
      and e.status = 'enrolled'::public.enrolment_status
      and e.enrolled_at <= coalesce(v_session_starts_at, v_now)
      and (
        e.reinstated_at is null
        or e.reinstated_at <= coalesce(v_session_starts_at, v_now)
      )
      and not exists (
        select 1
        from public.attendance a
        where a.enrolment_id = e.id
          and a.session_id = v_session_id
      )
    on conflict (enrolment_id, session_id) do nothing
    returning enrolment_id
  )
  select coalesce(array_agg(i.enrolment_id), '{}'::uuid[])
  into v_marked_enrolments
  from inserted i;

  insert into public.audit_log (
    actor_id,
    entity_type,
    entity_id,
    action,
    new_values
  ) values (
    v_actor,
    'class_session',
    v_session_id::text,
    'attendance_roll_closed',
    jsonb_build_object(
      'class_id', p_class_id,
      'marked_absent', cardinality(v_marked_enrolments),
      'enrolment_ids', to_jsonb(v_marked_enrolments)
    )
  );

  return cardinality(v_marked_enrolments);
end;
$$;

revoke execute on function public.admin_close_today_roll(uuid)
from public, anon;
grant execute on function public.admin_close_today_roll(uuid)
to authenticated, service_role;
