-- Harden RLS after moving business data access to the Express server.
-- The frontend keeps using Supabase Auth, but apartment/business data should no longer
-- be read or written directly with the publishable key.

alter table accounts enable row level security;
alter table apartments enable row level security;
alter table apartment_memberships enable row level security;
alter table invites enable row level security;
alter table expenses enable row level security;
alter table expense_participants enable row level security;
alter table expense_attachments enable row level security;
alter table payments enable row level security;
alter table tasks enable row level security;
alter table shopping_lists enable row level security;
alter table shopping_items enable row level security;
alter table maintenance_tickets enable row level security;
alter table ticket_comments enable row level security;
alter table ticket_attachments enable row level security;
alter table apartment_info_items enable row level security;
alter table apartment_info_attachments enable row level security;

drop policy if exists accounts_dev_all_authenticated on accounts;
drop policy if exists accounts_dev_select_anon on accounts;
drop policy if exists apartments_dev_all_authenticated on apartments;
drop policy if exists apartments_dev_select_anon on apartments;
drop policy if exists apartment_memberships_dev_all_authenticated on apartment_memberships;
drop policy if exists apartment_memberships_dev_select_anon on apartment_memberships;
drop policy if exists invites_dev_all_authenticated on invites;
drop policy if exists invites_dev_select_anon on invites;
drop policy if exists expenses_dev_all_authenticated on expenses;
drop policy if exists expense_participants_dev_all_authenticated on expense_participants;
drop policy if exists expense_attachments_dev_all_authenticated on expense_attachments;
drop policy if exists payments_dev_all_authenticated on payments;
drop policy if exists tasks_dev_all_authenticated on tasks;
drop policy if exists shopping_lists_dev_all_authenticated on shopping_lists;
drop policy if exists shopping_items_dev_all_authenticated on shopping_items;
drop policy if exists maintenance_tickets_dev_all_authenticated on maintenance_tickets;
drop policy if exists ticket_comments_dev_all_authenticated on ticket_comments;
drop policy if exists ticket_attachments_dev_all_authenticated on ticket_attachments;
drop policy if exists apartment_info_items_dev_all_authenticated on apartment_info_items;
drop policy if exists apartment_info_attachments_dev_all_authenticated on apartment_info_attachments;

drop policy if exists accounts_self_select on accounts;
create policy accounts_self_select on accounts
  for select to authenticated
  using (
    lower(trim(email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  );

drop policy if exists accounts_self_update on accounts;

drop policy if exists apartment_memberships_self_select on apartment_memberships;
create policy apartment_memberships_self_select on apartment_memberships
  for select to authenticated
  using (
    account_id in (
      select id
      from accounts
      where lower(trim(email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
    )
  );
