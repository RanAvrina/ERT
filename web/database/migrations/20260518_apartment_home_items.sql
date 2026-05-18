create table if not exists apartment_home_items (
  id bigserial primary key,
  apartment_id bigint not null references apartments(id) on delete cascade,
  item_key varchar(80) not null,
  area varchar(120) not null,
  name varchar(160) not null,
  default_note text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apartment_home_items_unique unique (apartment_id, item_key)
);

alter table apartment_home_items enable row level security;

drop policy if exists apartment_home_items_dev_all_authenticated on apartment_home_items;
