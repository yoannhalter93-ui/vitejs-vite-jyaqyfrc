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

type PushStatus = 'ok' | 'unsupported' | 'ios-needs-install' | 'needs-permission' | 'denied' | 'error'

// promptIfDefault ne doit être `true` que lors d'un appel déclenché par un
// vrai clic utilisateur (bouton "Activer les notifications") : demander la
// permission automatiquement au chargement (sans geste utilisateur) est
// silencieusement ignoré ou bloqué par la plupart des navigateurs récents
// (Chrome notamment), ce qui expliquait sans doute pourquoi personne
// n'avait jamais d'abonnement enregistré malgré aucune erreur visible.
interface PushResult {
  status: PushStatus
  // message technique brut, affiché tel quel dans la bannière d'erreur pour
  // pouvoir diagnostiquer à distance (par capture d'écran) sans avoir besoin
  // d'ouvrir la console du navigateur
  detail?: string
}

async function subscribeToPush(profileId: string, promptIfDefault = false): Promise<PushResult> {
  try {
    // Sur iPhone/iPad, Safari ne supporte les notifications push QUE si le
    // site a été ajouté à l'écran d'accueil et tourne en mode "app installée"
    // (display standalone) — dans un onglet Safari normal, PushManager
    // n'existe même pas, donc rien ne se passe silencieusement sans ce
    // détecteur (c'est la cause la plus probable d'un "je ne reçois pas les
    // push" sur iPhone).
    const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true
    if (isIOS && !isStandalone) return { status: 'ios-needs-install' }

    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { status: 'unsupported' }

    // On demande la permission EN TOUT PREMIER, avant le moindre `await` —
    // y compris avant l'enregistrement du service worker. Certains
    // navigateurs (Safari en particulier) n'honorent
    // Notification.requestPermission() que s'il est appelé au tout début de
    // la pile d'appel du clic utilisateur : un `await` intercalé avant,
    // même rapide, peut suffire à leur faire perdre la trace du geste
    // utilisateur et bloquer l'appel sans la moindre erreur visible — ce qui
    // correspond exactement au symptôme observé (0 abonnement enregistré,
    // aucune erreur).
    let permission = Notification.permission
    if (permission === 'default') {
      if (!promptIfDefault) return { status: 'needs-permission' }
      permission = await Notification.requestPermission()
    }
    if (permission !== 'granted') return { status: 'denied' }

    const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
    await navigator.serviceWorker.ready

    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
    }
    const json = sub.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { status: 'error', detail: 'Abonnement navigateur incomplet (endpoint/clés manquants)' }
    }

    // Avant, l'erreur éventuelle de cet upsert (ex : bloqué par une policy
    // RLS) n'était jamais vérifiée — la fonction renvoyait 'ok' même si rien
    // n'avait été réellement enregistré en base, ce qui rendait ce genre de
    // panne totalement invisible.
    const { error } = await supabase.from('push_subscriptions').upsert(
      { profile_id: profileId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
      { onConflict: 'endpoint' }
    )
    if (error) {
      console.error('Abonnement push créé côté navigateur mais refusé à l\'enregistrement', error)
      return { status: 'error', detail: `Enregistrement refusé : ${error.message}` }
    }
    return { status: 'ok' }
  } catch (e) {
    console.error('Abonnement aux notifications push impossible', e)
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    return { status: 'error', detail }
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

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Suppression de compte en 2 temps (voir la migration
  // account_deletion_support côté base) : d'abord la RPC qui anonymise le
  // profil et fait quitter tous les groupes (tourne avec la session en
  // cours, pour que auth.uid() soit bien renseigné), puis la fonction Edge
  // qui supprime réellement la ligne auth.users (email, mot de passe) — la
  // seule étape qui coupe vraiment l'accès au compte.
  const handleDeleteAccount = async () => {
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const { error: rpcErr } = await supabase.rpc('delete_my_account_data')
      if (rpcErr) throw rpcErr
      const { data: fnData, error: fnErr } = await supabase.functions.invoke('delete-account')
      if (fnErr) throw fnErr
      if (fnData?.error) throw new Error(fnData.error)
      await signOut()
    } catch (e: any) {
      setDeleteError(
        e?.message ||
        'Suppression impossible pour le moment. Tes données ont peut-être déjà été effacées mais ton compte existe peut-être encore — réessaie, ou contacte-nous si ça persiste.'
      )
      setDeleteBusy(false)
    }
  }

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
    // notification persistée + push, au cas où le destinataire ne serait
    // plus sur l'écran Jonglages (ou plus dans l'appli) pour voir l'effet
    // temps réel
    if (selectedGroup?.id) {
      supabase.rpc('notify_wizz', { p_target_profile_id: juggleAlert.profileId, p_group_id: selectedGroup.id })
    }
  }

  const [screen, setScreen] = useState<Screen>('pronostics');

  // nombre de paris libres ouverts sur lesquels je n'ai pas encore voté,
  // pour afficher un petit badge sur l'onglet "Paris libres" (même principe
  // que le badge de la cloche de notifications)
  const [openBetsToVoteCount, setOpenBetsToVoteCount] = useState(0)

  const refreshOpenBetsToVoteCount = async () => {
    if (!selectedGroup?.id || !session?.user?.id) { setOpenBetsToVoteCount(0); return }
    const { data: b } = await supabase
      .from('free_bets').select('id, deadline')
      .eq('group_id', selectedGroup.id).eq('status', 'open')
    const openIds = (b ?? []).filter((x: any) => new Date(x.deadline) > new Date()).map((x: any) => x.id)
    if (openIds.length === 0) { setOpenBetsToVoteCount(0); return }
    const { data: myVotes } = await supabase
      .from('free_bet_votes').select('bet_id').eq('profile_id', session.user.id).in('bet_id', openIds)
    const voted = new Set((myVotes ?? []).map((v: any) => v.bet_id))
    setOpenBetsToVoteCount(openIds.filter((id: string) => !voted.has(id)).length)
  }

  useEffect(() => {
    refreshOpenBetsToVoteCount()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup?.id, session?.user?.id, screen])

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

  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null)
  const [pushErrorDetail, setPushErrorDetail] = useState<string | null>(null)
  const [pushTipDismissed, setPushTipDismissed] = useState(false)
  const [pushEnabling, setPushEnabling] = useState(false)

  useEffect(() => {
    if (!session?.user?.id) return
    subscribeToPush(session.user.id).then((r) => { setPushStatus(r.status); setPushErrorDetail(r.detail ?? null) })
  }, [session?.user?.id])

  const enablePushNow = async () => {
    if (!session?.user?.id || pushEnabling) return
    setPushEnabling(true)
    const r = await subscribeToPush(session.user.id, true)
    setPushStatus(r.status)
    setPushErrorDetail(r.detail ?? null)
    setPushEnabling(false)
  }

  const markNotifRead = async (id: string) => {
    await supabase.from('notifications').update({ read: true }).eq('id', id)
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }

  const markAllNotifsRead = async () => {
    if (!session?.user?.id) return
    await supabase.from('notifications').update({ read: true }).eq('profile_id', session.user.id).eq('read', false)
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  // Envoyer un wizz directement depuis une notif "X joue aux Jonglages" dans
  // la cloche : marche même si on a raté le bandeau temps réel (pas connecté
  // au bon moment) puisque ça passe par la même RPC que le wizz "live", qui
  // enregistre une notif + push pour le destinataire.
  const sendWizzFromNotification = (n: any) => {
    if (!n.related_profile_id || !n.ref_id) return
    supabase.rpc('notify_wizz', { p_target_profile_id: n.related_profile_id, p_group_id: n.ref_id })
    markNotifRead(n.id)
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
                      {n.type === 'jongle' && n.related_profile_id && (
                        <button
                          className="juggle-wizz-btn"
                          onClick={(e) => { e.stopPropagation(); sendWizzFromNotification(n) }}
                        >🧪 Envoyer un wizz</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
        <button className="home-signout" onClick={signOut}>
          Déconnexion
        </button>
      </header>
      {!pushTipDismissed && pushStatus === 'ios-needs-install' && (
        <div className="push-tip">
          <span>📲 Pour recevoir les notifications sur iPhone : appuie sur Partager, puis « Sur l'écran d'accueil », et rouvre l'appli depuis cette icône.</span>
          <button className="wizz-alert-close" onClick={() => setPushTipDismissed(true)} aria-label="Fermer">✕</button>
        </div>
      )}
      {!pushTipDismissed && pushStatus === 'needs-permission' && (
        <div className="push-tip">
          <span>🔔 Active les notifications pour ne rien rater (wizz, résultats, nouveaux duels).</span>
          <button className="groups-action-btn groups-action-btn-secondary" disabled={pushEnabling} onClick={enablePushNow}>
            {pushEnabling ? '...' : 'Activer'}
          </button>
          <button className="wizz-alert-close" onClick={() => setPushTipDismissed(true)} aria-label="Fermer">✕</button>
        </div>
      )}
      {!pushTipDismissed && pushStatus === 'denied' && (
        <div className="push-tip">
          <span>🔕 Notifications désactivées pour ce site — active-les dans les réglages de ton navigateur si tu veux recevoir les alertes.</span>
          <button className="wizz-alert-close" onClick={() => setPushTipDismissed(true)} aria-label="Fermer">✕</button>
        </div>
      )}
      {!pushTipDismissed && pushStatus === 'unsupported' && (
        <div className="push-tip">
          <span>🔕 Ce navigateur ne permet pas les notifications sur ce site.</span>
          <button className="wizz-alert-close" onClick={() => setPushTipDismissed(true)} aria-label="Fermer">✕</button>
        </div>
      )}
      {!pushTipDismissed && pushStatus === 'error' && (
        <div className="push-tip">
          <span>
            ⚠️ Impossible d'activer les notifications pour l'instant.
            {pushErrorDetail && <><br /><small>({pushErrorDetail})</small></>}
          </span>
          <button className="groups-action-btn groups-action-btn-secondary" disabled={pushEnabling} onClick={enablePushNow}>
            {pushEnabling ? '...' : 'Réessayer'}
          </button>
          <button className="wizz-alert-close" onClick={() => setPushTipDismissed(true)} aria-label="Fermer">✕</button>
        </div>
      )}
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
                    {s.key === 'paris' && openBetsToVoteCount > 0 && (
                      <span className="notif-badge">{openBetsToVoteCount}</span>
                    )}
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
                onVoteOrCreate={refreshOpenBetsToVoteCount}
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
          <>
            <Groups
              onSelectGroup={(id, name) => setSelectedGroup({ id, name })}
            />
            <div className="account-danger-zone">
              {!showDeleteConfirm ? (
                <button className="account-delete-link" onClick={() => setShowDeleteConfirm(true)}>
                  Supprimer mon compte
                </button>
              ) : (
                <div className="account-delete-confirm">
                  <p>
                    Cette action est définitive : tu quittes tous tes groupes, ton pseudo et tes
                    abonnements aux notifications sont supprimés, et tu ne pourras plus te
                    reconnecter avec ce compte.
                  </p>
                  {deleteError && <p className="groups-error">{deleteError}</p>}
                  <div className="account-delete-actions">
                    <button
                      className="groups-action-btn groups-action-btn-secondary"
                      disabled={deleteBusy}
                      onClick={() => { setShowDeleteConfirm(false); setDeleteError(null) }}
                    >
                      Annuler
                    </button>
                    <button className="account-delete-confirm-btn" disabled={deleteBusy} onClick={handleDeleteAccount}>
                      {deleteBusy ? 'Suppression...' : 'Oui, supprimer définitivement'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
