# Entre Nous — notes pour les sessions de développement

## Supabase : droits sur les nouvelles tables (à partir du 30/10/2026)

Supabase n'accorde plus automatiquement l'accès Data API (supabase-js,
PostgREST) aux nouvelles tables du schéma `public`. Toute migration qui crée
une table lue ou écrite par l'appli doit donner les droits explicitement,
dans la même migration :

```sql
grant select on public.ma_table to anon;                                  -- seulement si lisible sans compte
grant select, insert, update, delete on public.ma_table to authenticated;
grant select, insert, update, delete on public.ma_table to service_role;
```

(et toujours activer la RLS + des policies). Les tables existantes ne sont
pas concernées. Une table utilisée uniquement par des fonctions
`security definer` n'a pas besoin de ces droits.
