-- Teacher attendance must fail closed when a class schedule is incomplete.
-- Administrators and the service role retain their existing operational scope.

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
  v_today date := (now() at time zone 'Australia/Sydney')::date;
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
         and c.active = true
         and c.day_of_week is not null
         and c.start_time is not null
         and c.end_time is not null
         and c.day_of_week = extract(dow from v_today)::smallint
         and (c.starts_on is null or v_today >= c.starts_on)
         and (c.ends_on is null or v_today <= c.ends_on)
     ) then
    return 'teacher';
  end if;

  raise exception 'Teacher attendance is not available for this class today'
    using errcode = '42501';
end;
$$;

revoke all on function private.attendance_access_scope(uuid)
from public, anon, authenticated;

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
        and c.day_of_week is not null
        and c.start_time is not null
        and c.end_time is not null
        and c.day_of_week = extract(dow from v_today)::smallint
        and (c.starts_on is null or v_today >= c.starts_on)
        and (c.ends_on is null or v_today <= c.ends_on)
      )
    )
  order by c.name, p.last_name nulls last, p.first_name nulls last;
end;
$$;

revoke execute on function public.attendance_staff_today_roster()
from public, anon;
grant execute on function public.attendance_staff_today_roster()
to authenticated, service_role;
