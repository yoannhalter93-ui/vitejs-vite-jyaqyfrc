import { useEffect, useRef, useState } from 'react'

// "Tirer pour rafraîchir" : l'appli installée (écran d'accueil / Play Store)
// n'a pas le rafraîchissement natif du navigateur. On tire vers le bas depuis
// le haut de la page, on relâche au-delà du seuil → onRefresh().
const THRESHOLD = 70
const MAX_PULL = 110

// Un élément défilable qui n'est pas tout en haut (liste du tchat...) garde
// la main sur le geste : on ne déclenche rien dans ce cas.
function insideScrolledElement(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null
  while (el && el !== document.body) {
    if (el.scrollTop > 0) return true
    el = el.parentElement
  }
  return false
}

interface Props {
  enabled: boolean
  onRefresh: () => void
}

export default function PullToRefresh({ enabled, onRefresh }: Props) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)
  const pullRef = useRef(0)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  useEffect(() => {
    if (!enabled) return
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || window.scrollY > 0 || insideScrolledElement(e.target)) {
        startY.current = null
        return
      }
      startY.current = e.touches[0].clientY
    }
    const onMove = (e: TouchEvent) => {
      if (startY.current === null) return
      const dy = e.touches[0].clientY - startY.current
      const next = dy > 0 ? Math.min(MAX_PULL, dy * 0.55) : 0
      pullRef.current = next
      setPull(next)
    }
    const onEnd = () => {
      if (startY.current === null) return
      startY.current = null
      if (pullRef.current >= THRESHOLD) {
        setRefreshing(true)
        onRefreshRef.current()
        window.setTimeout(() => setRefreshing(false), 700)
      }
      pullRef.current = 0
      setPull(0)
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [enabled])

  if (!refreshing && pull === 0) return null
  const ready = pull >= THRESHOLD
  return (
    <div
      className="ptr-indicator"
      style={{ transform: `translate(-50%, ${refreshing ? 56 : pull - 20}px)` }}
      aria-live="polite"
    >
      <span className={`ptr-icon${refreshing ? ' ptr-spin' : ''}`} style={{ transform: refreshing ? undefined : `rotate(${pull * 3}deg)` }}>
        ↻
      </span>
      <span>{refreshing ? 'Actualisation…' : ready ? 'Relâche pour actualiser' : 'Tire pour actualiser'}</span>
    </div>
  )
}
