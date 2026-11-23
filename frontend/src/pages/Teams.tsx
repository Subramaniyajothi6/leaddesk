import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { api, post } from '../lib/api'
import { useAction } from '../lib/hooks'
import { roleLabel } from '../lib/auth'
import { ago } from '../lib/format'
import { Card, PageHeader, Tabs, Table, Field, Badge, Spinner, Avatar, Empty } from '../components/ui'
import { Modal } from '../components/Modal'

interface Team { id: number; name: string; state: string; autoDistribute: boolean; method: string; teamLead: { id: number; name: string } | null; members: { id: number; name: string; state: string; empCode: string }[]; poolCount: number }
interface User { id: number; empCode: string; name: string; email: string; phone: string | null; role: 'ADMIN' | 'TEAM_LEAD' | 'BDE'; state: 'ACTIVE' | 'INACTIVE' | 'EXITED'; lastLoginAt: string | null; mustChangePassword: boolean; team: { id: number; name: string } | null; leadsTeams: number[]; openLeads: number }

const stateTone = { ACTIVE: 'ok', INACTIVE: 'warn', EXITED: 'neutral' } as const

export function Teams() {
  const [tab, setTab] = useState<'teams' | 'people'>('teams')
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api<Team[]>('/teams') })
  const users = useQuery({ queryKey: ['users', 'all'], queryFn: () => api<User[]>('/users') })
  return (
    <div className="fade-in">
      <PageHeader title="Teams & people" sub="Users are never deleted: they become inactive or leave, so history stays correct." />
      <Tabs label="Teams and people" value={tab} onChange={setTab} tabs={[{ value: 'teams', label: 'Teams', count: teams.data?.filter((t) => t.state === 'ACTIVE').length }, { value: 'people', label: 'People', count: users.data?.filter((u) => u.state === 'ACTIVE').length }]} />
      {tab === 'teams' ? <TeamsTab teams={teams.data} users={users.data ?? []} loading={teams.isLoading} /> : <PeopleTab users={users.data} teams={teams.data ?? []} loading={users.isLoading} />}
    </div>
  )
}

