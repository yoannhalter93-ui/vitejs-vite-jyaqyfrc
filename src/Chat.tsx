// Écran de tchat de groupe : liste des messages (mise à jour en direct via
// Supabase Realtime) + barre de saisie, affichés par-dessus le fond
// décoratif ChatBackground.

import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'
import Avatar from './Avatar'
import ChatBackground from './ChatBackground'

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

interface ProfileInfo {
  pseudo: string
  avatar_url: string | null
  avatar_emoji: string | null
}

export default function Chat({ groupId, groupName }: Props) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [profiles, setProfiles] = useState<Record<string, ProfileInfo>>({})
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

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

      if (!cancelled) {
        setMessages(msgs ?? [])
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
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [groupId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

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
            <p className="chat-empty">Chargement…</p>
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
                  <div className={'chat-bubble' + (isMe ? ' chat-bubble-me' : '')}>
                    {!isMe && <span className="chat-bubble-author">{prof?.pseudo ?? '???'}</span>}
                    <span className="chat-bubble-text">{m.content}</span>
                    <span className="chat-bubble-time">
                      {new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
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
