-- Capflex Site Match: anonymous capacity marketplace.
-- Everyone (signed in or not) reads listings, projects and bids. Signed-in people write only their own rows.
-- Company, address, contact and exact location live in *_private tables: readable by the owner and Capflex admins only
-- (demo rows, ids starting with 'demo:', are readable by everyone so the demo factory view works).

create table if not exists public.admins (email text primary key);
alter table public.admins enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
create or replace function public.am_admin() returns boolean
language sql stable security definer set search_path = public as $$ select public.is_admin(); $$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.am_admin() to anon, authenticated;

create table if not exists public.listings (
  id text primary key,
  owner uuid references auth.users(id) on delete cascade default auth.uid(),
  demo_owner text,
  sample boolean not null default false,
  code text not null,
  country text not null check (country in ('DE','NL','AT','BE')),
  region text not null,
  voltage text not null check (voltage in ('LV','MV','HV','EHV')),
  connection_mw numeric not null check (connection_mw > 0),
  peak_mw numeric not null check (peak_mw >= 0),
  flex_mw numeric not null default 0 check (flex_mw >= 0),
  feed_in_mw numeric not null default 0 check (feed_in_mw >= 0),
  area_m2 numeric not null check (area_m2 > 0),
  available_from text not null,
  reserve_per_mw numeric not null default 0 check (reserve_per_mw >= 0),
  closes_at timestamptz,
  demo_close_days numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id text primary key,
  owner uuid references auth.users(id) on delete cascade default auth.uid(),
  demo_owner text,
  sample boolean not null default false,
  type text not null check (type in ('battery','solar','wind','datacentre','electrolyser','charging','heat')),
  code text not null,
  mw numeric not null check (mw > 0),
  mwh numeric not null default 0,
  area_m2 numeric not null default 0,
  voltages text[] not null default '{}',
  country text not null check (country in ('DE','NL','AT','BE')),
  regions text[] not null default '{}',
  cod text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.bids (
  id text primary key,
  owner uuid references auth.users(id) on delete cascade default auth.uid(),
  demo_owner text,
  sample boolean not null default false,
  listing_id text not null references public.listings(id) on delete cascade,
  project_id text not null references public.projects(id) on delete cascade,
  per_mw numeric not null check (per_mw >= 0),
  placed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (listing_id, project_id)
);
create index if not exists bids_listing_idx on public.bids (listing_id);
create index if not exists bids_project_idx on public.bids (project_id);
create index if not exists bids_owner_idx on public.bids (owner);
create index if not exists listings_owner_idx on public.listings (owner);
create index if not exists projects_owner_idx on public.projects (owner);

create table if not exists public.site_private (
  listing_id text primary key references public.listings(id) on delete cascade,
  owner uuid references auth.users(id) on delete cascade default auth.uid(),
  company text, address text, contact text,
  lat double precision, lng double precision
);
create table if not exists public.project_private (
  project_id text primary key references public.projects(id) on delete cascade,
  owner uuid references auth.users(id) on delete cascade default auth.uid(),
  company text, contact text
);
create index if not exists site_private_owner_idx on public.site_private (owner);
create index if not exists project_private_owner_idx on public.project_private (owner);

alter table public.listings enable row level security;
alter table public.projects enable row level security;
alter table public.bids enable row level security;
alter table public.site_private enable row level security;
alter table public.project_private enable row level security;

grant select on public.listings, public.projects, public.bids, public.site_private, public.project_private to anon, authenticated;
grant insert, update, delete on public.listings, public.projects, public.bids, public.site_private, public.project_private to authenticated;

-- listings
create policy "listings: everyone reads" on public.listings for select to anon, authenticated using (true);
create policy "listings: owners add" on public.listings for insert to authenticated
  with check (owner = (select auth.uid()) and sample = false and demo_owner is null and id not like 'demo:%');
create policy "listings: owners change" on public.listings for update to authenticated
  using (owner = (select auth.uid()) or (select public.is_admin()))
  with check ((owner = (select auth.uid()) and sample = false and demo_owner is null) or (select public.is_admin()));
create policy "listings: owners delete" on public.listings for delete to authenticated
  using (owner = (select auth.uid()) or (select public.is_admin()));

-- projects
create policy "projects: everyone reads" on public.projects for select to anon, authenticated using (true);
create policy "projects: owners add" on public.projects for insert to authenticated
  with check (owner = (select auth.uid()) and sample = false and demo_owner is null and id not like 'demo:%');
create policy "projects: owners change" on public.projects for update to authenticated
  using (owner = (select auth.uid()) or (select public.is_admin()))
  with check ((owner = (select auth.uid()) and sample = false and demo_owner is null) or (select public.is_admin()));
create policy "projects: owners delete" on public.projects for delete to authenticated
  using (owner = (select auth.uid()) or (select public.is_admin()));

-- bids: only for your own project, never on your own site, at or above the minimum, while bidding is open
create policy "bids: everyone reads" on public.bids for select to anon, authenticated using (true);
create policy "bids: developers add" on public.bids for insert to authenticated
  with check (
    owner = (select auth.uid()) and sample = false and demo_owner is null and id not like 'demo:%'
    and exists (select 1 from public.projects p where p.id = project_id and p.owner = (select auth.uid()))
    and exists (select 1 from public.listings l where l.id = listing_id and l.owner is distinct from (select auth.uid())
                and per_mw >= l.reserve_per_mw and (l.sample or l.closes_at > now()))
  );
create policy "bids: developers change" on public.bids for update to authenticated
  using (owner = (select auth.uid()))
  with check (
    owner = (select auth.uid()) and sample = false and demo_owner is null
    and exists (select 1 from public.projects p where p.id = project_id and p.owner = (select auth.uid()))
    and exists (select 1 from public.listings l where l.id = listing_id and l.owner is distinct from (select auth.uid())
                and per_mw >= l.reserve_per_mw and (l.sample or l.closes_at > now()))
  );
create policy "bids: developers withdraw" on public.bids for delete to authenticated
  using (owner = (select auth.uid()) or (select public.is_admin()));

-- private details
create policy "site_private: owner, Capflex, demo" on public.site_private for select to anon, authenticated
  using (owner = (select auth.uid()) or (select public.is_admin()) or listing_id like 'demo:%');
create policy "site_private: owners add" on public.site_private for insert to authenticated
  with check (owner = (select auth.uid()) and exists (select 1 from public.listings l where l.id = listing_id and l.owner = (select auth.uid())));
create policy "site_private: owners change" on public.site_private for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "site_private: owners delete" on public.site_private for delete to authenticated
  using (owner = (select auth.uid()) or (select public.is_admin()));

create policy "project_private: owner, Capflex" on public.project_private for select to anon, authenticated
  using (owner = (select auth.uid()) or (select public.is_admin()));
create policy "project_private: owners add" on public.project_private for insert to authenticated
  with check (owner = (select auth.uid()) and exists (select 1 from public.projects p where p.id = project_id and p.owner = (select auth.uid())));
create policy "project_private: owners change" on public.project_private for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "project_private: owners delete" on public.project_private for delete to authenticated
  using (owner = (select auth.uid()) or (select public.is_admin()));

-- live updates
do $$ begin
  alter publication supabase_realtime add table public.listings, public.projects, public.bids, public.site_private, public.project_private;
exception when others then null; end $$;
