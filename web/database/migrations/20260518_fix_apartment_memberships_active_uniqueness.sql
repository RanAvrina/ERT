alter table if exists apartment_memberships
  drop constraint if exists apartment_memberships_unique_active_account;

drop index if exists apartment_memberships_one_active_account;

create unique index if not exists apartment_memberships_one_active_account
  on apartment_memberships(account_id)
  where status = 'active';
