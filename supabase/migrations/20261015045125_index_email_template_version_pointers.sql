-- Cover the composite foreign keys used for immutable active/default email
-- revision pointers. The table is small, but this also keeps FK maintenance
-- and future administrative lookups predictable.
create index email_templates_active_version_pointer_idx
on private.email_templates (template_key, active_version_id);

create index email_templates_default_version_pointer_idx
on private.email_templates (template_key, default_version_id);
