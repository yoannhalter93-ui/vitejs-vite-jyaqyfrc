// Invitation par lien : ".../vitejs-vite-jyaqyfrc/?join=CODE". Ouvrir ce
// lien mémorise le code (localStorage, pour survivre à l'inscription et à la
// confirmation d'email) ; App.tsx rejoint ensuite le groupe automatiquement
// dès qu'une session existe (voir consumePendingJoin).

const PENDING_JOIN_KEY = 'entrenous_pending_join'

export function inviteLink(code: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}?join=${encodeURIComponent(code)}`
}

// Partage natif du téléphone (WhatsApp, SMS...) quand il existe, sinon copie
// du message dans le presse-papier. Renvoie ce qui s'est passé pour
// l'afficher ("Lien copié !").
export async function shareInvite(groupName: string, code: string): Promise<'shared' | 'copied' | 'failed'> {
  const url = inviteLink(code)
  const text = `Rejoins mon groupe « ${groupName} » sur Entre Nous ⚽ Pronos, duels et mini-jeux entre potes !`
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Entre Nous', text, url })
      return 'shared'
    } catch (e) {
      // l'utilisateur a juste fermé la feuille de partage
      if (e instanceof DOMException && e.name === 'AbortError') return 'shared'
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`)
    return 'copied'
  } catch {
    return 'failed'
  }
}

// À appeler au démarrage : range un éventuel ?join=CODE de l'URL et le
// retire de la barre d'adresse (pour ne pas le rejouer à chaque rechargement).
export function capturePendingJoinFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('join')
  if (!code) return
  try { window.localStorage.setItem(PENDING_JOIN_KEY, code.trim()) } catch { /* stockage indisponible */ }
  params.delete('join')
  const query = params.toString()
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
}

export function readPendingJoin(): string | null {
  try { return window.localStorage.getItem(PENDING_JOIN_KEY) } catch { return null }
}

export function clearPendingJoin() {
  try { window.localStorage.removeItem(PENDING_JOIN_KEY) } catch { /* ignoré */ }
}
