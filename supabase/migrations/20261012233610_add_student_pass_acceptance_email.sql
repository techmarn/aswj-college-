-- Give future application-accepted emails an explicit Student Pass action.
-- Historical revisions and already prepared deliveries remain unchanged.

do $$
declare
  v_active_version integer;
  v_new_revision_id uuid;
begin
  select v.version_number
  into v_active_version
  from private.email_templates t
  join private.email_template_versions v
    on v.id = t.active_version_id
   and v.template_key = t.template_key
  where t.template_key = 'application_accepted'
  for update of t;

  if not found then
    raise exception 'Application accepted email template not found';
  end if;

  if v_active_version <> 1 then
    raise exception 'Application accepted email template changed before migration';
  end if;

  insert into private.email_template_versions (
    template_key,
    version_number,
    subject_template,
    preview_template,
    heading_template,
    body_template,
    button_label,
    is_default
  ) values (
    'application_accepted',
    2,
    'Your ASWJ College application was accepted',
    'Your application for {{class_label}} has been accepted.',
    'Application accepted',
    $template$Assalamu alaikum {{first_name}},

Your application for {{class_label}} has been accepted.

Open your Student Pass to add it to Apple Wallet or Google Wallet. Your active enrolment and class details are also available in the Student Portal.$template$,
    'Open Student Pass',
    false
  )
  returning id into v_new_revision_id;

  update private.email_templates
  set active_version_id = v_new_revision_id,
      updated_by = null,
      updated_at = now()
  where template_key = 'application_accepted';
end;
$$;
