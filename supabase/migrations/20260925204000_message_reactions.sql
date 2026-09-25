-- Réactions emoji sur les messages du tchat de groupe.
create table public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (emoji in ('👍', '😂', '🔥', '😮', '😢', '⚽')),
  -- recopié depuis le message (trigger) : sert au filtre temps réel par groupe
  group_id uuid not null references public.groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, profile_id, emoji)
);

create index message_reactions_group_idx on public.message_reactions (group_id);
create index message_reactions_profile_idx on public.message_reactions (profile_id);

create or replace function public.set_message_reaction_group()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  select group_id into new.group_id from messages where id = new.message_id;
  if new.group_id is null then raise exception 'Message introuvable'; end if;
  return new;
end;
$$;

create trigger trg_set_message_reaction_group
  before insert on public.message_reactions
  for each row execute function public.set_message_reaction_group();

alter table public.message_reactions enable row level security;

create policy "membres voient les reactions" on public.message_reactions
  for select to authenticated
  using (is_group_member(group_id));

create policy "reagir a un message de son groupe" on public.message_reactions
  for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and exists (select 1 from messages m where m.id = message_id and is_group_member(m.group_id))
  );

create policy "retirer sa reaction" on public.message_reactions
  for delete to authenticated
  using (profile_id = (select auth.uid()));

grant select, insert, delete on public.message_reactions to authenticated;

alter publication supabase_realtime add table public.message_reactions;

-- fonction de trigger : pas appelable via /rpc
revoke execute on function public.set_message_reaction_group() from public, anon, authenticated;
