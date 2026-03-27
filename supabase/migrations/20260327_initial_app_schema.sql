create extension if not exists "uuid-ossp" with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint app_users_email_lowercase check (email = lower(email)),
  constraint app_users_email_length check (char_length(email) between 3 and 320),
  constraint app_users_name_length check (char_length(name) between 1 and 80)
);

create unique index if not exists app_users_email_key
  on public.app_users (email);

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists user_sessions_token_key
  on public.user_sessions (token);

create index if not exists user_sessions_user_id_idx
  on public.user_sessions (user_id);

create index if not exists user_sessions_expires_at_idx
  on public.user_sessions (expires_at);

create table if not exists public.preference_sheets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  name text not null,
  favorite_cuisine text not null default '',
  mood text not null default '',
  budget text not null default '',
  max_distance_km numeric(5,2),
  avoid_ingredients text not null default '',
  is_active boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint preference_sheets_name_length check (char_length(name) between 1 and 40),
  constraint preference_sheets_max_distance_range check (
    max_distance_km is null or (max_distance_km > 0 and max_distance_km <= 100)
  )
);

create index if not exists preference_sheets_user_id_idx
  on public.preference_sheets (user_id);

create unique index if not exists preference_sheets_one_active_per_user_idx
  on public.preference_sheets (user_id)
  where is_active = true;

create table if not exists public.search_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  query text not null,
  personalization_applied text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  constraint search_history_query_length check (char_length(query) between 1 and 300)
);

create index if not exists search_history_user_id_created_at_idx
  on public.search_history (user_id, created_at desc);

create table if not exists public.favorite_restaurants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  place_id text not null default '',
  name text not null,
  reason text not null default '',
  address text not null default '',
  image_url text not null default '',
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
  updated_at timestamptz not null default timezone('utc', now()),
  constraint favorite_restaurants_name_length check (char_length(name) between 1 and 120),
  constraint favorite_restaurants_rating_range check (
    rating is null or (rating >= 0 and rating <= 5)
  ),
  constraint favorite_restaurants_distance_nonnegative check (
    distance_km is null or distance_km >= 0
  ),
  constraint favorite_restaurants_lat_range check (
    location_lat is null or (location_lat >= -90 and location_lat <= 90)
  ),
  constraint favorite_restaurants_lng_range check (
    location_lng is null or (location_lng >= -180 and location_lng <= 180)
  )
);

create index if not exists favorite_restaurants_user_id_created_at_idx
  on public.favorite_restaurants (user_id, created_at desc);

create unique index if not exists favorite_restaurants_user_place_id_key
  on public.favorite_restaurants (user_id, place_id)
  where place_id <> '';

create unique index if not exists favorite_restaurants_user_name_key
  on public.favorite_restaurants (user_id, lower(name))
  where place_id = '';

create table if not exists public.place_details_cache (
  place_id text primary key,
  name text not null default '',
  formatted_address text not null default '',
  formatted_phone_number text not null default '',
  international_phone_number text not null default '',
  website text not null default '',
  google_maps_url text not null default '',
  price_level integer,
  rating numeric(3,2),
  user_rating_count integer,
  editorial_summary text not null default '',
  business_status text not null default '',
  regular_opening_hours jsonb not null default '[]'::jsonb,
  current_opening_hours jsonb not null default '[]'::jsonb,
  reviews jsonb not null default '[]'::jsonb,
  amenities jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint place_details_cache_place_id_length check (char_length(place_id) between 1 and 200),
  constraint place_details_cache_price_level_range check (
    price_level is null or (price_level >= 0 and price_level <= 4)
  ),
  constraint place_details_cache_rating_range check (
    rating is null or (rating >= 0 and rating <= 5)
  ),
  constraint place_details_cache_rating_count_nonnegative check (
    user_rating_count is null or user_rating_count >= 0
  )
);

drop trigger if exists set_updated_at_on_app_users on public.app_users;
create trigger set_updated_at_on_app_users
before update on public.app_users
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_on_preference_sheets on public.preference_sheets;
create trigger set_updated_at_on_preference_sheets
before update on public.preference_sheets
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_on_favorite_restaurants on public.favorite_restaurants;
create trigger set_updated_at_on_favorite_restaurants
before update on public.favorite_restaurants
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_on_place_details_cache on public.place_details_cache;
create trigger set_updated_at_on_place_details_cache
before update on public.place_details_cache
for each row
execute function public.set_updated_at();
