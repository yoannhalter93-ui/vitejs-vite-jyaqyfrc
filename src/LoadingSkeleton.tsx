// Blocs gris animés affichés pendant un chargement, à la place d'un simple
// "Chargement..." : l'écran garde sa forme et paraît plus rapide.
interface Props {
  variant?: 'home' | 'rows'
  rows?: number
}

export default function LoadingSkeleton({ variant = 'rows', rows = 4 }: Props) {
  if (variant === 'home') {
    return (
      <div className="skeleton-stack" aria-busy="true" aria-label="Chargement">
        <div className="skeleton skeleton-hero" />
        <div className="skeleton-tiles">
          <div className="skeleton skeleton-tile" />
          <div className="skeleton skeleton-tile" />
          <div className="skeleton skeleton-tile" />
        </div>
        <div className="skeleton skeleton-block" />
      </div>
    )
  }
  return (
    <div className="skeleton-stack" aria-busy="true" aria-label="Chargement">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton skeleton-row" />
      ))}
    </div>
  )
}
