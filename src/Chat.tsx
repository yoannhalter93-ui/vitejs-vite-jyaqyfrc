// Écran de tchat de groupe : liste des messages (mise à jour en direct via
// Supabase Realtime) + barre de saisie, affichés par-dessus le fond
// décoratif ChatBackground.

import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'
import Avatar from './Avatar'
import ChatBackground from './ChatBackground'
import LoadingSkeleton from './LoadingSkeleton'

interface Props {
  groupId: string
  groupName: string
}

interface Message {
  id: string
  group_id: string
  profile_id: string
  content: string
  created_at: string
}

interface Reaction {
  message_id: string
  profile_id: string
  emoji: string
}

// mêmes valeurs que la contrainte CHECK de message_reactions
const REACTION_EMOJIS = ['👍', '😂', '🔥', '😮', '😢', '⚽']

interface ProfileInfo {
  pseudo: string
  avatar_url: string | null
  avatar_emoji: string | null
}

function sameReaction(a: Reaction, b: Reaction) {
  return a.message_id === b.message_id && a.profile_id === b.profile_id && a.emoji === b.emoji
}

// Pastilles "🔥 3" sous une bulle ; appui = ajouter/retirer ma réaction,
// l'infobulle liste qui a réagi.
function ReactionChips({ reactions, myId, profiles, onToggle }: {
  reactions: Reaction[]
  myId: string | undefined
  profiles: Record<string, ProfileInfo>
  onToggle: (emoji: string) => void
}) {
  if (reactions.length === 0) return null
  const byEmoji = REACTION_EMOJIS
    .map((e) => ({ emoji: e, list: reactions.filter((r) => r.emoji === e) }))
    .filter((x) => x.list.length > 0)
  return (
    <div className="chat-reactions">
      {byEmoji.map(({ emoji, list }) => (
        <button
          key={emoji}
          type="button"
          className={'chat-reaction-chip' + (list.some((r) => r.profile_id === myId) ? ' chat-reaction-chip-mine' : '')}
          title={list.map((r) => profiles[r.profile_id]?.pseudo ?? '?').join(', ')}
          onClick={() => onToggle(emoji)}
        >
          {emoji} {list.length}
        </button>
      ))}
    </div>
  )
}

