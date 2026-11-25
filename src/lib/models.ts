/** One pair of glasses in the picker. */
export interface Frame {
  id: string
  label: string
  url: string
  shape?: 'round' | 'rectangle' | 'cat-eye' | 'aviator' | 'oval' | 'square' | 'shield' | 'wraparound' | 'rimless' | 'browline'
  styles?: ('minimal' | 'classic' | 'bold' | 'creative')[]
  palette?: 'black' | 'gold' | 'clear' | 'brown' | 'silver' | 'blue' | 'red' | 'white'
  collection?: 'tim-video' | 'original'
  reference?: { url: string; time: number; label?: string }
  preview?: string
  description?: string
  color?: string
  material?: string
  lens_width?: number
  bridge_width?: number
  temple_length?: number
  /** Uploaded by the user in this session (an object URL). */
  uploaded?: boolean
}

interface ListedFrame extends Omit<Frame, 'url'> {
  file: string
}

export const BASE = import.meta.env?.BASE_URL ?? '/'

/**
 * Where models.json and assets live: an optional VITE_MODELS_URL override,
 * otherwise public/models/ served by the same-origin Cloudflare Pages CDN.
 */
const MODELS_URL: string = (import.meta.env?.VITE_MODELS_URL || `${BASE}models/`).replace(/\/?$/, '/')

/** The frames listed in models.json. */
export async function loadFrames(): Promise<Frame[]> {
  // Revalidate the catalog on each visit so additions and removals are visible,
  // independently of the longer cache lifetime of versioned model assets.
  const r = await fetch(`${MODELS_URL}models.json`, { cache: 'no-cache' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return parseFrameCatalog(await r.json(), MODELS_URL)
}

/** Resolve both assets against the same catalog root, including a configured CDN. */
export function parseFrameCatalog(data: unknown, modelsUrl: string): Frame[] {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { models?: unknown }).models)) throw new Error('镜框清单格式无效')
  const root = modelsUrl.replace(/\/?$/, '/')
  return ((data as { models: ListedFrame[] }).models).map((entry) => {
    if (!entry || typeof entry.id !== 'string' || typeof entry.label !== 'string' || typeof entry.file !== 'string' || !entry.file) throw new Error('镜框条目缺少必要信息')
    const { file, preview, reference, ...frame } = entry
    const safeReference = reference && /^https?:\/\//i.test(reference.url) && Number.isFinite(reference.time) && reference.time >= 0 ? reference : undefined
    return { ...frame, url: `${root}${file}`, preview: typeof preview === 'string' && preview ? `${root}${preview}` : undefined, reference: safeReference }
  })
}

export function frameFromFile(file: File): Frame {
  const name = file.name.replace(/\.glb$/i, '')
  return { id: `upload-${crypto.randomUUID()}`, label: name, url: URL.createObjectURL(file), uploaded: true }
}
