-- Add class schedule/calendar context to future email queue records and create
-- immutable message revisions for the user-requested sign-off and active-class
-- guidance. Existing queued/prepared deliveries remain pinned and unchanged.

-- Keep the administrator's Restore default action aligned with the current
-- product defaults without mutating any immutable historical revision.
alter table private.email_templates
  add column default_version_id uuid;

update private.email_templates t
set default_version_id = v.id
from private.email_template_versions v
where v.template_key = t.template_key
  and v.is_default;

alter table private.email_templates
  alter column default_version_id set not null;

alter table private.email_templates
  add constraint email_templates_default_version_same_template_fk
  foreign key (template_key, default_version_id)
  references private.email_template_versions(template_key, id)
  on delete restrict;

create or replace function private.enqueue_email_delivery_v1(
  p_source_kind text,
  p_source_id uuid,
  p_template_key text,
  p_student_id uuid,
  p_notification_id uuid default null,
  p_application_id uuid default null,
  p_enrolment_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first_name text;
  v_recipient_email text;
  v_class_id uuid;
  v_class_name text;
  v_class_term text;
  v_class_location text;
  v_class_starts_on date;
  v_class_ends_on date;
  v_class_day smallint;
  v_class_start time;
  v_class_end time;
  v_waitlist_position integer;
  v_dispatch_status text;
  v_template_revision_id uuid;
begin
  if p_source_id is null
     or p_student_id is null
     or (
       (
         p_source_kind = 'account'
         and p_template_key = 'account_welcome'
         and p_source_id = p_student_id
         and p_notification_id is null
         and p_application_id is null
         and p_enrolment_id is null
       )
       or (
         p_source_kind = 'application'
         and p_template_key = 'application_received'
         and p_application_id is not null
         and p_application_id = p_source_id
         and p_notification_id is null
         and p_enrolment_id is null
       )
       or (
         p_source_kind = 'notification'
         and p_notification_id is not null
         and p_notification_id = p_source_id
         and (
           (
             p_template_key in (
               'application_accepted',
               'application_waitlisted',
               'application_declined'
             )
             and p_application_id is not null
           )
           or (
             p_template_key in (
               'enrolment_suspended',
               'enrolment_reinstated'
             )
             and p_enrolment_id is not null
           )
         )
       )
     ) is not true then
    raise exception 'Invalid email outbox source';
  end if;

  select t.active_version_id
  into v_template_revision_id
  from private.email_templates t
  where t.template_key = p_template_key;

  if v_template_revision_id is null then
    raise exception 'Active email template not found';
  end if;

  select
    nullif(btrim(p.first_name), ''),
    nullif(lower(btrim(p.email)), ''),
    c.id,
    c.name,
    c.term,
    c.location,
    c.starts_on,
    c.ends_on,
    c.day_of_week,
    c.start_time,
    c.end_time,
    a.waitlist_position
  into
    v_first_name,
    v_recipient_email,
    v_class_id,
    v_class_name,
    v_class_term,
    v_class_location,
    v_class_starts_on,
    v_class_ends_on,
    v_class_day,
    v_class_start,
    v_class_end,
    v_waitlist_position
  from public.profiles p
  left join public.applications a on a.id = p_application_id
  left join public.enrolments e on e.id = p_enrolment_id
  left join public.classes c on c.id = coalesce(a.class_id, e.class_id)
  where p.id = p_student_id;

  if not found then
    raise exception 'Email outbox student not found';
  end if;

  v_dispatch_status := case
    when v_recipient_email is null then 'blocked'
    else 'queued'
  end;

  insert into private.email_deliveries (
    source_kind,
    source_id,
    notification_id,
    application_id,
    enrolment_id,
    student_id,
    template_key,
    template_revision_id,
    recipient_email,
    template_payload,
    dispatch_status,
    last_error_code,
    last_error_message
  ) values (
    p_source_kind,
    p_source_id,
    p_notification_id,
    p_application_id,
    p_enrolment_id,
    p_student_id,
    p_template_key,
    v_template_revision_id,
    v_recipient_email,
    jsonb_strip_nulls(jsonb_build_object(
      'first_name', coalesce(v_first_name, 'Student'),
      'class_id', v_class_id,
      'class_name', v_class_name,
      'class_term', v_class_term,
      'class_location', v_class_location,
      'class_starts_on', v_class_starts_on,
      'class_ends_on', v_class_ends_on,
      'class_day_of_week', v_class_day,
      'class_start_time', v_class_start,
      'class_end_time', v_class_end,
      'waitlist_position', v_waitlist_position
    )),
    v_dispatch_status,
    case when v_recipient_email is null then 'recipient_missing' end,
    case when v_recipient_email is null
      then 'No student email address was available when this event was queued.'
    end
  )
  on conflict (source_kind, source_id, template_key) do nothing;
end;
$$;

revoke all on function private.enqueue_email_delivery_v1(
  text, uuid, text, uuid, uuid, uuid, uuid
)
from public, anon, authenticated, service_role;

do $$
declare
  v_template_key text;
  v_active_revision_id uuid;
  v_active_version integer;
  v_current_body text;
  v_expected_version integer;
  v_expected_body text;
  v_new_body text;
  v_new_button_label text;
  v_subject text;
  v_preview text;
  v_heading text;
  v_button_label text;
  v_allowed_variables text[];
  v_new_revision_id uuid;
begin
  -- Lock in a stable order and abort rather than overwrite any intervening
  -- administrator edit.
  perform 1
  from private.email_templates t
  where t.template_key in (
    'account_welcome',
    'application_received',
    'application_accepted',
    'application_waitlisted',
    'application_declined',
    'enrolment_suspended',
    'enrolment_reinstated'
  )
  order by t.template_key
  for update;

  update private.email_templates
  set allowed_variables = array[
        'first_name', 'class_name', 'class_term', 'class_label',
        'class_day', 'class_time', 'class_schedule',
        'class_calendar_guidance', 'student_portal_url'
      ]::text[]
  where template_key in ('application_accepted', 'enrolment_reinstated');

  foreach v_template_key in array array[
    'account_welcome',
    'application_received',
    'application_accepted',
    'application_waitlisted',
    'application_declined',
    'enrolment_suspended',
    'enrolment_reinstated'
  ]::text[] loop
    select
      t.active_version_id,
      v.version_number,
      v.body_template,
      v.subject_template,
      v.preview_template,
      v.heading_template,
      v.button_label,
      t.allowed_variables
    into
      v_active_revision_id,
      v_active_version,
      v_current_body,
      v_subject,
      v_preview,
      v_heading,
      v_button_label,
      v_allowed_variables
    from private.email_templates t
    join private.email_template_versions v
      on v.id = t.active_version_id
     and v.template_key = t.template_key
    where t.template_key = v_template_key;

    if not found then
      raise exception 'Email template % was not found', v_template_key;
    end if;

    case v_template_key
      when 'account_welcome' then
        v_expected_version := 1;
        v_expected_body := $template$Assalamu alaikum {{first_name}},

Your email address has been confirmed and your ASWJ College student account is ready.

You can now sign in, apply for available classes and view your application updates in the Student Portal.$template$;
        v_new_body := v_expected_body || E'\n\nJazzakom Allahu Khaira\nASWJ College';
      when 'application_received' then
        v_expected_version := 1;
        v_expected_body := $template$Assalamu alaikum {{first_name}},

We have received your application for {{class_label}}.

It is now awaiting an administrator review. We will send another update when a decision is recorded.$template$;
        v_new_body := $template$Assalamu alaikum {{first_name}},

We have received and are processing your application for {{class_label}}. You will receive further instructions shortly Inn Shaa Allah.

Jazzakom Allahu Khaira
ASWJ College$template$;
      when 'application_accepted' then
        v_expected_version := 2;
        v_expected_body := $template$Assalamu alaikum {{first_name}},

Your application for {{class_label}} has been accepted.

Open your Student Pass to add it to Apple Wallet or Google Wallet. Your active enrolment and class details are also available in the Student Portal.$template$;
        v_new_body := $template$Assalamu alaikum {{first_name}},

Your application for {{class_label}} has been accepted.

Class day and time: {{class_schedule}}.

{{class_calendar_guidance}}

On an iPhone, select Open Student Pass below, sign in, then select Add to Apple Wallet.

Jazzakom Allahu Khaira
ASWJ College$template$;
      when 'application_waitlisted' then
        v_expected_version := 1;
        v_expected_body := $template$Assalamu alaikum {{first_name}},

You have been placed on the waiting list for {{class_label}}.{{waitlist_position_text}}

The Student Portal will show your latest application status.$template$;
        v_new_body := v_expected_body || E'\n\nJazzakom Allahu Khaira\nASWJ College';
      when 'application_declined' then
        v_expected_version := 1;
        v_expected_body := $template$Assalamu alaikum {{first_name}},

A place was not offered for your application to {{class_label}}.

If you need more information, reply to this email to contact administration.$template$;
        v_new_body := v_expected_body || E'\n\nJazzakom Allahu Khaira\nASWJ College';
      when 'enrolment_suspended' then
        v_expected_version := 1;
        v_expected_body := $template$Assalamu alaikum {{first_name}},

Your enrolment in {{class_label}} has been suspended.

Sign in to the Student Portal for your current enrolment status, or reply to this email to contact administration.$template$;
        v_new_body := v_expected_body || E'\n\nJazzakom Allahu Khaira\nASWJ College';
      when 'enrolment_reinstated' then
        v_expected_version := 1;
        v_expected_body := $template$Assalamu alaikum {{first_name}},

Your enrolment in {{class_label}} has been reinstated and is active again.

Your current enrolment and class details are available in the Student Portal.$template$;
        v_new_body := $template$Assalamu alaikum {{first_name}},

Your enrolment in {{class_label}} has been reinstated and is active again.

Class day and time: {{class_schedule}}.

{{class_calendar_guidance}}

On an iPhone, select Open Student Pass below, sign in, then select Add to Apple Wallet. You can re-add the pass if needed.

Jazzakom Allahu Khaira
ASWJ College$template$;
      else
        raise exception 'Unexpected email template %', v_template_key;
    end case;

    -- The application-received copy was already amended directly in dev.
    -- Preserve it when exact; encode the same revision for clean replays.
    if v_template_key = 'application_received' and v_current_body = v_new_body then
      if v_active_version <> 2 then
        raise exception 'Application received copy has an unexpected version';
      end if;
      update private.email_templates
      set default_version_id = v_active_revision_id
      where template_key = v_template_key;
      continue;
    end if;

    if v_active_version <> v_expected_version or v_current_body <> v_expected_body then
      raise exception 'Email template % changed before migration', v_template_key;
    end if;

    v_new_button_label := case
      when v_template_key = 'enrolment_reinstated' then 'Open Student Pass'
      else v_button_label
    end;

    perform private.validate_email_template_content_v1(
      v_allowed_variables,
      v_subject,
      v_preview,
      v_heading,
      v_new_body,
      v_new_button_label
    );

    insert into private.email_template_versions (
      template_key,
      version_number,
      subject_template,
      preview_template,
      heading_template,
      body_template,
      button_label,
      is_default,
      created_by
    ) values (
      v_template_key,
      v_active_version + 1,
      v_subject,
      v_preview,
      v_heading,
      v_new_body,
      v_new_button_label,
      false,
      null
    )
    returning id into v_new_revision_id;

    update private.email_templates
    set active_version_id = v_new_revision_id,
        default_version_id = v_new_revision_id,
        updated_by = null,
        updated_at = now()
    where template_key = v_template_key;

    insert into public.audit_log (
      actor_id,
      entity_type,
      entity_id,
      action,
      old_values,
      new_values
    ) values (
      null,
      'email_template',
      v_template_key,
      'email_template_updated',
      jsonb_build_object(
        'revision_id', v_active_revision_id,
        'version', v_active_version
      ),
      jsonb_build_object(
        'revision_id', v_new_revision_id,
        'version', v_active_version + 1,
        'source', 'migration_user_request'
      )
    );
  end loop;
end;
$$;

create or replace function private.admin_reset_email_template_v1(
  p_template_key text,
  p_expected_version integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_active_revision_id uuid;
  v_active_version integer;
  v_default_revision_id uuid;
  v_default_version integer;
  v_default_subject text;
  v_default_preview text;
  v_default_heading text;
  v_default_body text;
  v_default_button text;
  v_new_revision_id uuid;
  v_new_version integer;
begin
  if v_actor is null
     or coalesce(auth.jwt()->'app_metadata'->>'role', '')
       not in ('admin', 'super_admin') then
    raise exception 'Administrator access required'
      using errcode = '42501';
  end if;

  select t.active_version_id, v.version_number
  into v_active_revision_id, v_active_version
  from private.email_templates t
  join private.email_template_versions v
    on v.id = t.active_version_id
   and v.template_key = t.template_key
  where t.template_key = p_template_key
  for update of t;

  if not found then
    raise exception 'Email template not found';
  end if;

  if p_expected_version is null or p_expected_version <> v_active_version then
    return false;
  end if;

  select
    v.id,
    v.version_number,
    v.subject_template,
    v.preview_template,
    v.heading_template,
    v.body_template,
    v.button_label
  into
    v_default_revision_id,
    v_default_version,
    v_default_subject,
    v_default_preview,
    v_default_heading,
    v_default_body,
    v_default_button
  from private.email_templates t
  join private.email_template_versions v
    on v.id = t.default_version_id
   and v.template_key = t.template_key
  where t.template_key = p_template_key;

  if not found then
    raise exception 'Default email template revision not found';
  end if;

  select coalesce(max(v.version_number), 0) + 1
  into v_new_version
  from private.email_template_versions v
  where v.template_key = p_template_key;

  insert into private.email_template_versions (
    template_key,
    version_number,
    subject_template,
    preview_template,
    heading_template,
    body_template,
    button_label,
    is_default,
    created_by
  ) values (
    p_template_key,
    v_new_version,
    v_default_subject,
    v_default_preview,
    v_default_heading,
    v_default_body,
    v_default_button,
    false,
    v_actor
  )
  returning id into v_new_revision_id;

  update private.email_templates t
  set active_version_id = v_new_revision_id,
      updated_by = v_actor,
      updated_at = now()
  where t.template_key = p_template_key;

  insert into public.audit_log (
    actor_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  ) values (
    v_actor,
    'email_template',
    p_template_key,
    'email_template_reset',
    jsonb_build_object(
      'revision_id', v_active_revision_id,
      'version', v_active_version
    ),
    jsonb_build_object(
      'revision_id', v_new_revision_id,
      'version', v_new_version,
      'copied_from_default_revision_id', v_default_revision_id,
      'copied_from_default_version', v_default_version
    )
  );

  return true;
end;
$$;

revoke all on function private.admin_reset_email_template_v1(text, integer)
from public, anon, authenticated, service_role;
grant execute on function private.admin_reset_email_template_v1(text, integer)
to authenticated;
