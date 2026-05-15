-- Normalize maintenance ticket statuses to the 3-state model used by the UI and API.

update maintenance_tickets
set status = 'in_progress'
where status = 'sent_to_landlord';

update maintenance_tickets
set status = 'closed'
where status = 'cancelled';

alter table maintenance_tickets
  drop constraint if exists maintenance_tickets_status_check;

alter table maintenance_tickets
  add constraint maintenance_tickets_status_check
  check (status in ('open', 'in_progress', 'closed'));
