// Sprites « pixel art » du Dribble, découpés dans la vidéo de référence
// (fond vert retiré, réduits à leur grille de pixels, palette commune).
// runner.png : 7 images de 40×48 — course (0-2), vers la droite (3-4), vers la gauche (5-6)
// defender.png : 4 images de 35×40 — course
import runner from './assets/dribble/runner.png'
import defender from './assets/dribble/defender.png'
import ball from './assets/dribble/ball.png'

export function dribbleSpriteVars(): Record<string, string> {
  return {
    '--px-runner': `url(${runner})`,
    '--px-def': `url(${defender})`,
    '--px-ball': `url(${ball})`,
  }
}

// images chargées pour le dessin sur canvas
let imgCache: { runner: HTMLImageElement; def: HTMLImageElement; ball: HTMLImageElement } | null = null
export function dribbleImages() {
  if (imgCache) return imgCache
  const load = (src: string) => { const im = new Image(); im.src = src; return im }
  imgCache = { runner: load(runner), def: load(defender), ball: load(ball) }
  return imgCache
}