export default function Chat({ groupId, groupName }: Props) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [profiles, setProfiles] = useState<Record<string, ProfileInfo>>({})
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [reactions, setReactions] = useState<Reaction[]>([])
  // message dont le sélecteur de réactions est ouvert (un tap sur la bulle)
  const [pickerFor, setPickerFor] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    ;(async () => {
      const { data: members } = await supabase
        .from('group_members')
        .select('profile_id')
        .eq('group_id', groupId)
      const ids = (members ?? []).map((m) => m.profile_id)

      if (ids.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, pseudo, avatar_url, avatar_emoji')
          .in('id', ids)
        if (!cancelled) {
          setProfiles(
            Object.fromEntries(
              (profs ?? []).map((p) => [
                p.id,
                { pseudo: p.pseudo, avatar_url: p.avatar_url, avatar_emoji: p.avatar_emoji },
              ])
            )
          )
        }
      }

      const { data: msgs } = await supabase
        .from('messages')
        .select('id, group_id, profile_id, content, created_at')
        .eq('group_id', groupId)
        .order('created_at', { ascending: true })
        .limit(200)

      const ids2 = (msgs ?? []).map((m) => m.id)
      const { data: reacts } = ids2.length
        ? await supabase.from('message_reactions').select('message_id, profile_id, emoji').in('message_id', ids2)
        : { data: [] as Reaction[] }

      if (!cancelled) {
        setMessages(msgs ?? [])
        setReactions((reacts ?? []) as Reaction[])
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [groupId])

  useEffect(() => {
    const channel = supabase
      .channel(`messages-${groupId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_id=eq.${groupId}` },
        (payload: any) => {
          const row = payload.new as Message
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]))
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_reactions', filter: `group_id=eq.${groupId}` },
        (payload: any) => {
          const r = payload.new as Reaction
          setReactions((prev) => (prev.some((x) => sameReaction(x, r)) ? prev : [...prev, r]))
        }
      )
      .on(
        'postgres_changes',
        // les DELETE ne sont pas filtrables côté Realtime : on reçoit ceux de
        // tous les groupes visibles, sans effet si la réaction n'est pas ici
        { event: 'DELETE', schema: 'public', table: 'message_reactions' },
        (payload: any) => {
          const r = payload.old as Reaction
          setReactions((prev) => prev.filter((x) => !sameReaction(x, r)))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [groupId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!user?.id) return
    setPickerFor(null)
    const mine = { message_id: messageId, profile_id: user.id, emoji }
    const exists = reactions.some((r) => sameReaction(r, mine))
    // mise à jour optimiste, annulée si le serveur refuse
    setReactions((prev) => (exists ? prev.filter((r) => !sameReaction(r, mine)) : [...prev, mine]))
    const { error } = exists
      ? await supabase.from('message_reactions').delete()
          .eq('message_id', messageId).eq('profile_id', user.id).eq('emoji', emoji)
      : await supabase.from('message_reactions').insert(mine)
    if (error) {
      setReactions((prev) => (exists ? [...prev, mine] : prev.filter((r) => !sameReaction(r, mine))))
    }
  }

  const handleSend = async () => {
    const content = text.trim()
    if (!content || !user?.id || sending) return
    setSending(true)
    setText('')
    const { error } = await supabase.from('messages').insert({
      group_id: groupId,
      profile_id: user.id,
      content,
    })
    setSending(false)
    if (error) {
      // on remet le texte dans le champ pour ne pas perdre le message
      setText(content)
    }
  }

  return (
    <ChatBackground>
      <div className="chat-screen">
        <h2 className="chat-title">Tchat — {groupName}</h2>
        <div className="chat-messages">
          {loading ? (
            <LoadingSkeleton rows={4} />
          ) : messages.length === 0 ? (
            <p className="chat-empty">Aucun message pour l'instant. Lance la discussion !</p>
          ) : (
            messages.map((m) => {
              const isMe = m.profile_id === user?.id
              const prof = profiles[m.profile_id]
              return (
                <div key={m.id} className={'chat-bubble-row' + (isMe ? ' chat-bubble-row-me' : '')}>
                  {!isMe && (
                    <Avatar
                      pseudo={prof?.pseudo ?? '?'}
                      avatarUrl={prof?.avatar_url}
                      avatarEmoji={prof?.avatar_emoji}
                      size={28}
                    />
                  )}
                  <div className="chat-bubble-col">
                    <div
                      className={'chat-bubble' + (isMe ? ' chat-bubble-me' : '')}
                      onClick={() => setPickerFor((cur) => (cur === m.id ? null : m.id))}
                    >
                      {!isMe && <span className="chat-bubble-author">{prof?.pseudo ?? '???'}</span>}
                      <span className="chat-bubble-text">{m.content}</span>
                      <span className="chat-bubble-time">
                        {new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {pickerFor === m.id && (
                      <div className="chat-reaction-picker">
                        {REACTION_EMOJIS.map((e) => (
                          <button key={e} type="button" onClick={() => toggleReaction(m.id, e)}>{e}</button>
                        ))}
                      </div>
                    )}
                    <ReactionChips
                      reactions={reactions.filter((r) => r.message_id === m.id)}
                      myId={user?.id}
                      profiles={profiles}
                      onToggle={(e) => toggleReaction(m.id, e)}
                    />
                  </div>
                </div>
              )
            })
          )}
          <div ref={bottomRef} />
        </div>
        <form
          className="chat-input-bar"
          onSubmit={(e) => {
            e.preventDefault()
            handleSend()
          }}
        >
          <input
            type="text"
            className="chat-input"
            placeholder="Écris un message…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
          />
          <button type="submit" className="chat-send-btn" disabled={!text.trim() || sending}>
            Envoyer
          </button>
        </form>
      </div>
    </ChatBackground>
  )
}
