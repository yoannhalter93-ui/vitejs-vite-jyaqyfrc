-- Analyse statique des fonctions plpgsql (audit : colonnes/tables
-- inexistantes, erreurs de types) — voir plpgsql_check_function_tb.
create extension if not exists plpgsql_check with schema extensions;
