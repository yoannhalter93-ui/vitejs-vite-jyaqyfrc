self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = data.title || 'Entre Nous'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/favicon-48.png',
    // une notif par évènement : sans tag distinct, Android en remplace
    // certaines au lieu de les empiler
    tag: data.notificationId || undefined,
    data: { url: data.url || '/', notificationId: data.notificationId || null },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

// Tap sur la notif : si l'appli est déjà ouverte, on lui demande d'aller sur
// le bon écran (même logique que la cloche) ; sinon on l'ouvre avec
// ?notif=<id>, lu au démarrage par App.tsx.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const url = data.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if (data.notificationId) client.postMessage({ type: 'open-notification', id: data.notificationId })
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
