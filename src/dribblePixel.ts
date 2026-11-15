// Sprites « pixel art » du Dribble, dessinés en code (aucun fichier image) :
// chaque sprite est une grille de caractères, chaque caractère une couleur.
// On fabrique des planches de 2 images (course) en data-URL PNG, affichées
// en CSS avec image-rendering: pixelated.

const PAL: Record<string, string> = {
  K: '#15130f', // contour
  H: '#3b2414', h: '#6a4426', // cheveux
  S: '#e2a877', s: '#b8774c', // peau
  Y: '#f4c430', y: '#c9971a', // maillot jaune (joueur)
  N: '#15130f', // numéro
  G: '#1f7a3e', // liseré vert
  D: '#1d2a22', // short sombre
  W: '#f4f1e8', w: '#c9c4b5', // blanc
  R: '#d8352b', r: '#a3231c', // maillot rouge (défenseur)
  B: '#0e0e0e', // chaussures
  O: '#f08a24', o: '#b9611a', // maillot orange (défenseur rapide)
}

// joueur vu de dos (il monte le terrain), numéro 10 dans le dos
const RUN_TOP = [
  '......KKKK......',
  '.....KHHHHK.....',
  '....KHhhHHHK....',
  '....KHHHHHHK....',
  '....KHHHHHHK....',
  '.....KSSSSK.....',
  '...KKYYYYYYKK...',
  '..KYYYYYYYYYYK..',
]
const RUN_ARMS_A = [
  '.KSKYYNYNNNYKYK.',
  '.KSKYNNYNYNYKYK.',
  '.KSKYYNYNYNYKSK.',
  '.KsKYYNYNYNYKSK.',
  '..KKYYNYNNNYKsK.',
]
const RUN_ARMS_B = [
  '.KYKYYNYNNNYKSK.',
  '.KYKYNNYNYNYKSK.',
  '.KSKYYNYNYNYKSK.',
  '.KSKYYNYNYNYKsK.',
  '.KsKYYNYNNNYKK..',
]
const RUN_HIPS = [
  '...KyyyyyyyyK...',
  '...KGGGGGGGGK...',
  '...KDDDDDDDDK...',
  '...KDDDKKDDDK...',
]
const RUN_LEGS_A = [
  '...KSSK..KSSK...',
  '...KWWK..KWWK...',
  '...KWWK..KBBK...',
  '...KBBK...KK....',
  '....KK..........',
]
const RUN_LEGS_B = [
  '...KSSK..KSSK...',
  '...KWWK..KWWK...',
  '...KBBK..KWWK...',
  '....KK...KBBK...',
  '..........KK....',
]

// défenseur vu de face (il descend vers nous)
const DEF_TOP = [
  '......KKKK......',
  '.....KHHHHK.....',
  '....KHHhHHHK....',
  '....KHSSSSHK....',
  '....KSKSSKSK....',
  '....KSSSSSSK....',
  '.....KSssSK.....',
  '...KKRRWWRRKK...',
  '..KRRRRRRRRRRK..',
]
const DEF_ARMS_A = [
  '.KSKRRRRRRRRKRK.',
  '.KSKRRRRRRRRKRK.',
  '.KSKRRRRRRRRKSK.',
  '.KsKrrrrrrrrKSK.',
]
const DEF_ARMS_B = [
  '.KRKRRRRRRRRKSK.',
  '.KRKRRRRRRRRKSK.',
  '.KSKRRRRRRRRKSK.',
  '.KSKrrrrrrrrKsK.',
]
const DEF_HIPS = [
  '...KWWWWWWWWK...',
  '...KWWWKKWWWK...',
]
const DEF_LEGS_A = [
  '...KSSK..KSSK...',
  '...KRRK..KRRK...',
  '...KRRK..KBBK...',
  '...KBBK...KK....',
  '....KK..........',
]
const DEF_LEGS_B = [
  '...KSSK..KSSK...',
  '...KRRK..KRRK...',
  '...KBBK..KRRK...',
  '....KK...KBBK...',
  '..........KK....',
]

const BALL = [
  '..KKK..',
  '.KWWWK.',
  'KWWKWwK',
  'KWKKKWK',
  'KwWKWWK',
  '.KwWwK.',
  '..KKK..',
]

function sheet(frames: string[][], swap?: Record<string, string>): string {
  const h = frames[0].length, w = frames[0][0].length
  const c = document.createElement('canvas')
  c.width = w * frames.length; c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  frames.forEach((rows, f) => rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return
    const k = swap?.[ch] ?? ch
    ctx.fillStyle = PAL[k] ?? '#f0f'
    ctx.fillRect(f * w + x, y, 1, 1)
  })))
  return `url(${c.toDataURL('image/png')})`
}

let cache: Record<string, string> | null = null
// variables CSS à poser sur la page du jeu
export function dribbleSpriteVars(): Record<string, string> {
  if (cache) return cache
  const run = [[...RUN_TOP, ...RUN_ARMS_A, ...RUN_HIPS, ...RUN_LEGS_A], [...RUN_TOP, ...RUN_ARMS_B, ...RUN_HIPS, ...RUN_LEGS_B]]
  const def = [[...DEF_TOP, ...DEF_ARMS_A, ...DEF_HIPS, ...DEF_LEGS_A], [...DEF_TOP, ...DEF_ARMS_B, ...DEF_HIPS, ...DEF_LEGS_B]]
  cache = {
    '--px-runner': sheet(run),
    '--px-def': sheet(def),
    '--px-def-fast': sheet(def, { R: 'O', r: 'o' }),
    '--px-ball': sheet([BALL]),
  }
  return cache
}
