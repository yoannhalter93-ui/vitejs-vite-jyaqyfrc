interface Tab {
  key: string
  label: string
  icon: string
  badge?: number
}

interface Props {
  tabs: Tab[]
  active: string
  onSelect: (key: string) => void
}

export default function BottomNav({ tabs, active, onSelect }: Props) {
  return (
    <nav className="bottom-nav">
      {tabs.map((t) => (
        <button
          key={t.key}
          className={'bottom-nav-tab' + (active === t.key ? ' bottom-nav-tab-active' : '')}
          onClick={() => onSelect(t.key)}
        >
          <span className="bottom-nav-icon">
            {t.icon}
            {!!t.badge && <span className="notif-badge bottom-nav-badge">{t.badge}</span>}
          </span>
          <span className="bottom-nav-label">{t.label}</span>
        </button>
      ))}
    </nav>
  )
}
