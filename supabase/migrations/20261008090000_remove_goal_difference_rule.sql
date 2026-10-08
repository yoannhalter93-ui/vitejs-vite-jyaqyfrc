-- Pronos : suppression du « bon écart de buts » (4 points). Il favorisait les
-- matchs nuls (tout nul a le même écart : 1-1 misé pour 0-0 = 4 points).
-- Barème : score exact 5, bon résultat 3, sinon 0. Les matchs déjà résolus
-- gardent leurs points (resolve_match ne traite que les matchs encore ouverts).
do $$
declare d text; old text := E'      if outcome_pred = outcome_real and diff_pred = diff_real then\n        pts := pts + 4;\n      elsif outcome_pred = outcome_real then\n        pts := pts + 3;\n      end if;';
begin
  d := pg_get_functiondef('resolve_match(uuid)'::regprocedure);
  if position(old in d) = 0 then return; end if;
  d := replace(d, old, E'      -- bon résultat (victoire / nul / défaite) : 3 points (plus de bonus « bon écart »)\n      if outcome_pred = outcome_real then\n        pts := pts + 3;\n      end if;');
  execute d;
end $$;
