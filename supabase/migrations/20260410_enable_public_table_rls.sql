-- These tables are accessed by the Node backend through a privileged Postgres
-- connection. Browser clients should not reach them through the Supabase Data API.
alter table if exists public.app_users enable row level security;
alter table if exists public.user_sessions enable row level security;
alter table if exists public.preference_sheets enable row level security;
alter table if exists public.search_history enable row level security;
alter table if exists public.favorite_restaurants enable row level security;
alter table if exists public.place_details_cache enable row level security;
alter table if exists public.visit_history enable row level security;
