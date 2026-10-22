-- The dedicated scanner needs class choices and aggregate progress only.
-- Keep student identities and individual attendance records out of its query.

create or replace function public.attendance_staff_today_scanner_classes()
returns table (
  class_id uuid,
  class_name text,
  class_term text,
  class_location text,
  class_day_of_week smallint,
  class_start_time time,
  class_end_time time,
  session_cancelled boolean,
  enrolled_count bigint,
  checked_in_count bigint
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
    coalesce(cs.cancelled, false),
    count(e.id),
    count(a.enrolment_id) filter (
      where a.status in (
        'present'::public.attendance_status,
        'late'::public.attendance_status
      )
    )
  from public.classes c
  left join public.class_sessions cs
    on cs.class_id = c.id
   and cs.session_date = v_today
  left join public.enrolments e
    on e.class_id = c.id
   and e.status = 'enrolled'::public.enrolment_status
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
  group by
    c.id,
    c.name,
    c.term,
    c.location,
    c.day_of_week,
    c.start_time,
    c.end_time,
    cs.cancelled
  order by c.name;
end;
$$;

revoke execute on function public.attendance_staff_today_scanner_classes()
from public, anon;
grant execute on function public.attendance_staff_today_scanner_classes()
to authenticated, service_role;
