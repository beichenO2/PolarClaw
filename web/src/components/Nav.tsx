import { NavLink } from 'react-router-dom'
import { clsx } from 'clsx'

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/yolo', label: 'YOLO' },
  { to: '/review', label: 'Review' },
]

export function Nav() {
  return (
    <nav className="flex gap-2 flex-wrap">
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          className={({ isActive }) =>
            clsx(
              'px-3 py-1.5 rounded-md text-sm border transition-all',
              isActive
                ? 'bg-mc-border border-mc-accent text-mc-accent'
                : 'bg-mc-surface border-mc-border text-mc-text hover:border-mc-accent hover:text-mc-accent',
            )
          }
        >
          {l.label}
        </NavLink>
      ))}
    </nav>
  )
}
