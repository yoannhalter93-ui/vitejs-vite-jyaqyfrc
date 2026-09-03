import { supabase } from './supabaseClient'
import { useState, useEffect } from 'react';
import './App.css';
import { useAuth } from './AuthContext';
import Login from './Login';
import Groups from './Groups';
import Predictions from './Predictions';
import Classement from './Classement';
import Roulette from './Roulette';
import PenaltyDuel from './PenaltyDuel';
import WeeklyDuel from './WeeklyDuel';
import FreeBets from './FreeBets';
import JuggleGame from './JuggleGame';

type Screen =
  | 'pronostics'
  | 'classement'
  | 'roulette'
  | 'penalty'
  | 'quiz'
  | 'paris'
  | 'jonglages';

const SCREENS: { key: Screen; label: string }[] = [
  { key: 'pronostics', label: 'Pronostics' },
  { key: 'classement', label: 'Classement' },
  { key: 'roulette', label: 'Mon équipe' },
  { key: 'penalty', label: 'Duel penalty' },
  { key: 'quiz', label: 'Quiz' },
  { key: 'paris', label: 'Paris libres' },
  { key: 'jonglages', label: 'Jonglages' },
];

const VAPID_PUBLIC_KEY = 'BODqLXOAm-EvaSnvqqQCmRdfvSPk-QEZ1SAc8BDd8x-Fn3r-AteEiUDqCcciJ5ZxG5XR1z-zd8jgca1kjKfYiVg'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

async function subscribeToPush(profileId: string) {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
    let permission = Notification.permission
    if (permission === 'default') {
      permission = await Notification.requestPermission()
    }
    if (permission !== 'granted') return

    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
    }
    const json = sub.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return
    await supabase.from('push_subscriptions').upsert(
      { profile_id: profileId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
      { onConflict: 'endpoint' }
    )
  } catch (e) {
    console.error('Abonnement aux notifications push impossible', e)
  }
}

