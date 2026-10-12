-- Bonus inversé : l'inversion reste attachée au JOUEUR (elle le suit après
-- un échange d'équipe ou un retirage forcé). Nouveau : un joueur inversé
-- peut utiliser le bonus sur lui-même (3 jetons) pour ANNULER son
-- inversion. Sur un adversaire déjà inversé : toujours refusé.

do $$
declare def text; before text;
begin
  def := pg_get_functiondef('public.use_bonus_inverse(uuid, uuid)'::regprocedure);
  before := def;
  def := replace(def, '  v_target_pseudo text;
begin', '  v_target_pseudo text;
  v_cancel boolean := false;
begin');
  def := replace(def, '    raise exception ''Le bonus inversé est déjà actif sur cette équipe pour cette période'';',
    '    if v_target = auth.uid() then
      v_cancel := true;
    else
      raise exception ''Le bonus inversé est déjà actif sur cette équipe pour cette période'';
    end if;');
  def := replace(def, 'set inverted = true', 'set inverted = not v_cancel');
  def := replace(def, ''' a inversé les points de sa propre équipe attitrée !''',
    'case when v_cancel then '' a annulé l''''inversion de son équipe : ses points redeviennent normaux !'' else '' a inversé les points de sa propre équipe attitrée !'' end');
  if def = before or position('v_cancel := true' in def) = 0 or position('not v_cancel' in def) = 0
     or position('redeviennent normaux' in def) = 0 then
    raise exception 'motif introuvable';
  end if;
  execute def;
end $$;
