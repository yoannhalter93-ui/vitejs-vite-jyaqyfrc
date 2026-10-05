-- Annonces de nouveautés : chaque joueur ne voit une annonce qu'une fois
-- (mémorisé en base, pas revue sur un autre téléphone). Voir src/Announcement.tsx.
create table if not exists announcements_seen (
  profile_id uuid not null references profiles(id) on delete cascade,
  key text not null,
  seen_at timestamptz not null default now(),
  primary key (profile_id, key)
);
alter table announcements_seen enable row level security;
create policy announcements_seen_select_own on announcements_seen for select to authenticated using (profile_id = auth.uid());
create policy announcements_seen_insert_own on announcements_seen for insert to authenticated with check (profile_id = auth.uid());
grant select, insert on announcements_seen to authenticated;
