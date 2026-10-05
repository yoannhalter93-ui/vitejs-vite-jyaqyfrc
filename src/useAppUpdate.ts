import { useEffect, useState } from 'react'

declare const __BUILD_ID__: string

// L'appli Android (et un onglet laissé ouvert) peut garder une vieille
// version pendant des jours, sans les nouveaux jeux. On compare l'identifiant
// de cette version à celui publié en ligne (version.json, généré au build) :
// au retour sur l'appli, si une version plus récente existe, on recharge ;
// pendant l'utilisation, on le signale (`busy` : pas de rechargement en
// pleine partie).
export function useAppUpdate(busy: boolean) {
  const [updateReady, setUpdateReady] = useState(false)

  useEffect(() => {
    if (import.meta.env.DEV) return
    let stopped = false
    const check = async (reloadIfNew: boolean) => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const { build } = await res.json()
        if (stopped || !build || build === __BUILD_ID__) return
        // un seul rechargement automatique par version : si le cache sert
        // encore l'ancienne page, pas de boucle, juste le bandeau
        let tried: string | null = null
        try { tried = sessionStorage.getItem('entrenous_reload_for') } catch { /* rien */ }
        if (reloadIfNew && !busy && tried !== build) {
          try { sessionStorage.setItem('entrenous_reload_for', build) } catch { /* rien */ }
          window.location.reload()
        } else setUpdateReady(true)
      } catch { /* hors ligne : on réessaiera */ }
    }
    check(true)
    const onVisible = () => { if (document.visibilityState === 'visible') check(true) }
    document.addEventListener('visibilitychange', onVisible)
    const id = setInterval(() => check(false), 5 * 60 * 1000)
    return () => { stopped = true; document.removeEventListener('visibilitychange', onVisible); clearInterval(id) }
  }, [busy])

  return updateReady
}
