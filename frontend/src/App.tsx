import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { useAuth } from './lib/auth'
import { Shell } from './components/Shell'
import { Spinner } from './components/ui'
import { allItems } from './components/nav'
import { Login } from './pages/Login'
import { ChangePassword } from './pages/ChangePassword'

// Each screen is its own chunk, loaded only when someone opens it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const page = (load: () => Promise<any>, name: string) => lazy(() => load().then((m) => ({ default: m[name] as ComponentType })))
const AdminDashboard = page(() => import('./pages/AdminDashboard'), 'AdminDashboard')
const TeamDashboard = page(() => import('./pages/TeamDashboard'), 'TeamDashboard')
const BdeToday = page(() => import('./pages/BdeToday'), 'BdeToday')
const SCREENS: Record<string, ComponentType> = {
  '/leads': page(() => import('./pages/Leads'), 'Leads'),
  '/upload': page(() => import('./pages/Upload'), 'Upload'),
  '/allocation': page(() => import('./pages/Allocation'), 'Allocation'),
  '/distribute': page(() => import('./pages/Distribute'), 'Distribute'),
  '/teams': page(() => import('./pages/Teams'), 'Teams'),
  '/attendance': page(() => import('./pages/Attendance'), 'Attendance'),
  '/follow-ups': page(() => import('./pages/FollowUps'), 'FollowUps'),
  '/reports': page(() => import('./pages/Reports'), 'Reports'),
  '/leaderboard': page(() => import('./pages/Leaderboard'), 'Leaderboard'),
  '/finance': page(() => import('./pages/Finance'), 'Finance'),
  '/payments': page(() => import('./pages/Payments'), 'Payments'),
  '/settings': page(() => import('./pages/Settings'), 'SettingsPage'),
  '/audit': page(() => import('./pages/Audit'), 'Audit'),
  '/performance': page(() => import('./pages/Performance'), 'Performance'),
}
const LeadPage = page(() => import('./pages/LeadPage'), 'LeadPage')

/** Signed in, and not holding a temporary password. The server checks permissions again on every request. */
function Private({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth()
  const loc = useLocation()
  if (!ready) return <div className="min-h-dvh grid place-items-center"><Spinner label="Starting LeadDesk" /></div>
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (user.mustChangePassword && loc.pathname !== '/change-password') return <Navigate to="/change-password" replace />
  return <>{children}</>
}

const Lazy = ({ C }: { C: ComponentType }) => <Suspense fallback={<Spinner />}><C /></Suspense>

function Home() {
  const { user } = useAuth()
  return <Lazy C={user?.role === 'ADMIN' ? AdminDashboard : user?.role === 'TEAM_LEAD' ? TeamDashboard : BdeToday} />
}

export function App() {
  const { user } = useAuth()
  // A role gets only the screens in its own menu (Admin also reaches team pools from Allocation).
  const paths = user ? [...allItems(user.role).map((i) => i.to), ...(user.role === 'ADMIN' ? ['/distribute'] : [])] : []
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/change-password" element={<Private><ChangePassword /></Private>} />
      <Route element={<Private><Shell /></Private>}>
        <Route index element={<Home />} />
        {paths.filter((p) => SCREENS[p]).map((p) => <Route key={p} path={p.slice(1)} element={<Lazy C={SCREENS[p]} />} />)}
        <Route path="leads/:id" element={<Lazy C={LeadPage} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
