-- Historischer Kartenatlas 2.0, optionale Supabase-Ausbaustufe
-- Noch nicht mit der App verbunden. Vor Nutzung im eigenen Supabase-Projekt ausführen.
create extension if not exists pgcrypto;

create table if not exists public.atlas_regions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  zoom integer not null default 12 check (zoom between 2 and 19),
  created_at timestamptz not null default now(),
  unique(owner_id, name)
);
create index if not exists atlas_regions_owner_idx on public.atlas_regions(owner_id);

create table if not exists public.atlas_maps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 220),
  region text not null check (char_length(region) between 1 and 100),
  year integer check (year between 1 and 2100),
  layer_type text not null default 'xyz' check (layer_type in ('xyz','tms','wms')),
  source_url text not null,
  layer_name text,
  detail_url text,
  provider text,
  is_favorite boolean not null default false,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists atlas_maps_owner_idx on public.atlas_maps(owner_id);

alter table public.atlas_regions enable row level security;
alter table public.atlas_maps enable row level security;

create policy "Select own atlas regions" on public.atlas_regions for select to authenticated using (owner_id = (select auth.uid()));
create policy "Insert own atlas regions" on public.atlas_regions for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Update own atlas regions" on public.atlas_regions for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Delete own atlas regions" on public.atlas_regions for delete to authenticated using (owner_id = (select auth.uid()));

create policy "Select own atlas maps" on public.atlas_maps for select to authenticated using (owner_id = (select auth.uid()));
create policy "Insert own atlas maps" on public.atlas_maps for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Update own atlas maps" on public.atlas_maps for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Delete own atlas maps" on public.atlas_maps for delete to authenticated using (owner_id = (select auth.uid()));
