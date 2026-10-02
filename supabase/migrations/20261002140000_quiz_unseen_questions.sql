-- Duel de quiz : tirage des 10 questions
--  - d'abord des questions qu'AUCUN des deux joueurs n'a déjà eues (dans
--    n'importe quel groupe, revanches comprises) ; s'il n'en reste pas assez,
--    on complète avec les moins récentes
--  - au plus 2 questions du même thème par duel (variété)
create or replace function public.pick_duel_questions(p_a uuid, p_b uuid, p_n integer default 10)
returns table(question_id uuid)
language sql
volatile
security definer
set search_path to 'public'
as $$
  with seen as (
    select s.question_id, max(d.created_at) as last_seen
    from duel_question_sequence s
    join weekly_duels d on d.id = s.duel_id
    where d.player_a_id in (p_a, p_b) or d.player_b_id in (p_a, p_b)
    group by s.question_id
  ),
  ranked as (
    select q.id, q.category, sn.last_seen,
      row_number() over (partition by q.category, (sn.question_id is null) order by random()) as rk
    from quiz_questions q
    left join seen sn on sn.question_id = q.id
  )
  select id from ranked
  order by (last_seen is not null),        -- jamais vues d'abord
           (rk > 2),                        -- 2 par thème au plus, tant que possible
           last_seen nulls first,           -- sinon les plus anciennes
           random()
  limit p_n;
$$;
revoke execute on function public.pick_duel_questions(uuid, uuid, integer) from public, anon, authenticated;

create or replace function public.generate_duel_question_sequence()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into duel_question_sequence (duel_id, question_order, question_id)
  select new.id, row_number() over (order by random()), p.question_id
  from pick_duel_questions(new.player_a_id, new.player_b_id, 10) p;
  return new;
end;
$$;

do $$
declare src text;
begin
  select pg_get_functiondef('public.use_bonus_revanche_quiz(uuid)'::regprocedure) into src;
  if position('pick_duel_questions' in src) = 0 then
    -- nouvelles questions tirées tant que les anciennes du duel existent
    -- encore (elles comptent donc comme déjà vues)
    src := replace(src, $a$  perform pg_advisory_xact_lock(hashtext(d.group_id::text || ':bonus'));
$a$, $b$  perform pg_advisory_xact_lock(hashtext(d.group_id::text || ':bonus'));
  create temp table if not exists _revanche_q (question_id uuid) on commit drop;
  insert into _revanche_q select p.question_id from pick_duel_questions(d.player_a_id, d.player_b_id, 10) p;
$b$);
    src := replace(src, $a$  insert into duel_question_sequence (duel_id, question_order, question_id)
  select p_duel_id, row_number() over (order by random()), id
  from quiz_questions
  order by random()
  limit 10;$a$, $b$  insert into duel_question_sequence (duel_id, question_order, question_id)
  select p_duel_id, row_number() over (order by random()), q.question_id from _revanche_q q;$b$);
    execute src;
  end if;
end $$;
