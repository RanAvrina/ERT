-- ERT database foundation schema
-- Prepared from the current frontend data model and business rules.
-- This file is a backend-ready reference only; the app still runs on localStorage.

create table if not exists accounts (
  id bigserial primary key,
  full_name varchar(120) not null,
  email varchar(255) not null,
  phone varchar(32),
  password_hash text not null,
  status varchar(16) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_status_check check (status in ('active', 'inactive'))
);

create unique index if not exists accounts_email_unique
  on accounts ((lower(trim(email))));

create table if not exists apartments (
  id bigserial primary key,
  name varchar(160) not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists apartment_memberships (
  id bigserial primary key,
  apartment_id bigint not null references apartments(id) on delete cascade,
  account_id bigint not null references accounts(id) on delete cascade,
  role varchar(16) not null,
  status varchar(16) not null default 'active',
  joined_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint apartment_memberships_role_check check (role in ('admin', 'tenant', 'landlord')),
  constraint apartment_memberships_status_check check (status in ('active', 'inactive')),
  constraint apartment_memberships_unique_active_account unique (account_id, status)
);

create unique index if not exists apartment_memberships_one_active_admin_per_apartment
  on apartment_memberships(apartment_id)
  where role = 'admin' and status = 'active';

create unique index if not exists apartment_memberships_one_active_landlord_per_apartment
  on apartment_memberships(apartment_id)
  where role = 'landlord' and status = 'active';

create table if not exists invites (
  id bigserial primary key,
  apartment_id bigint not null references apartments(id) on delete cascade,
  invited_role varchar(16) not null,
  token varchar(255) not null unique,
  status varchar(16) not null default 'active',
  created_by_account_id bigint not null references accounts(id),
  accepted_by_account_id bigint references accounts(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  expires_at timestamptz,
  constraint invites_role_check check (invited_role in ('tenant', 'landlord')),
  constraint invites_status_check check (status in ('active', 'accepted', 'expired', 'cancelled'))
);

create table if not exists expenses (
  id bigserial primary key,
  apartment_id bigint not null references apartments(id) on delete cascade,
  paid_by_membership_id bigint not null references apartment_memberships(id),
  amount numeric(12, 2) not null,
  description varchar(255) not null,
  category varchar(80),
  expense_date date not null,
  status varchar(16) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_amount_positive check (amount > 0),
  constraint expenses_status_check check (status in ('active', 'deleted'))
);

create table if not exists expense_participants (
  id bigserial primary key,
  expense_id bigint not null references expenses(id) on delete cascade,
  membership_id bigint not null references apartment_memberships(id),
  share_amount numeric(12, 2),
  created_at timestamptz not null default now(),
  constraint expense_participants_unique unique (expense_id, membership_id)
);

create table if not exists expense_attachments (
  id uuid primary key,
  expense_id bigint not null references expenses(id) on delete cascade,
  file_name varchar(255) not null,
  file_type varchar(120) not null,
  file_size bigint not null,
  file_url text not null,
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id bigserial primary key,
  apartment_id bigint not null references apartments(id) on delete cascade,
  payer_membership_id bigint not null references apartment_memberships(id),
  payee_membership_id bigint not null references apartment_memberships(id),
  amount numeric(12, 2) not null,
  status varchar(16) not null default 'recorded',
  payment_date timestamptz not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_amount_positive check (amount > 0),
  constraint payments_status_check check (status in ('recorded', 'cancelled'))
);

create table if not exists tasks (
  id bigserial primary key,
  apartment_id bigint not null references apartments(id) on delete cascade,
  title varchar(255) not null,
  description text,
  assignee_membership_id bigint references apartment_memberships(id),
  due_date date,
  status varchar(24) not null default 'open',
  created_by_membership_id bigint not null references apartment_memberships(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_status_check check (status in ('open', 'in_progress', 'done', 'cancelled'))
);

create table if not exists shopping_lists (
  id bigserial primary key,
  apartment_id bigint not null references apartments(id) on delete cascade,
  title varchar(160) not null,
  status varchar(24) not null default 'active',
  created_by_membership_id bigint not null references apartment_memberships(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shopping_lists_status_check check (status in ('active', 'completed', 'cancelled'))
);

create table if not exists shopping_items (
  id bigserial primary key,
  apartment_id bigint not null references apartments(id) on delete cascade,
  shopping_list_id bigint not null references shopping_lists(id) on delete cascade,
  item_name varchar(255) not null,
  quantity varchar(80),
  category varchar(80),
  status varchar(24) not null default 'open',
  added_by_membership_id bigint not null references apartment_memberships(id),
  purchased_by_membership_id bigint references apartment_memberships(id),
  created_at timestamptz not null default now(),
  purchased_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint shopping_items_status_check check (status in ('open', 'purchased', 'cancelled'))
);

create table if not exists maintenance_tickets (
  id bigserial primary key,
  apartment_id bigint not null references apartments(id) on delete cascade,
  title varchar(255) not null,
  description text not null,
  category varchar(32) not null,
  status varchar(32) not null default 'open',
  created_by_membership_id bigint not null references apartment_memberships(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_tickets_category_check check (category in ('issue', 'request', 'finance', 'other')),
  constraint maintenance_tickets_status_check check (status in ('open', 'sent_to_landlord', 'in_progress', 'closed', 'cancelled'))
);

create table if not exists ticket_comments (
  id bigserial primary key,
  ticket_id bigint not null references maintenance_tickets(id) on delete cascade,
  membership_id bigint not null references apartment_memberships(id),
  comment_text text not null,
  created_at timestamptz not null default now()
);

create table if not exists ticket_attachments (
  id uuid primary key,
  ticket_id bigint not null references maintenance_tickets(id) on delete cascade,
  file_name varchar(255) not null,
  file_type varchar(120) not null,
  file_size bigint not null,
  file_url text not null,
  created_at timestamptz not null default now()
);

create table if not exists apartment_info_items (
  id bigserial primary key,
  apartment_id bigint not null references apartments(id) on delete cascade,
  title varchar(255) not null,
  category_label varchar(120),
  provider varchar(160),
  meter_number varchar(120),
  account_number varchar(120),
  phone varchar(32),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists apartment_info_attachments (
  id uuid primary key,
  apartment_info_item_id bigint not null references apartment_info_items(id) on delete cascade,
  file_name varchar(255) not null,
  file_type varchar(120) not null,
  file_size bigint not null,
  file_url text not null,
  created_at timestamptz not null default now()
);

-- Temporary development RLS policies for direct frontend access via Supabase publishable key.
-- Tighten these before production and replace them with membership-aware policies.

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
create policy accounts_dev_all_authenticated on accounts
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists apartments_dev_all_authenticated on apartments;
create policy apartments_dev_all_authenticated on apartments
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists apartment_memberships_dev_all_authenticated on apartment_memberships;
create policy apartment_memberships_dev_all_authenticated on apartment_memberships
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists invites_dev_all_authenticated on invites;
create policy invites_dev_all_authenticated on invites
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists invites_dev_select_anon on invites;
create policy invites_dev_select_anon on invites
  for select to anon
  using (true);

drop policy if exists apartments_dev_select_anon on apartments;
create policy apartments_dev_select_anon on apartments
  for select to anon
  using (true);

drop policy if exists apartment_memberships_dev_select_anon on apartment_memberships;
create policy apartment_memberships_dev_select_anon on apartment_memberships
  for select to anon
  using (true);

drop policy if exists accounts_dev_select_anon on accounts;
create policy accounts_dev_select_anon on accounts
  for select to anon
  using (true);

drop policy if exists expenses_dev_all_authenticated on expenses;
create policy expenses_dev_all_authenticated on expenses
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists expense_participants_dev_all_authenticated on expense_participants;
create policy expense_participants_dev_all_authenticated on expense_participants
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists expense_attachments_dev_all_authenticated on expense_attachments;
create policy expense_attachments_dev_all_authenticated on expense_attachments
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists payments_dev_all_authenticated on payments;
create policy payments_dev_all_authenticated on payments
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists tasks_dev_all_authenticated on tasks;
create policy tasks_dev_all_authenticated on tasks
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists shopping_lists_dev_all_authenticated on shopping_lists;
create policy shopping_lists_dev_all_authenticated on shopping_lists
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists shopping_items_dev_all_authenticated on shopping_items;
create policy shopping_items_dev_all_authenticated on shopping_items
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists maintenance_tickets_dev_all_authenticated on maintenance_tickets;
create policy maintenance_tickets_dev_all_authenticated on maintenance_tickets
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists ticket_comments_dev_all_authenticated on ticket_comments;
create policy ticket_comments_dev_all_authenticated on ticket_comments
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists ticket_attachments_dev_all_authenticated on ticket_attachments;
create policy ticket_attachments_dev_all_authenticated on ticket_attachments
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists apartment_info_items_dev_all_authenticated on apartment_info_items;
create policy apartment_info_items_dev_all_authenticated on apartment_info_items
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists apartment_info_attachments_dev_all_authenticated on apartment_info_attachments;
create policy apartment_info_attachments_dev_all_authenticated on apartment_info_attachments
  for all to authenticated
  using (true)
  with check (true);