function App() {
  const [juggleAlert, setJuggleAlert] = useState<{ profileId: string; pseudo: string } | null>(null)
  const [myPseudo, setMyPseudo] = useState<string | null>(null)
  const [wizzChannel, setWizzChannel] = useState<ReturnType<typeof supabase.channel> | null>(null)

  const { session, loading, signOut } = useAuth();
  const [selectedGroup, setSelectedGroup] = useState<{
    id: string;
    name: string;
  } | null>(null);

  useEffect(() => {
    if (!session?.user?.id) return
    supabase.from('profiles').select('pseudo').eq('id', session.user.id).maybeSingle().then(({ data }) => setMyPseudo(data?.pseudo ?? null))
  }, [session?.user?.id])

  useEffect(() => {
    if (!selectedGroup?.id || !session?.user?.id) return
    const channel = supabase.channel(`wizz-${selectedGroup.id}`)
    let hideTimer: ReturnType<typeof setTimeout> | null = null
    channel.on('broadcast', { event: 'playing' }, ({ payload }: any) => {
      if (!payload || payload.profileId === session.user.id) return
      if (payload.action === 'start') {
        setJuggleAlert({ profileId: payload.profileId, pseudo: payload.pseudo || 'Un coéquipier' })
        if (hideTimer) clearTimeout(hideTimer)
        hideTimer = setTimeout(() => setJuggleAlert(null), 35000)
      } else if (payload.action === 'stop') {
        setJuggleAlert(null)
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
      }
    }).subscribe()
    setWizzChannel(channel)
    return () => {
      if (hideTimer) clearTimeout(hideTimer)
      supabase.removeChannel(channel)
      setWizzChannel(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup?.id, session?.user?.id])

  const sendWizz = () => {
    if (!juggleAlert || !wizzChannel) return
    wizzChannel.send({ type: 'broadcast', event: 'wizz', payload: { targetProfileId: juggleAlert.profileId, fromPseudo: myPseudo || 'Un ami' } })
  }

  const [screen, setScreen] = useState<Screen>('pronostics');

  const BONUS_CODES = ['echange_equipe', 'retirage_force', 'double_ou_rien', 'bonus_inverse']
  const [tokenBalance, setTokenBalance] = useState<number | null>(null)
  const [bonusCatalog, setBonusCatalog] = useState<any[]>([])
  const [showBonusPanel, setShowBonusPanel] = useState(false)
  const [bonusTargetPicker, setBonusTargetPicker] = useState<string | null>(null)
  const [groupMembersForBonus, setGroupMembersForBonus] = useState<{ id: string; pseudo: string }[]>([])
  const [bonusBusy, setBonusBusy] = useState(false)
  const [bonusError, setBonusError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('bonus_catalog').select('*').in('code', BONUS_CODES).then(({ data }: any) => {
      if (data) setBonusCatalog(data)
    })
  }, [])

  const refreshTokenBalance = () => {
    if (!selectedGroup?.id) return
    supabase.rpc('get_token_balance', { p_group_id: selectedGroup.id }).then(({ data, error }: any) => {
      if (!error) setTokenBalance(data)
    })
  }

  useEffect(() => {
    if (!selectedGroup?.id) { setTokenBalance(null); return }
    refreshTokenBalance()
  }, [selectedGroup?.id])

  const openBonusTargetPicker = async (code: string) => {
    if (!selectedGroup?.id || !session?.user?.id) return
    setBonusError(null)
    const { data } = await supabase
      .from('group_members')
      .select('profile_id, profiles(pseudo)')
      .eq('group_id', selectedGroup.id)
    const members = (data ?? [])
      .map((m: any) => ({ id: m.profile_id, pseudo: m.profiles?.pseudo ?? '?' }))
      .filter((m: any) => m.id !== session.user.id)
    setGroupMembersForBonus(members)
    setBonusTargetPicker(code)
  }

  const applyBonus = async (code: string, targetId: string | null) => {
    if (!selectedGroup?.id) return
    setBonusBusy(true)
    setBonusError(null)
    try {
      if (code === 'echange_equipe') {
        const { error } = await supabase.rpc('use_bonus_echange_equipe', { p_group_id: selectedGroup.id, p_target_id: targetId })
        if (error) throw error
      } else if (code === 'retirage_force') {
        const { error } = await supabase.rpc('use_bonus_retirage_force', { p_group_id: selectedGroup.id, p_target_id: targetId })
        if (error) throw error
      } else if (code === 'bonus_inverse') {
        const { error } = await supabase.rpc('use_bonus_inverse', { p_group_id: selectedGroup.id, p_target_id: targetId })
        if (error) throw error
      }
      setBonusTargetPicker(null)
      refreshTokenBalance()
    } catch (e: any) {
      setBonusError(e.message || 'Erreur')
    } finally {
      setBonusBusy(false)
    }
  }

  const [notifications, setNotifications] = useState<any[]>([])
  const [showNotifPanel, setShowNotifPanel] = useState(false)
  const unreadNotifCount = notifications.filter((n) => !n.read).length

  const loadNotifications = () => {
    if (!session?.user?.id) return
    supabase
      .from('notifications')
      .select('*')
      .eq('profile_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }: any) => {
        if (data) setNotifications(data)
      })
  }

  useEffect(() => {
    if (!session?.user?.id) { setNotifications([]); return }
    loadNotifications()
  }, [session?.user?.id])

  useEffect(() => {
    if (!session?.user?.id) return
    subscribeToPush(session.user.id)
  }, [session?.user?.id])

  const markNotifRead = async (id: string) => {
    await supabase.from('notifications').update({ read: true }).eq('id', id)
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }

  const markAllNotifsRead = async () => {
    if (!session?.user?.id) return
    await supabase.from('notifications').update({ read: true }).eq('profile_id', session.user.id).eq('read', false)
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  const handleUseBonus = (code: string) => {
    if (code === 'double_ou_rien') {
      setShowBonusPanel(false)
      setScreen('paris')
      return
    }
    openBonusTargetPicker(code)
  }

  if (loading) {
    return (
      <div className="app-loading">
        <p>Chargement...</p>
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  return (
    <div className="home-screen">
      <header className="home-header">
        <h1>Entre Nous</h1>
            <div className="notif-bell-wrap">
              <button className="notif-bell-btn" onClick={() => setShowNotifPanel((v) => !v)}>
                🔔{unreadNotifCount > 0 && <span className="notif-badge">{unreadNotifCount}</span>}
              </button>
              {showNotifPanel && (
                <div className="notif-panel">
                  <div className="notif-panel-header">
                    <span>Notifications</span>
                    {unreadNotifCount > 0 && (
                      <button className="notif-markall-btn" onClick={markAllNotifsRead}>Tout marquer comme lu</button>
                    )}
                  </div>
                  {notifications.length === 0 && <div className="notif-empty">Aucune notification</div>}
                  {notifications.map((n) => (
                    <div key={n.id} className={`notif-row ${n.read ? '' : 'notif-unread'}`} onClick={() => !n.read && markNotifRead(n.id)}>
                      <div className="notif-text">{n.text}</div>
                      <div className="notif-date">{new Date(n.created_at).toLocaleString('fr-FR')}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
        <button className="home-signout" onClick={signOut}>
          Déconnexion
        </button>
      </header>
      {juggleAlert && (
        <div className="wizz-alert-banner">
          <span>🤹 {juggleAlert.pseudo} joue aux Jonglages !</span>
          <button className="juggle-wizz-btn" onClick={sendWizz}>🧪 Envoyer un wizz</button>
          <button className="wizz-alert-close" onClick={() => setJuggleAlert(null)} aria-label="Fermer">✕</button>
        </div>
      )}
      {bonusTargetPicker && (
        <div className="bonus-target-overlay" onClick={() => setBonusTargetPicker(null)}>
          <div className="bonus-target-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Choisis une cible</h3>
            {bonusError && <p className="bonus-error">{bonusError}</p>}
            {bonusTargetPicker === 'bonus_inverse' && (
              <button className="bonus-target-member" onClick={() => applyBonus('bonus_inverse', session!.user.id)} disabled={bonusBusy}>
                Toi-même
              </button>
            )}
            {groupMembersForBonus.map((m) => (
              <button
                key={m.id}
                className="bonus-target-member"
                onClick={() => applyBonus(bonusTargetPicker, m.id)}
                disabled={bonusBusy}
              >
                {m.pseudo}
              </button>
           ))}
            <button className="bonus-target-cancel" onClick={() => setBonusTargetPicker(null)}>Annuler</button>
          </div>
        </div>
       )}
      <main className="home-main">
        {selectedGroup ? (
          <>
            <div className="group-nav">
              <button
                className="predictions-back"
                onClick={() => {
                  setSelectedGroup(null);
                  setScreen('pronostics');
                }}
              >
                ← Groupes
              </button>
              <div className="token-balance-wrap">
            <button className="token-balance-btn" onClick={() => setShowBonusPanel((v) => !v)}>
              🪙 {tokenBalance ?? 0}
            </button>
            {showBonusPanel && (
              <div className="bonus-panel">
                <div className="bonus-panel-title">Tes jetons : {tokenBalance ?? 0} 🪙</div>
                {bonusCatalog.map((b) => (
                  <div className="bonus-row" key={b.code}>
                    <div className="bonus-row-label">{b.label} — {b.cost_jetons}🪙</div>
                    <div className="bonus-row-desc">{b.description}</div>
                    <button
                      className="bonus-use-btn"
                      disabled={(tokenBalance ?? 0) < b.cost_jetons}
                      onClick={() => handleUseBonus(b.code)}
                    >
                      Utiliser
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="group-nav-tabs">
                {SCREENS.map((s) => (
                  <button
                    key={s.key}
                    className={
                      'group-nav-tab' +
                      (screen === s.key ? ' group-nav-tab-active' : '')
                    }
                    onClick={() => setScreen(s.key)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            {screen === 'pronostics' && (
              <Predictions
                groupId={selectedGroup.id}
                groupName={selectedGroup.name}
                onBack={() => setSelectedGroup(null)}
              />
            )}
            {screen === 'classement' && (
              <Classement
                groupId={selectedGroup.id}
                groupName={selectedGroup.name}
              />
            )}
            {screen === 'roulette' && (
              <Roulette
                groupId={selectedGroup.id}
                groupName={selectedGroup.name}
              />
            )}
            {screen === 'penalty' && (
              <PenaltyDuel
                groupId={selectedGroup.id}
                groupName={selectedGroup.name}
              />
            )}
            {screen === 'quiz' && (
              <WeeklyDuel
                groupId={selectedGroup.id}
                groupName={selectedGroup.name}
              />
            )}
            {screen === 'paris' && (
              <FreeBets
              onBonusUsed={refreshTokenBalance}
                groupId={selectedGroup.id}
                groupName={selectedGroup.name}
              />
            )}
            {screen === 'jonglages' && (
              <JuggleGame
                groupId={selectedGroup.id}
                groupName={selectedGroup.name}
              />
            )}
          </>
        ) : (
          <Groups
            onSelectGroup={(id, name) => setSelectedGroup({ id, name })}
          />
        )}
      </main>
    </div>
  );
}

export default App;
