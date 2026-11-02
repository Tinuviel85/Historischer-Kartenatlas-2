-- Historischer Kartenatlas 2.0: private synchronisierte Benutzerbibliotheken
-- Im SQL Editor des eigenen Supabase-Projekts einmalig ausführen.
create table if not exists public.atlas_user_libraries (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  library jsonb not null default '{"version":2,"regions":[],"custom":[],"overrides":{},"hidden":[],"favorites":[]}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint atlas_library_structure check (
    jsonb_typeof(library)='object'
    and library->>'version'='2'
    and jsonb_typeof(library->'regions')='array'
    and jsonb_typeof(library->'custom')='array'
  ),
  constraint atlas_library_size check (octet_length(library::text) < 2500000)
);

alter table public.atlas_user_libraries enable row level security;

-- Supabase Auth's user id scopes every row. Visitors cannot read other users' maps.
create policy "owner_can_read_library"
  on public.atlas_user_libraries for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "owner_can_create_library"
  on public.atlas_user_libraries for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "owner_can_update_library"
  on public.atlas_user_libraries for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "owner_can_delete_library"
  on public.atlas_user_libraries for delete to authenticated
  using (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.atlas_user_libraries to authenticated;
revoke all on public.atlas_user_libraries from anon;
