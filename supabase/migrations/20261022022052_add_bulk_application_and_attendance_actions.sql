-- Bulk administration remains atomic by delegating each selected record to the
-- existing, fully validated single-record workflows inside one transaction.

create or replace function public.admin_accept_applications_bulk(
  p_application_ids uuid[]
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_ids uuid[];
  v_application_id uuid;
  v_existing_note text;
  v_found_count integer;
  v_processed integer := 0;
begin
  if v_actor is null
     or coalesce(auth.jwt()->'app_metadata'->>'role', '')
       not in ('admin', 'super_admin') then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if p_application_ids is null or cardinality(p_application_ids) = 0 then
    raise exception 'Select at least one application';
  end if;

  if cardinality(p_application_ids) > 100 then
    raise exception 'A maximum of 100 applications can be updated at once';
  end if;

  if exists (
    select 1
    from unnest(p_application_ids) as selected(application_id)
    where selected.application_id is null
  ) then
    raise exception 'The selected applications are not valid';
  end if;

  select array_agg(selected.application_id order by selected.application_id)
  into v_ids
  from (
    select distinct application_id
    from unnest(p_application_ids) as requested(application_id)
  ) selected;

  select count(*)
  into v_found_count
  from public.applications a
  where a.id = any(v_ids);

  if v_found_count is distinct from cardinality(v_ids) then
    raise exception 'One or more selected applications could not be found';
  end if;

  -- Match the lock order used by the existing decision workflow: class first,
  -- then application. Lock every involved class in a deterministic order before
  -- validating the selected application rows so a concurrent decision cannot
  -- change their status or notes between validation and processing.
  perform c.id
  from public.classes c
  where c.id in (
    select distinct a.class_id
    from public.applications a
    where a.id = any(v_ids)
  )
  order by c.id
  for update;

  perform a.id
  from public.applications a
  where a.id = any(v_ids)
  order by a.class_id, a.submitted_at, a.id
  for update;

  select count(*)
  into v_found_count
  from public.applications a
  where a.id = any(v_ids)
    and a.status = 'pending'::public.application_status;

  if v_found_count is distinct from cardinality(v_ids) then
    raise exception 'One or more selected applications are no longer pending';
  end if;

  -- Process the oldest application first within each class. Grouping by class also
  -- gives concurrent batches a deterministic class-lock order.
  for v_application_id in
    select a.id
    from public.applications a
    where a.id = any(v_ids)
    order by a.class_id, a.submitted_at, a.id
  loop
    v_existing_note := null;
    select notes.admin_notes
    into v_existing_note
    from public.get_application_admin_notes(array[v_application_id]) notes
    where notes.application_id = v_application_id;

    perform public.admin_decide_application(
      v_application_id,
      'accepted',
      v_existing_note
    );
    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$$;

revoke execute on function public.admin_accept_applications_bulk(uuid[])
from public, anon, service_role;
grant execute on function public.admin_accept_applications_bulk(uuid[])
to authenticated;

create or replace function public.admin_set_manual_attendance_bulk(
  p_enrolment_ids uuid[],
  p_class_id uuid,
  p_status text
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_enrolment_id uuid;
begin
  if p_status not in ('present', 'late', 'absent_unexcused', 'absent_excused') then
    raise exception 'Unsupported attendance status';
  end if;

  if p_enrolment_ids is null or cardinality(p_enrolment_ids) = 0 then
    raise exception 'Select at least one student';
  end if;

  if cardinality(p_enrolment_ids) > 100 then
    raise exception 'A maximum of 100 students can be updated at once';
  end if;

  if exists (
    select 1
    from unnest(p_enrolment_ids) as selected(enrolment_id)
    where selected.enrolment_id is null
  ) then
    raise exception 'The selected enrolments are not valid';
  end if;

  select array_agg(selected.enrolment_id order by selected.enrolment_id)
  into v_ids
  from (
    select distinct enrolment_id
    from unnest(p_enrolment_ids) as requested(enrolment_id)
  ) selected;

  foreach v_enrolment_id in array v_ids loop
    perform public.admin_set_manual_attendance(
      v_enrolment_id,
      p_class_id,
      p_status
    );
  end loop;

  return cardinality(v_ids);
end;
$$;

revoke execute on function public.admin_set_manual_attendance_bulk(uuid[], uuid, text)
from public, anon;
grant execute on function public.admin_set_manual_attendance_bulk(uuid[], uuid, text)
to authenticated, service_role;
