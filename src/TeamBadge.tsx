// Petits badges d'équipe originaux (initiales + couleurs du club), pas des
// écussons officiels — les écussons réels sont des marques déposées, ces
// badges stylisés évitent complètement la question tout en rendant les
// pronostics beaucoup plus lisibles qu'un simple nom en texte.
const TEAM_STYLES: Record<string, { abbr: string; bg: string; fg: string }> = {
  'Angers': { abbr: 'ANG', bg: '#1B1B1F', fg: '#F4EFE2' },
  'Auxerre': { abbr: 'AJA', bg: '#1F5FA8', fg: '#F4EFE2' },
  'Brest': { abbr: 'BRE', bg: '#C1443C', fg: '#F4EFE2' },
  'Le Havre': { abbr: 'HAC', bg: '#4FB0C6', fg: '#0F3B2E' },
  'Le Mans': { abbr: 'LEM', bg: '#1B3A6B', fg: '#F4EFE2' },
  'Lens': { abbr: 'RCL', bg: '#8C1E1E', fg: '#D4A22C' },
  'Lille': { abbr: 'LOSC', bg: '#B0233A', fg: '#F4EFE2' },
  'Lorient': { abbr: 'FCL', bg: '#E07A2F', fg: '#1B1B1F' },
  'Monaco': { abbr: 'ASM', bg: '#D0342C', fg: '#F4EFE2' },
  'Nice': { abbr: 'OGC', bg: '#1B1B1F', fg: '#C1443C' },
  'OL': { abbr: 'OL', bg: '#1E4DA1', fg: '#F4EFE2' },
  'OM': { abbr: 'OM', bg: '#2E9CCB', fg: '#F4EFE2' },
  'Paris FC': { abbr: 'PFC', bg: '#2453A6', fg: '#F4EFE2' },
  'PSG': { abbr: 'PSG', bg: '#0A1E4D', fg: '#F4EFE2' },
  'Rennes': { abbr: 'REN', bg: '#C1272D', fg: '#1B1B1F' },
  'Strasbourg': { abbr: 'RCS', bg: '#3F8FCB', fg: '#F4EFE2' },
  'Toulouse': { abbr: 'TFC', bg: '#6A3FA0', fg: '#F4EFE2' },
  'Troyes': { abbr: 'TRO', bg: '#2456A6', fg: '#E07A2F' },
}

const FALLBACK = { bg: '#4A4A4A', fg: '#F4EFE2' }

interface Props {
  name: string
  size?: number
}

export default function TeamBadge({ name, size = 26 }: Props) {
  const style = TEAM_STYLES[name]
  const abbr = style?.abbr ?? (name || '?').replace(/[^A-Za-zÀ-ÿ]/g, '').slice(0, 3).toUpperCase()
  const bg = style?.bg ?? FALLBACK.bg
  const fg = style?.fg ?? FALLBACK.fg
  return (
    <span
      className="team-badge"
      style={{ width: size, height: size, backgroundColor: bg, color: fg, fontSize: Math.max(9, size * 0.34) }}
      title={name}
    >
      {abbr}
    </span>
  )
}
