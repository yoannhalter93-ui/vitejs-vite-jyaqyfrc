import { supabase } from './supabaseClient'

// Les mini-jeux tournent (jonglage → dribble → coup-franc → toro) : la
// « semaine précédente » d'un jeu n'est donc pas la semaine d'avant, mais la
// dernière semaine où CE jeu était le jeu de la semaine (minigame_weeks).
// Sans ça, une partie jouée hors de sa semaine (ex. jonglage pendant la
// semaine du toro) s'affichait comme « Semaine dernière ».
export async function previousGameWeek(gameKey: string, currentWeek: string): Promise<string> {
  const { data } = await supabase.from('minigame_weeks').select('week_start')
    .eq('game_key', gameKey).lt('week_start', currentWeek)
    .order('week_start', { ascending: false }).limit(1).maybeSingle()
  return data?.week_start ?? '0001-01-01' // aucune édition précédente : aucun score
}
