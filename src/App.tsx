import { supabase } from './supabaseClient'
import { useState, useEffect } from 'react';
import './App.css';
import { useAuth } from './AuthContext';
import Login from './Login';
import PasswordRecovery from './PasswordRecovery';
import Groups from './Groups';
import Home from './Home';
import BottomNav from './BottomNav';
import Predictions from './Predictions';
import Classement from './Classement';
import Roulette from './Roulette';
import TeamReveal from './TeamReveal';
import PenaltyDuel from './PenaltyDuel';
import WeeklyDuel from './WeeklyDuel';
import FreeBets from './FreeBets';
import JuggleGame from './JuggleGame';
import DribbleGame from './DribbleGame';
import Avatar, { AVATAR_EMOJIS } from './Avatar'
import PredictionsHistory from './PredictionsHistory'
import Help from './Help'

// Recadre l'image importée en carré (centré) et la redimensionne, pour que
// toutes les photos de profil aient le même format avant l'upload — évite
// d'envoyer des fichiers énormes ou des rectangles déformés par le CSS.
function cropImageToSquare(file: File, size: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const side = Math.min(img.width, img.height)
      const sx = (img.width - side) / 2
      const sy = (img.height - side) / 2
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas non disponible sur cet appareil.')); return }
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error("Échec de la conversion de l'image."))
      }, 'image/jpeg', 0.85)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Impossible de lire cette image.")) }
    img.src = url
  })
}

type Screen =
  | 'accueil'
  | 'pronostics'
  | 'classement'
  | 'jeux'
  | 'roulette'
  | 'penalty'
  | 'quiz'
  | 'paris'
  | 'jonglages'
  | 'profil'
  | 'parametres'
  | 'historique-pronos'
  | 'aide'
  // écran d'accueil de groupe (une seule fois, à la première entrée dans
  // un groupe) : explique + révèle l'équipe tirée au sort, voir TeamReveal
  | 'team-reveal';

// les 5 onglets de la barre de navigation en bas — "Jeux" regroupe les
// mini-jeux (Mon équipe / Duel penalty / Quiz / Mini-jeu), atteints via le
// hub plutôt que directement depuis la barre
const BOTTOM_TABS: { key: Screen; label: string; icon: string }[] = [
  { key: 'accueil', label: 'Accueil', icon: '⚽' },
  { key: 'classement', label: 'Classement', icon: '🏆' },
  { key: 'jeux', label: 'Jeux', icon: '🎮' },
  { key: 'paris', label: 'Paris', icon: '🤝' },
  { key: 'profil', label: 'Profil', icon: '👤' },
]

const JEUX_HUB: { key: Screen; label: string; icon: string; sub: string }[] = [
  { key: 'roulette', label: 'Mon équipe', icon: '🎡', sub: 'Ton équipe tirée au sort' },
  { key: 'penalty', label: 'Duel penalty', icon: '🥅', sub: 'Défie un membre du groupe' },
  { key: 'quiz', label: 'Quiz', icon: '🧠', sub: 'Duel de questions foot' },
  { key: 'jonglages', label: 'Mini-jeu', icon: '🤹', sub: 'Le défi de la semaine' },
]

// à quel onglet du bas rattacher chaque écran interne (ex. "pronostics",
// atteint depuis le tableau de bord, reste sous l'onglet "Pronos")
function bottomTabFor(screen: Screen): Screen {
  if (screen === 'pronostics') return 'accueil'
  if (screen === 'roulette' || screen === 'penalty' || screen === 'quiz' || screen === 'jonglages') return 'jeux'
  if (screen === 'parametres' || screen === 'historique-pronos' || screen === 'aide') return 'profil'
  return screen
}

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

type PushStatus = 'ok' | 'unsupported' | 'ios-needs-install' | 'needs-permission' | 'denied' | 'error' | 'disabled'

