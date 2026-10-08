-- Fonctions internes : pas appelables depuis l'API.
-- only_weekly_minigame est une fonction de trigger (les triggers marchent
-- sans ce droit) ; golden_goal_week_visible sert aux règles d'accès.
revoke execute on function public.only_weekly_minigame() from public, anon, authenticated;
revoke execute on function public.golden_goal_week_visible(date) from public, anon;
grant execute on function public.golden_goal_week_visible(date) to authenticated;
