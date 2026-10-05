-- Jonglages et Dribble : une seule notification « X joue… » par joueur et
-- par jour (comme le toro et le coup franc), au lieu d'une par partie relancée.
do $$
declare f text; d text; old text := E'  where gm.group_id = p_group_id and gm.profile_id <> me;';
begin
  foreach f in array array['notify_juggle_start(uuid)', 'notify_dribble_start(uuid)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position(old in d) = 0 then continue; end if;
    d := replace(d, old, E'  where gm.group_id = p_group_id and gm.profile_id <> me\n    -- une seule notif par joueur et par jour (sinon une par partie relancée)\n    and not exists (\n      select 1 from notifications n\n      where n.profile_id = gm.profile_id and n.type = ''' ||
      case when f like 'notify_juggle%' then 'jongle' else 'dribble' end ||
      E'''\n        and n.related_profile_id = me and n.created_at > now() - interval ''1 day''\n    );');
    execute d;
  end loop;
end $$;