function TeamsTab({ teams, users, loading }: { teams?: Team[]; users: User[]; loading: boolean }) {
  const [newOpen, setNewOpen] = useState(false)
  const [name, setName] = useState('')
  const create = useAction(() => post('/teams', { name }), { success: `Team created`, invalidate: ['teams'], onDone: () => { setNewOpen(false); setName('') } })
  const link = useAction((v: { teamId: number; userId: number | null }) => post(`/teams/${v.teamId}/lead`, { userId: v.userId }), { success: 'Team Lead updated', invalidate: ['teams', 'users'] })
  const deact = useAction((id: number) => post<{ leadsReturned: number }>(`/teams/${id}/deactivate`), { success: (r) => `Team deactivated · ${r.leadsReturned} leads back in the company pool`, invalidate: ['teams'] })
  const addMember = useAction((v: { teamId: number; userId: number }) => post(`/teams/${v.teamId}/members`, { userId: v.userId }), { success: 'Added to the team', invalidate: ['teams', 'users'] })
  const tls = users.filter((u) => u.role === 'TEAM_LEAD' && u.state === 'ACTIVE')
  const free = users.filter((u) => u.role === 'BDE' && u.state !== 'EXITED' && !u.team)
  if (loading) return <Spinner />
  return (
    <>
      <div className="flex justify-end mb-4"><button className="btn-primary" onClick={() => setNewOpen(true)}>New team</button></div>
      {!teams?.length && <Card><Empty icon="team" title="No teams yet">Create a team, link a Team Lead, then add BDEs.</Empty></Card>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {teams?.map((t) => (
          <Card key={t.id} title={t.name} note={`${t.members.length} BDEs · pool ${t.poolCount} · ${t.method.toLowerCase()}${t.autoDistribute ? ' · auto-refill on' : ''}`} className={clsx(t.state !== 'ACTIVE' && 'opacity-60')}
            action={t.state === 'ACTIVE' ? <button className="text-[12.5px] font-semibold text-muted hover:text-bad cursor-pointer" onClick={() => deact.mutate(t.id)}>Deactivate</button> : <Badge>Inactive</Badge>}>
            <Field label="Team Lead">
              <select className="field" value={t.teamLead?.id ?? ''} disabled={t.state !== 'ACTIVE'} onChange={(e) => link.mutate({ teamId: t.id, userId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">None (Admin acts as Team Lead)</option>
                {tls.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <ul className="flex flex-col gap-2 mt-4">
              {t.members.map((m) => <li key={m.id} className="flex items-center gap-2.5 text-[13.5px]"><Avatar id={m.id} name={m.name} size={26} /><span className="flex-1">{m.name} <span className="text-faint text-[12px]">{m.empCode}</span></span>{m.state !== 'ACTIVE' && <Badge tone={stateTone[m.state as keyof typeof stateTone]}>{m.state.toLowerCase()}</Badge>}</li>)}
              {!t.members.length && <li className="text-muted text-[13px]">No BDEs yet</li>}
            </ul>
            {t.state === 'ACTIVE' && free.length > 0 && (
              <select className="select w-full mt-3" value="" aria-label={`Add a BDE to ${t.name}`} onChange={(e) => e.target.value && addMember.mutate({ teamId: t.id, userId: Number(e.target.value) })}>
                <option value="">+ Add a BDE without a team…</option>{free.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
          </Card>
        ))}
      </div>
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="New team">
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); create.mutate(undefined) }}>
          <Field label="Team name"><input className="field" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Team D, Chennai inbound" /></Field>
          <button className="btn-primary self-end" disabled={!name.trim() || create.isPending}>Create team</button>
        </form>
      </Modal>
    </>
  )
}

function PeopleTab({ users, teams, loading }: { users?: User[]; teams: Team[]; loading: boolean }) {
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [state, setState] = useState('ACTIVE')
  const [modal, setModal] = useState<null | { kind: 'add' } | { kind: 'edit' | 'state' | 'transfer'; user: User }>(null)
  const [secret, setSecret] = useState<{ name: string; password: string } | null>(null)
  const reset = useAction((u: User) => post<{ temporaryPassword: string }>(`/users/${u.id}/reset-password`), { onDone: (r, u) => setSecret({ name: u.name, password: r.temporaryPassword }) })
  const list = (users ?? []).filter((u) => (!role || u.role === role) && (!state || u.state === state) && (!q || `${u.name} ${u.email} ${u.empCode}`.toLowerCase().includes(q.toLowerCase())))
  if (loading) return <Spinner />
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input className="field h-10 w-64" placeholder="Search name, email, code" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
        <select className="select" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role"><option value="">All roles</option><option value="ADMIN">Admin</option><option value="TEAM_LEAD">Team Lead</option><option value="BDE">BDE</option></select>
        <select className="select" value={state} onChange={(e) => setState(e.target.value)} aria-label="State"><option value="">Any state</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="EXITED">Left</option></select>
        <button className="btn-primary ml-auto" onClick={() => setModal({ kind: 'add' })}>Add person</button>
      </div>
      <Card>
        <Table head={['Person', 'Role', 'Team', 'State', 'Open leads', 'Last sign-in', '']} minWidth={820}>
          {list.map((u) => (
            <tr key={u.id}>
              <td><span className="flex items-center gap-2.5"><Avatar id={u.id} name={u.name} size={30} /><span><b className="text-ink block">{u.name}</b><span className="text-[12px] text-faint">{u.empCode} · {u.email}</span></span></span></td>
              <td>{roleLabel[u.role]}</td>
              <td>{u.role === 'TEAM_LEAD' ? teams.filter((t) => u.leadsTeams.includes(t.id)).map((t) => t.name).join(', ') || '—' : u.team?.name ?? '—'}</td>
              <td><Badge tone={stateTone[u.state]}>{u.state === 'EXITED' ? 'Left' : u.state.toLowerCase()}</Badge>{u.mustChangePassword && u.state === 'ACTIVE' && <span className="block text-[11.5px] text-faint mt-0.5">temporary password</span>}</td>
              <td className="num">{u.role === 'BDE' ? u.openLeads : '—'}</td>
              <td className="text-muted text-[12.5px]">{u.lastLoginAt ? ago(u.lastLoginAt) : 'Never'}</td>
              <td className="text-right whitespace-nowrap">
                <button className="btn-ghost btn-sm" onClick={() => setModal({ kind: 'edit', user: u })}>Edit</button>{' '}
                {u.role === 'BDE' && u.state !== 'EXITED' && <><button className="btn-ghost btn-sm" onClick={() => setModal({ kind: 'transfer', user: u })}>Move</button>{' '}</>}
                <button className="btn-ghost btn-sm" onClick={() => setModal({ kind: 'state', user: u })}>{u.state === 'ACTIVE' ? 'Deactivate' : 'Change'}</button>{' '}
                {u.state === 'ACTIVE' && <button className="btn-ghost btn-sm" disabled={reset.isPending} onClick={() => reset.mutate(u)}>Reset password</button>}
              </td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan={7} className="text-center text-muted py-6">Nobody matches</td></tr>}
        </Table>
      </Card>
      {modal?.kind === 'add' && <AddPerson teams={teams} onClose={() => setModal(null)} onCreated={(name, password) => { setModal(null); setSecret({ name, password }) }} />}
      {modal?.kind === 'edit' && <EditPerson user={modal.user} onClose={() => setModal(null)} />}
      {modal?.kind === 'state' && <StatePerson user={modal.user} onClose={() => setModal(null)} />}
      {modal?.kind === 'transfer' && <TransferPerson user={modal.user} teams={teams} onClose={() => setModal(null)} />}
      <Modal open={!!secret} onClose={() => setSecret(null)} title="Temporary password">
        <p className="text-[14px] mb-3">Give this to <b className="text-ink">{secret?.name}</b>. It is shown only once; they must choose their own password when they sign in.</p>
        <p className="font-mono text-[22px] text-ink bg-soft rounded-xl px-4 py-3 text-center select-all">{secret?.password}</p>
        <div className="flex justify-end mt-4"><button className="btn-primary" onClick={() => { navigator.clipboard?.writeText(secret?.password ?? '').catch(() => {}); setSecret(null) }}>Copy and close</button></div>
      </Modal>
    </>
  )
}

function AddPerson({ teams, onClose, onCreated }: { teams: Team[]; onClose: () => void; onCreated: (name: string, password: string) => void }) {
  const [f, setF] = useState({ empCode: '', name: '', email: '', phone: '', role: 'BDE', teamId: '', joinedOn: '' })
  const m = useAction(() => post<{ user: { name: string }; temporaryPassword: string }>('/users', { empCode: f.empCode, name: f.name, email: f.email, role: f.role, ...(f.phone && { phone: f.phone }), ...(f.role === 'BDE' && f.teamId && { teamId: Number(f.teamId) }), ...(f.joinedOn && { joinedOn: f.joinedOn }) }), {
    invalidate: ['users', 'teams'], onDone: (r) => onCreated(r.user.name, r.temporaryPassword),
  })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal open onClose={onClose} title="Add a person">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(undefined) }}>
        <Field label="Name"><input className="field" autoFocus value={f.name} onChange={set('name')} /></Field>
        <Field label="Employee code"><input className="field" value={f.empCode} onChange={set('empCode')} /></Field>
        <Field label="Email"><input className="field" type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Phone (optional)"><input className="field" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Role"><select className="field" value={f.role} onChange={set('role')}><option value="BDE">BDE</option><option value="TEAM_LEAD">Team Lead</option><option value="ADMIN">Admin</option></select></Field>
        {f.role === 'BDE' ? <Field label="Team"><select className="field" value={f.teamId} onChange={set('teamId')}><option value="">No team yet</option>{teams.filter((t) => t.state === 'ACTIVE').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field> : <span className="text-[12.5px] text-faint self-end pb-3">Link a Team Lead to teams on the Teams tab.</span>}
        <Field label="Joined on" hint="Days before this are not counted in attendance"><input className="field" type="date" value={f.joinedOn} onChange={set('joinedOn')} /></Field>
        <div className="sm:col-span-2 flex justify-end"><button className="btn-primary" disabled={!f.name || !f.empCode || !f.email || m.isPending}>Add and get a temporary password</button></div>
      </form>
    </Modal>
  )
}

function EditPerson({ user, onClose }: { user: User; onClose: () => void }) {
  const [f, setF] = useState({ name: user.name, email: user.email, phone: user.phone ?? '', empCode: user.empCode })
  const m = useAction(() => api(`/users/${user.id}`, { method: 'PATCH', body: { ...f, phone: f.phone || null } }), { success: 'Saved', invalidate: ['users', 'teams'], onDone: onClose })
  return (
    <Modal open onClose={onClose} title={`Edit ${user.name}`}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(undefined) }}>
        {(['name', 'empCode', 'email', 'phone'] as const).map((k) => <Field key={k} label={{ name: 'Name', empCode: 'Employee code', email: 'Email', phone: 'Phone' }[k]}><input className="field" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
        <div className="sm:col-span-2 flex justify-end"><button className="btn-primary" disabled={m.isPending}>Save</button></div>
      </form>
    </Modal>
  )
}

function StatePerson({ user, onClose }: { user: User; onClose: () => void }) {
  const [state, setState] = useState<User['state']>(user.state === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')
  const m = useAction(() => post<{ leadsReturned: number }>(`/users/${user.id}/state`, { state }), { success: (r) => `${user.name} is now ${state === 'EXITED' ? 'marked as left' : state.toLowerCase()}${r.leadsReturned ? ` · ${r.leadsReturned} leads back in the team pool` : ''}`, invalidate: ['users', 'teams', 'dashboard'], onDone: onClose })
  const text = {
    ACTIVE: 'Can sign in again and gets leads from the next allocation.',
    INACTIVE: `Temporary. Signs out now and cannot sign in. Keeps their ${user.openLeads} open leads; they show as unattended so the Team Lead can reassign them.`,
    EXITED: `Left the company. Signs out now, leaves the team, and their ${user.openLeads} open leads go back to the team pool (setting). History stays.`,
  }
  return (
    <Modal open onClose={onClose} title={`Change ${user.name}`}>
      <div className="flex flex-col gap-2">
        {(['ACTIVE', 'INACTIVE', 'EXITED'] as const).filter((s) => s !== user.state).map((s) => (
          <label key={s} className={clsx('flex gap-3 p-3 rounded-xl border cursor-pointer', state === s ? 'border-ink bg-soft' : 'border-line')}>
            <input type="radio" name="st" checked={state === s} onChange={() => setState(s)} />
            <span><b className="text-ink">{s === 'EXITED' ? 'Left the company' : s === 'ACTIVE' ? 'Active' : 'Inactive'}</b><span className="block text-[13px] text-muted">{text[s]}</span></span>
          </label>
        ))}
        <button className={clsx('self-end mt-2', state === 'ACTIVE' ? 'btn-primary' : 'btn bg-bad text-white hover:bg-bad/90')} disabled={m.isPending} onClick={() => m.mutate(undefined)}>Confirm</button>
      </div>
    </Modal>
  )
}

function TransferPerson({ user, teams, onClose }: { user: User; teams: Team[]; onClose: () => void }) {
  const [teamId, setTeamId] = useState('')
  const [leads, setLeads] = useState<'STAY' | 'MOVE'>('STAY')
  const m = useAction(() => post<{ leadCount: number }>(`/users/${user.id}/transfer`, { teamId: Number(teamId), leads }), { success: (r) => `${user.name} moved · ${r.leadCount} open leads ${leads === 'MOVE' ? 'went with them' : 'stayed in the old team pool'}`, invalidate: ['users', 'teams', 'dashboard'], onDone: onClose })
  return (
    <Modal open onClose={onClose} title={`Move ${user.name} to another team`}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(undefined) }}>
        <Field label="New team"><select className="field" value={teamId} onChange={(e) => setTeamId(e.target.value)}><option value="">Choose…</option>{teams.filter((t) => t.state === 'ACTIVE' && t.id !== user.team?.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <fieldset className="flex flex-col gap-2"><legend className="label mb-1">Their {user.openLeads} open leads</legend>
          <label className="flex items-center gap-2 text-[13.5px]"><input type="radio" checked={leads === 'STAY'} onChange={() => setLeads('STAY')} />Stay in the old team’s pool (default)</label>
          <label className="flex items-center gap-2 text-[13.5px]"><input type="radio" checked={leads === 'MOVE'} onChange={() => setLeads('MOVE')} />Go with {user.name.split(' ')[0]} to the new team</label>
        </fieldset>
        <button className="btn-primary self-end" disabled={!teamId || m.isPending}>Move</button>
      </form>
    </Modal>
  )
}
