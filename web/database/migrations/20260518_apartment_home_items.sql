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

insert into apartment_home_items (apartment_id, item_key, area, name, default_note)
select
  apartments.id,
  defaults.item_key,
  defaults.area,
  defaults.name,
  defaults.default_note
from apartments
cross join (
  values
    ('bathroom-cleaning', 'שירותים ומקלחת', 'ניקיון שירותים', 'לנקות אסלה, כיור ורצפה. להשאיר חלון פתוח לאוורור אחרי ניקוי.'),
    ('kitchen-cleaning', 'מטבח', 'ניקיון מטבח', 'לנקות משטחי עבודה, כיריים ורצפה. להשאיר את אזור הכיור יבש בסיום.')
) as defaults(item_key, area, name, default_note)
on conflict (apartment_id, item_key) do nothing;

alter table apartment_home_items enable row level security;

drop policy if exists apartment_home_items_dev_all_authenticated on apartment_home_items;
