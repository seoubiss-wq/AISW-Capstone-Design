create table if not exists public.visit_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  query text not null,
  personalization_applied text not null default '',
  name text not null,
  reason text not null default '',
  address text not null default '',
  image_url text not null default '',
  place_id text not null default '',
  category text not null default '',
  rating numeric(3,2),
  keywords jsonb not null default '[]'::jsonb,
  feature_tags jsonb not null default '[]'::jsonb,
  links jsonb not null default '{}'::jsonb,
  distance_km numeric(7,3),
  travel_duration text not null default '',
  route_summary text not null default '',
  source text not null default '',
  location_lat double precision,
  location_lng double precision,
  created_at timestamptz not null default timezone('utc', now()),
  constraint visit_history_query_length check (char_length(query) between 1 and 300),
  constraint visit_history_name_length check (char_length(name) between 1 and 120),
  constraint visit_history_rating_range check (
    rating is null or (rating >= 0 and rating <= 5)
  ),
  constraint visit_history_distance_nonnegative check (
    distance_km is null or distance_km >= 0
  ),
  constraint visit_history_lat_range check (
    location_lat is null or (location_lat >= -90 and location_lat <= 90)
  ),
  constraint visit_history_lng_range check (
    location_lng is null or (location_lng >= -180 and location_lng <= 180)
  )
);

create index if not exists visit_history_user_id_created_at_idx
  on public.visit_history (user_id, created_at desc);
