-- The AI replies on its own by default. Approval of every reply is the
-- opt-in: a brand switches autopilot off to get drafts instead.
alter table public.brand_profiles alter column autopilot set default true;
update public.brand_profiles set autopilot = true where autopilot = false;
