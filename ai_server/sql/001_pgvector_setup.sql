create extension if not exists vector with schema extensions;

alter table if exists public.food_general_restaurants_quarter
  add column if not exists embedding_e5 extensions.vector(1024);

create index if not exists idx_food_general_restaurants_quarter_embedding_e5
  on public.food_general_restaurants_quarter
  using hnsw (embedding_e5 extensions.vector_cosine_ops);

create or replace function public.clear_food_general_restaurants_quarter_embedding_e5()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.embedding_e5 = null;
  return new;
end;
$$;

drop trigger if exists clear_embedding_e5_on_food_general_restaurants_quarter
  on public.food_general_restaurants_quarter;

create trigger clear_embedding_e5_on_food_general_restaurants_quarter
before update of
  business_name,
  business_type_name,
  sanitation_business_type_name,
  road_address,
  lot_address,
  grade_name,
  business_status_name,
  detailed_business_status_name
on public.food_general_restaurants_quarter
for each row
when (
  old.business_name is distinct from new.business_name
  or old.business_type_name is distinct from new.business_type_name
  or old.sanitation_business_type_name is distinct from new.sanitation_business_type_name
  or old.road_address is distinct from new.road_address
  or old.lot_address is distinct from new.lot_address
  or old.grade_name is distinct from new.grade_name
  or old.business_status_name is distinct from new.business_status_name
  or old.detailed_business_status_name is distinct from new.detailed_business_status_name
)
execute function public.clear_food_general_restaurants_quarter_embedding_e5();