// Un abonnement push est propre à cet appareil/navigateur (l'endpoint est
// stocké par ligne dans push_subscriptions) — la préférence "j'ai désactivé
// les notifications" est donc, logiquement, elle aussi locale à l'appareil :
// pas besoin d'une colonne en base, juste ce petit drapeau localStorage pour
// empêcher le useEffect de mount de se ré-abonner automatiquement tant que
// la permission navigateur reste "granted".
const PUSH_DISABLED_KEY = 'entrenous_push_disabled'

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
  // Lien de réinitialisation de mot de passe : Supabase redirige ici avec
  // "type=recovery" dans le hash et connecte temporairement la personne le
  // temps qu'elle choisisse un nouveau mot de passe — on l'intercepte avant
  // tout le reste pour lui montrer l'écran dédié plutôt que l'appli.
  const [isRecovery, setIsRecovery] = useState(() => window.location.hash.includes('type=recovery'))
  const [juggleAlert, setJuggleAlert] = useState<{ profileId: string; pseudo: string; game: string } | null>(null)
  const [myPseudo, setMyPseudo] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarEmoji, setAvatarEmoji] = useState<string | null>(null)
  const [editingPseudo, setEditingPseudo] = useState(false)
  const [pseudoInput, setPseudoInput] = useState('')
  const [pseudoSaving, setPseudoSaving] = useState(false)
  const [pseudoError, setPseudoError] = useState<string | null>(null)
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [avatarSaving, setAvatarSaving] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [changingPassword, setChangingPassword] = useState(false)
  const [newPasswordInput, setNewPasswordInput] = useState('')
  const [newPasswordConfirmInput, setNewPasswordConfirmInput] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  // Petites fonctionnalités du nouvel écran Paramètres pas encore
  // développées (thème, confidentialité...) : au lieu de masquer la ligne,
  // on l'affiche mais elle ouvre juste ce petit message générique.
  const [comingSoon, setComingSoon] = useState<string | null>(null)
  const [wizzChannel, setWizzChannel] = useState<ReturnType<typeof supabase.channel> | null>(null)
  // mini-jeu hebdomadaire actif (jonglages ou dribble) : change chaque
  // semaine via public.minigame_weeks, même classement/mêmes récompenses
  // des deux côtés, seul le jeu affiché change.
  const [activeMinigame, setActiveMinigame] = useState<'jonglage' | 'dribble'>('jonglage')

  useEffect(() => {
    const checkActiveMinigame = () => {
      supabase.rpc('get_active_minigame').then(({ data, error }: any) => {
        if (!error && data) setActiveMinigame(data)
      })
    }
    checkActiveMinigame()
    // Le mini-jeu actif change chaque lundi à minuit UTC : sans ceci, une
    // appli restée ouverte en arrière-plan à ce moment-là (PWA relancée
    // depuis le multitâche plutôt que vraiment fermée) continuerait
    // d'afficher l'ancien jeu jusqu'à un vrai redémarrage — on revérifie
    // donc aussi à chaque retour au premier plan.
    const onVisible = () => { if (document.visibilityState === 'visible') checkActiveMinigame() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

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
    supabase
      .from('profiles')
      .select('pseudo, avatar_url, avatar_emoji')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        setMyPseudo(data?.pseudo ?? null)
        setAvatarUrl(data?.avatar_url ?? null)
        setAvatarEmoji(data?.avatar_emoji ?? null)
      })
  }, [session?.user?.id])

  // Choix du pseudo : validation légère (longueur) puis mise à jour directe
  // de la ligne profiles — la policy RLS "modifier son profil" (id =
  // auth.uid()) autorise déjà ce self-service, aucun changement côté base
  // n'a été nécessaire pour ça.
  const handleSavePseudo = async () => {
    const trimmed = pseudoInput.trim()
    if (trimmed.length < 2) {
      setPseudoError('Le pseudo doit faire au moins 2 caractères.')
      return
    }
    if (trimmed.length > 20) {
      setPseudoError('Le pseudo doit faire au plus 20 caractères.')
      return
    }
    if (!session?.user?.id) return
    setPseudoSaving(true)
    setPseudoError(null)
    const { error } = await supabase.from('profiles').update({ pseudo: trimmed }).eq('id', session.user.id)
    setPseudoSaving(false)
    if (error) {
      setPseudoError(error.message)
      return
    }
    setMyPseudo(trimmed)
    setEditingPseudo(false)
  }

  // Changement de mot de passe : Supabase permet de mettre à jour le mot de
  // passe de la session en cours sans redemander l'ancien (auth.updateUser),
  // donc pas besoin de champ "mot de passe actuel" ici — la personne est
  // déjà authentifiée pour arriver jusqu'à cet écran.
  const handleChangePassword = async () => {
    setPasswordError(null)
    if (newPasswordInput.length < 6) {
      setPasswordError('Le mot de passe doit faire au moins 6 caractères.')
      return
    }
    if (newPasswordInput !== newPasswordConfirmInput) {
      setPasswordError('Les deux mots de passe ne correspondent pas.')
      return
    }
    setPasswordSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPasswordInput })
    setPasswordSaving(false)
    if (error) {
      setPasswordError(error.message)
      return
    }
    setChangingPassword(false)
    setNewPasswordInput('')
    setNewPasswordConfirmInput('')
  }

  // Choix d'un avatar emoji parmi les préréglages : instantané, et efface
  // une éventuelle photo précédente (les deux champs sont mutuellement
  // exclusifs, voir le composant Avatar).
  const handleSelectEmoji = async (emoji: string) => {
    if (!session?.user?.id) return
    setAvatarSaving(true)
    setAvatarError(null)
    const { error } = await supabase.from('profiles').update({ avatar_emoji: emoji, avatar_url: null }).eq('id', session.user.id)
    setAvatarSaving(false)
    if (error) {
      setAvatarError(error.message)
      return
    }
    setAvatarEmoji(emoji)
    setAvatarUrl(null)
    setShowAvatarPicker(false)
  }

  // Import d'une vraie photo : recadrage carré côté client, upload dans le
  // bucket public "avatars" (chemin {user_id}/avatar.jpg, upsert pour
  // remplacer une ancienne photo), puis on stocke l'URL publique. Le "?v="
  // force le navigateur à recharger l'image après un remplacement, vu que
  // le chemin de fichier ne change jamais.
  const handlePhotoInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !session?.user?.id) return
    setAvatarSaving(true)
    setAvatarError(null)
    try {
      const blob = await cropImageToSquare(file, 256)
      const path = `${session.user.id}/avatar.jpg`
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, blob, {
        upsert: true,
        contentType: 'image/jpeg',
      })
      if (uploadError) throw uploadError
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      const publicUrl = `${data.publicUrl}?v=${Date.now()}`
      const { error: updateError } = await supabase.from('profiles').update({ avatar_url: publicUrl, avatar_emoji: null }).eq('id', session.user.id)
      if (updateError) throw updateError
      setAvatarUrl(publicUrl)
      setAvatarEmoji(null)
      setShowAvatarPicker(false)
    } catch (err: any) {
      setAvatarError(err?.message || "Impossible d'importer cette photo.")
    } finally {
      setAvatarSaving(false)
    }
  }

  useEffect(() => {
    if (!selectedGroup?.id || !session?.user?.id) return
    const channel = supabase.channel(`wizz-${selectedGroup.id}`)
    let hideTimer: ReturnType<typeof setTimeout> | null = null
    channel.on('broadcast', { event: 'playing' }, ({ payload }: any) => {
      if (!payload || payload.profileId === session.user.id) return
      if (payload.action === 'start') {
        setJuggleAlert({ profileId: payload.profileId, pseudo: payload.pseudo || 'Un coéquipier', game: payload.game || 'jonglage' })
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

  const [screen, setScreen] = useState<Screen>('accueil');

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
    if (typeof window !== 'undefined' && window.localStorage.getItem(PUSH_DISABLED_KEY) === '1') {
      setPushStatus('disabled')
      return
    }
    subscribeToPush(session.user.id).then((r) => { setPushStatus(r.status); setPushErrorDetail(r.detail ?? null) })
  }, [session?.user?.id])

  const enablePushNow = async () => {
    if (!session?.user?.id || pushEnabling) return
    setPushEnabling(true)
    if (typeof window !== 'undefined') window.localStorage.removeItem(PUSH_DISABLED_KEY)
    const r = await subscribeToPush(session.user.id, true)
    setPushStatus(r.status)
    setPushErrorDetail(r.detail ?? null)
    setPushEnabling(false)
  }

  // Désactivation depuis l'appli : on ne peut pas révoquer la permission
  // navigateur en JS (aucune API pour ça), donc on se contente de se
  // désabonner (côté navigateur ET en base) et de mémoriser le choix
  // localement pour que le useEffect de mount ne se ré-abonne pas tout seul
  // au prochain lancement — un vrai bouton on/off plutôt qu'un "activer"
  // à sens unique.
  const disablePushNow = async () => {
    if (pushEnabling) return
    setPushEnabling(true)
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration()
        const sub = await reg?.pushManager.getSubscription()
        if (sub) {
          const endpoint = sub.endpoint
          await sub.unsubscribe()
          await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
        }
      }
      if (typeof window !== 'undefined') window.localStorage.setItem(PUSH_DISABLED_KEY, '1')
      setPushStatus('disabled')
      setPushErrorDetail(null)
    } finally {
      setPushEnabling(false)
    }
  }

  const toggleNotifications = () => {
    if (pushStatus === 'ok') {
      disablePushNow()
    } else {
      enablePushNow()
    }
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

  // Clique sur une notif de duel (quiz ou penalty) : avant, ça se contentait
  // de la marquer comme lue, donc avec plusieurs groupes ayant chacun leur
  // propre duel de la semaine, impossible de savoir lequel la notif
  // concernait — on tombait facilement sur "en attente de l'adversaire"
  // d'un AUTRE duel que celui visé par la notif. Maintenant ça emmène
  // directement vers le bon groupe + le bon jeu.
  const goToNotification = async (n: any) => {
    if (!n.read) markNotifRead(n.id)
    if (n.ref_table === 'weekly_duels' || n.ref_table === 'penalty_duels') {
      const { data: duelRow } = await supabase.from(n.ref_table).select('group_id').eq('id', n.ref_id).maybeSingle()
      if (!duelRow?.group_id) return
      const { data: groupRow } = await supabase.from('groups').select('name').eq('id', duelRow.group_id).maybeSingle()
      await handleSelectGroup(duelRow.group_id, groupRow?.name ?? '')
      setScreen(n.ref_table === 'weekly_duels' ? 'quiz' : 'penalty')
      setShowNotifPanel(false)
    } else if (n.ref_table === 'groups' && n.ref_id) {
      const { data: groupRow } = await supabase.from('groups').select('name').eq('id', n.ref_id).maybeSingle()
      await handleSelectGroup(n.ref_id, groupRow?.name ?? '')
      setShowNotifPanel(false)
    }
  }

  const handleUseBonus = (code: string) => {
    if (code === 'double_ou_rien') {
      setShowBonusPanel(false)
      setScreen('paris')
      return
    }
    openBonusTargetPicker(code)
  }

  // Quand on entre dans un groupe : si on ne l'a encore jamais vu (nouveau
  // membre), on passe par l'écran "team-reveal" qui explique le tirage au
  // sort d'équipe et l'anime, avant l'accueil normal. Les membres qui l'ont
  // déjà vu (flag posé par mark_team_reveal_seen, ou backfillé à true pour
  // tous les membres existant avant ce correctif) vont directement à l'accueil.
  const handleSelectGroup = async (id: string, name: string) => {
    setSelectedGroup({ id, name })
    if (session?.user?.id) {
      const { data } = await supabase
        .from('group_members')
        .select('team_reveal_seen')
        .eq('group_id', id)
        .eq('profile_id', session.user.id)
        .maybeSingle()
      if (data?.team_reveal_seen === false) {
        setScreen('team-reveal')
        return
      }
    }
    setScreen('accueil')
  }

  // Carte profil (photo/emoji + pseudo, éditables) — partagée entre les deux
  // écrans Profil (avec et sans groupe sélectionné) pour ne pas dupliquer
  // toute la logique d'édition ; showJetons masque juste la ligne jetons
  // quand aucun groupe n'est sélectionné (le solde est par groupe).
  // Écran Profil : grande photo + pseudo (édition via la modale de pseudo
  // partagée, voir plus bas), puis le menu de navigation vers les autres
  // écrans liés au compte. hasGroup affiche en plus "Retour à mes groupes"
  // quand on y accède sans avoir encore rejoint de groupe.
  const renderProfilScreen = (hasGroup: boolean) => (
    <div className="profil-v2-screen">
      <div className="profil-v2-hero">
        <div className="profil-avatar-wrap profil-v2-avatar-wrap">
          <Avatar pseudo={myPseudo ?? '?'} avatarUrl={avatarUrl} avatarEmoji={avatarEmoji} size={110} className="profil-v2-avatar" />
          <button
            className="profil-avatar-edit-btn"
            onClick={() => { setShowAvatarPicker(true); setAvatarError(null) }}
            aria-label="Changer de photo"
            title="Changer de photo"
          >
            📷
          </button>
        </div>
        <button
          className="profil-v2-name-btn"
          onClick={() => { setPseudoInput(myPseudo ?? ''); setPseudoError(null); setEditingPseudo(true) }}
        >
          {myPseudo ?? 'Joueur'}
        </button>
      </div>

      <div className="profil-v2-menu">
        <button className="profil-v2-menu-row" onClick={() => setComingSoon('Mes statistiques')}>
          <span className="profil-v2-menu-icon">📊</span>
          <span className="profil-v2-menu-label">Mes statistiques</span>
          <span className="profil-v2-menu-chevron">›</span>
        </button>
        <button className="profil-v2-menu-row" onClick={() => setComingSoon('Mes badges')}>
          <span className="profil-v2-menu-icon">🛡️</span>
          <span className="profil-v2-menu-label">Mes badges</span>
          <span className="profil-v2-menu-chevron">›</span>
        </button>
        <button className="profil-v2-menu-row" onClick={() => setScreen('historique-pronos')}>
          <span className="profil-v2-menu-icon">📋</span>
          <span className="profil-v2-menu-label">Historique de mes pronos</span>
          <span className="profil-v2-menu-chevron">›</span>
        </button>
        <button className="profil-v2-menu-row" onClick={() => setScreen('parametres')}>
          <span className="profil-v2-menu-icon">⚙️</span>
          <span className="profil-v2-menu-label">Paramètres</span>
          <span className="profil-v2-menu-chevron">›</span>
        </button>
        <button className="profil-v2-menu-row" onClick={() => setScreen('aide')}>
          <span className="profil-v2-menu-icon">❓</span>
          <span className="profil-v2-menu-label">Aide</span>
          <span className="profil-v2-menu-chevron">›</span>
        </button>
        <button className="profil-v2-menu-row profil-v2-menu-row-danger" onClick={signOut}>
          <span className="profil-v2-menu-icon">🚪</span>
          <span className="profil-v2-menu-label">Déconnexion</span>
          <span className="profil-v2-menu-chevron">›</span>
        </button>
      </div>

      {!hasGroup && (
        <button className="groups-action-btn groups-action-btn-secondary profil-v2-back-groups" onClick={() => setScreen('accueil')}>
          Retour à mes groupes
        </button>
      )}

      <div className="profil-v2-tagline" aria-hidden="true">
        <span>Toujours plus de foot<br />entre potes</span>
        <span className="profil-v2-tagline-smiley">🙂</span>
      </div>
    </div>
  )

  // Le bouton Déconnexion / la zone "Supprimer mon compte" doivent rester
  // accessibles dans tous les cas (avec ou sans groupe sélectionné, sur
  // l'écran Profil comme sur la liste des groupes) — d'où ce petit bloc
  // partagé plutôt que trois copies qui risqueraient de diverger.
  const renderAccountFooter = () => (
    <>
      <button className="home-signout" onClick={signOut}>
        Déconnexion
      </button>
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
  )

  if (isRecovery) {
    return <PasswordRecovery onDone={() => setIsRecovery(false)} />;
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
        <div className="brand-block">
          <span className="brand-logo">Entre Nous</span>
          <span className="brand-tagline">Foot entre potes</span>
        </div>
        <div className="header-actions">
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
                  <div key={n.id} className={`notif-row ${n.read ? '' : 'notif-unread'}`} onClick={() => goToNotification(n)}>
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
          <button className="avatar-badge" onClick={() => setScreen('profil')} title={myPseudo ?? undefined}>
            <Avatar pseudo={myPseudo ?? '?'} avatarUrl={avatarUrl} avatarEmoji={avatarEmoji} size={36} />
          </button>
        </div>
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
          <span>{juggleAlert.game === 'dribble' ? '⚽' : '🤹'} {juggleAlert.pseudo} joue au mini-jeu !</span>
          {juggleAlert.game !== 'dribble' && (
            <button className="juggle-wizz-btn" onClick={sendWizz}>🧪 Envoyer un wizz</button>
          )}
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
      {showAvatarPicker && (
        <div className="avatar-picker-overlay" onClick={() => setShowAvatarPicker(false)}>
          <div className="avatar-picker-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Choisis ta photo</h3>
            {avatarError && <p className="groups-error">{avatarError}</p>}
            <label className={"avatar-upload-btn" + (avatarSaving ? " avatar-upload-btn-disabled" : "")}>
              {avatarSaving ? 'Envoi...' : '📤 Importer une photo'}
              <input type="file" accept="image/*" hidden disabled={avatarSaving} onChange={handlePhotoInputChange} />
            </label>
            <p className="avatar-picker-or">ou choisis un avatar</p>
            <div className="avatar-emoji-grid">
              {AVATAR_EMOJIS.map((e) => (
                <button
                  key={e}
                  className={"avatar-emoji-option" + (avatarEmoji === e && !avatarUrl ? " avatar-emoji-option-active" : "")}
                  disabled={avatarSaving}
                  onClick={() => handleSelectEmoji(e)}
                >
                  {e}
                </button>
              ))}
            </div>
            <button className="groups-action-btn groups-action-btn-secondary" onClick={() => setShowAvatarPicker(false)}>
              Fermer
            </button>
          </div>
        </div>
      )}
      {editingPseudo && (
        <div className="avatar-picker-overlay" onClick={() => { setEditingPseudo(false); setPseudoError(null) }}>
          <div className="avatar-picker-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Ton pseudo</h3>
            <input
              className="profil-pseudo-input"
              value={pseudoInput}
              maxLength={20}
              autoFocus
              onChange={(e) => setPseudoInput(e.target.value)}
            />
            {pseudoError && <p className="groups-error">{pseudoError}</p>}
            <div className="profil-pseudo-edit-actions">
              <button
                className="groups-action-btn groups-action-btn-secondary"
                disabled={pseudoSaving}
                onClick={() => { setEditingPseudo(false); setPseudoError(null) }}
              >
                Annuler
              </button>
              <button className="groups-action-btn" disabled={pseudoSaving} onClick={handleSavePseudo}>
                {pseudoSaving ? '...' : 'Valider'}
              </button>
            </div>
          </div>
        </div>
      )}
      {changingPassword && (
        <div className="avatar-picker-overlay" onClick={() => { setChangingPassword(false); setPasswordError(null) }}>
          <div className="avatar-picker-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Nouveau mot de passe</h3>
            <input
              className="profil-pseudo-input"
              type="password"
              placeholder="Nouveau mot de passe"
              value={newPasswordInput}
              autoFocus
              onChange={(e) => setNewPasswordInput(e.target.value)}
            />
            <input
              className="profil-pseudo-input profil-password-input-confirm"
              type="password"
              placeholder="Confirmer le mot de passe"
              value={newPasswordConfirmInput}
              onChange={(e) => setNewPasswordConfirmInput(e.target.value)}
            />
            {passwordError && <p className="groups-error">{passwordError}</p>}
            <div className="profil-pseudo-edit-actions">
              <button
                className="groups-action-btn groups-action-btn-secondary"
                disabled={passwordSaving}
                onClick={() => { setChangingPassword(false); setPasswordError(null) }}
              >
                Annuler
              </button>
              <button className="groups-action-btn" disabled={passwordSaving} onClick={handleChangePassword}>
                {passwordSaving ? '...' : 'Valider'}
              </button>
            </div>
          </div>
        </div>
      )}
      {comingSoon && (
        <div className="avatar-picker-overlay" onClick={() => setComingSoon(null)}>
          <div className="avatar-picker-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{comingSoon}</h3>
            <p className="coming-soon-text">Bientôt disponible !</p>
            <button className="groups-action-btn groups-action-btn-secondary" onClick={() => setComingSoon(null)}>
              Fermer
            </button>
          </div>
        </div>
      )}
      <main className="home-main">
        {screen === 'parametres' ? (
          <div className="parametres-screen">
            <div className="predictions-header">
              <button className="predictions-back" onClick={() => setScreen('profil')}>← Profil</button>
              <h2>Paramètres</h2>
            </div>

            <div className="parametres-card">
              <h3 className="parametres-card-title">Compte</h3>
              <button
                className="parametres-row"
                onClick={() => { setPseudoInput(myPseudo ?? ''); setPseudoError(null); setEditingPseudo(true) }}
              >
                <span className="parametres-row-icon">👤</span>
                <span className="parametres-row-label">Nom d'utilisateur</span>
                <span className="parametres-row-value">{myPseudo ?? '—'}</span>
                <span className="parametres-row-chevron">›</span>
              </button>
              <div className="parametres-row parametres-row-static">
                <span className="parametres-row-icon">✉️</span>
                <span className="parametres-row-label">E-mail</span>
                <span className="parametres-row-value">{session?.user?.email ?? '—'}</span>
              </div>
              <button
                className="parametres-row"
                onClick={() => { setNewPasswordInput(''); setNewPasswordConfirmInput(''); setPasswordError(null); setChangingPassword(true) }}
              >
                <span className="parametres-row-icon">🔒</span>
                <span className="parametres-row-label">Mot de passe</span>
                <span className="parametres-row-value">••••••••</span>
                <span className="parametres-row-chevron">›</span>
              </button>
              <div className="parametres-row parametres-row-static">
                <span className="parametres-row-icon">🔔</span>
                <span className="parametres-row-label">Notifications</span>
                <button
                  className={"parametres-toggle" + (pushStatus === 'ok' ? " parametres-toggle-on" : "")}
                  disabled={pushEnabling || pushStatus === 'ios-needs-install' || pushStatus === 'unsupported'}
                  onClick={toggleNotifications}
                  aria-label={pushStatus === 'ok' ? 'Désactiver les notifications' : 'Activer les notifications'}
                  title={
                    pushStatus === 'ok'
                      ? 'Désactiver les notifications'
                      : pushStatus === 'denied'
                      ? "Bloquées dans les réglages du navigateur — débloque le site puis réessaie ici"
                      : pushStatus === 'ios-needs-install'
                      ? "Ajoute l'appli à l'écran d'accueil pour activer les notifications"
                      : pushStatus === 'unsupported'
                      ? 'Ce navigateur ne supporte pas les notifications sur ce site'
                      : 'Activer les notifications'
                  }
                >
                  <span className="parametres-toggle-knob" />
                </button>
              </div>
            </div>

            <div className="parametres-card">
              <h3 className="parametres-card-title">Préférences</h3>
              <button
                className="parametres-row"
                disabled={!selectedGroup}
                onClick={() => setScreen('roulette')}
              >
                <span className="parametres-row-icon">🛡️</span>
                <span className="parametres-row-label">Mon équipe</span>
                <span className="parametres-row-chevron">›</span>
              </button>
              <div className="parametres-row parametres-row-static">
                <span className="parametres-row-icon">🏆</span>
                <span className="parametres-row-label">Compétition</span>
                <span className="parametres-row-value">Ligue 1</span>
              </div>
              <button className="parametres-row" onClick={() => setComingSoon('Thème')}>
                <span className="parametres-row-icon">🌙</span>
                <span className="parametres-row-label">Thème</span>
                <span className="parametres-row-value">Sombre</span>
                <span className="parametres-row-chevron">›</span>
              </button>
            </div>

            <div className="parametres-card">
              <h3 className="parametres-card-title">Données</h3>
              <button className="parametres-row" onClick={() => setComingSoon('Confidentialité')}>
                <span className="parametres-row-icon">🛡️</span>
                <span className="parametres-row-label">Confidentialité</span>
                <span className="parametres-row-chevron">›</span>
              </button>
              {!showDeleteConfirm ? (
                <button className="parametres-row parametres-row-danger" onClick={() => setShowDeleteConfirm(true)}>
                  <span className="parametres-row-icon">🗑️</span>
                  <span className="parametres-row-label">Supprimer mon compte</span>
                  <span className="parametres-row-chevron">›</span>
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
          </div>
        ) : screen === 'historique-pronos' ? (
          <PredictionsHistory onBack={() => setScreen('profil')} />
        ) : screen === 'aide' ? (
          <Help onBack={() => setScreen('profil')} />
        ) : selectedGroup ? (
          <>
            {screen !== 'team-reveal' && (
            <div className="group-nav">
              <button className="group-selector-pill" onClick={() => setSelectedGroup(null)}>
                🏆 {selectedGroup.name} <span className="group-selector-chevron">⌄</span>
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
            </div>
            )}
            {(screen === 'roulette' || screen === 'penalty' || screen === 'quiz' || screen === 'jonglages') && (
              <button className="jeux-back-btn" onClick={() => setScreen('jeux')}>← Jeux</button>
            )}
            {screen === 'accueil' && (
              <Home
                groupId={selectedGroup.id}
                groupName={selectedGroup.name}
                onNavigate={(s) => setScreen(s)}
              />
            )}
            {screen === 'pronostics' && (
              <Predictions
                groupId={selectedGroup.id}
                groupName={selectedGroup.name}
                onBack={() => setScreen('accueil')}
              />
            )}
            {screen === 'classement' && (
              <Classement
                groupId={selectedGroup.id}
                groupName={selectedGroup.name}
              />
            )}
            {screen === 'jeux' && (
              <div className="jeux-hub">
                <h2 className="jeux-hub-title">Mini-jeux</h2>
                <div className="jeux-hub-grid">
                  {JEUX_HUB.map((j) => (
                    <button key={j.key} className="jeux-hub-card" onClick={() => setScreen(j.key)}>
                      <span className="jeux-hub-icon">{j.icon}</span>
                      <span className="jeux-hub-label">{j.label}</span>
                      <span className="jeux-hub-sub">{j.sub}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {screen === 'team-reveal' && (
              <TeamReveal
                groupId={selectedGroup.id}
                groupName={selectedGroup.name}
                onDone={() => setScreen('accueil')}
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
              activeMinigame === 'dribble' ? (
                <DribbleGame
                  groupId={selectedGroup.id}
                  groupName={selectedGroup.name}
                />
              ) : (
                <>
                  <div className="minigame-teaser">
                    <span className="minigame-teaser-icon">⚽</span>
                    <div className="minigame-teaser-text">
                      <b>Jeu de Dribble</b>
                      <span>Nouveau mini-jeu — bientôt ton tour</span>
                    </div>
                    <span className="minigame-teaser-tag">Bientôt disponible</span>
                  </div>
                  <JuggleGame
                    groupId={selectedGroup.id}
                    groupName={selectedGroup.name}
                  />
                </>
              )
            )}
            {screen === 'profil' && renderProfilScreen(true)}
          </>
        ) : screen === 'profil' ? (
          // Le bouton profil (avatar rond, en haut à droite) reste cliquable
          // même avant d'avoir rejoint un groupe — jusqu'ici, cliquer dessus
          // ici ne faisait rien puisque seul <Groups /> était rendu, quel que
          // soit l'écran demandé.
          renderProfilScreen(false)
        ) : (
          <>
            <Groups
              onSelectGroup={handleSelectGroup}
            />
            {renderAccountFooter()}
          </>
        )}
      </main>
      {selectedGroup && screen !== 'team-reveal' && (
        <BottomNav
          tabs={BOTTOM_TABS.map((t) => (t.key === 'paris' ? { ...t, badge: openBetsToVoteCount } : t))}
          active={bottomTabFor(screen)}
          onSelect={(key) => setScreen(key as Screen)}
        />
      )}
    </div>
  );
}

export default App;
