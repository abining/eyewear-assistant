import type { TryOnProgress, TryOnStatus } from '../core/TryOn.ts'
import type { Frame } from './models.ts'

export const STYLE_LABELS = { minimal: '简约', classic: '经典', bold: '醒目', creative: '个性' } as const
export const PALETTE_LABELS = { black: '黑色', gold: '金色', clear: '透明', brown: '棕色', silver: '银色', blue: '蓝色', red: '红色', white: '白色' } as const
export const SHAPE_LABELS = { round: '圆框', rectangle: '方框', 'cat-eye': '猫眼框', aviator: '飞行员框', oval: '椭圆框', square: '方形框', shield: '护目镜', wraparound: '环绕框', rimless: '无框', browline: '眉线框' } as const
export type StyleChoice = 'all' | keyof typeof STYLE_LABELS
export type PaletteChoice = 'all' | keyof typeof PALETTE_LABELS
export type CollectionChoice = 'all' | 'tim-video' | 'original'
export function matchesCollection(frame: Frame, collection: CollectionChoice): boolean {
  return collection === 'all' || (collection === 'tim-video' ? frame.collection === 'tim-video' : !frame.uploaded && (frame.collection === 'original' || !frame.collection))
}
export function sourceTime(time: number): string {
  const hundredths = Math.round(time * 100)
  return `${String(Math.floor(hundredths / 6000)).padStart(2, '0')}:${String(Math.floor(hundredths / 100) % 60).padStart(2, '0')}.${String(hundredths % 100).padStart(2, '0')}`
}
export type Source = 'camera' | 'photo' | 'reference'
export const SOURCE_LABELS = { camera: '摄像头', photo: '照片', reference: '参考人头' } as const

export function matchesPreference(frame: Frame, style: StyleChoice, palette: PaletteChoice): boolean {
  return (style === 'all' || !!frame.styles?.includes(style)) && (palette === 'all' || frame.palette === palette)
}

export function recommendation(frame: Frame, style: StyleChoice, palette: PaletteChoice): string {
  const facts: string[] = []
  if (frame.shape && SHAPE_LABELS[frame.shape]) facts.push(SHAPE_LABELS[frame.shape])
  if (frame.palette && PALETTE_LABELS[frame.palette]) facts.push(`${PALETTE_LABELS[frame.palette]}配色`)
  const knownStyles = frame.styles?.filter((s) => STYLE_LABELS[s]) ?? []
  if (knownStyles.length) facts.push(`${knownStyles.map((s) => STYLE_LABELS[s]).join(' / ')}风格`)
  if (!facts.length) return '此模型尚无形状、颜色或风格标签，暂不提供偏好推荐。'
  const matches: string[] = []
  if (style !== 'all' && frame.styles?.includes(style)) matches.push(`「${STYLE_LABELS[style]}」风格`)
  if (palette !== 'all' && frame.palette === palette) matches.push(`「${PALETTE_LABELS[palette]}」颜色`)
  return `${facts.join(' · ')}。${matches.length ? `符合你选择的${matches.join('和')}。` : '按已标注属性展示，可试戴后比较。'}`
}

export interface PreviewState {
  frameUrl: string | null
  source: Source
  ready: boolean
  model: 'loading' | 'ready' | 'error' | 'empty'
  tracking: string
  detail: string
}
export interface CaptureHandle { capture: (expectedUrl: string) => Promise<Blob> }
export function canCapture(state: PreviewState | null, url: string | undefined, source: Source, count: number): boolean {
  return !!url && !!state && state.frameUrl === url && state.source === source && state.ready && state.model === 'ready' && count < 3
}

export const TRYON_STATUS_LABELS: Record<TryOnStatus, string> = {
  idle: '摄像头已停止',
  loading: '正在加载人脸追踪…',
  tracking: '人脸追踪中',
  'no-face': '尚未检测到人脸',
  'camera-denied': '摄像头权限未开启',
  'camera-unavailable': '摄像头不可用',
  error: '画面加载失败',
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatLoadingProgress(
  progress: TryOnProgress | null,
  status: TryOnStatus,
  source: 'camera' | 'photo',
): { label: string; percent?: number } {
  if (status !== 'loading') return { label: TRYON_STATUS_LABELS[status] }
  if (!progress) {
    return { label: source === 'camera' ? '正在获取摄像头权限与画面…' : '正在读取本地照片…' }
  }
  switch (progress.phase) {
    case 'acquiring-camera':
      return { label: '正在获取摄像头权限与画面…' }
    case 'decoding-photo':
      return { label: '正在读取本地照片…' }
    case 'loading-runtime': {
      const { loadedBytes, totalBytes } = progress
      if (totalBytes && totalBytes > 0 && loadedBytes !== undefined) {
        const clamped = Math.min(loadedBytes, totalBytes)
        const percent = Math.min(100, Math.round((clamped / totalBytes) * 100))
        return { label: `正在加载追踪引擎 (WASM) · ${formatMb(clamped)} / ${formatMb(totalBytes)} (${percent}%)`, percent }
      }
      if (loadedBytes !== undefined && loadedBytes > 0) {
        return { label: `正在加载追踪引擎 (WASM) · 已下载 ${formatMb(loadedBytes)}` }
      }
      return { label: '正在加载追踪引擎 (WASM)…' }
    }
    case 'loading-model': {
      const { loadedBytes, totalBytes } = progress
      if (totalBytes && totalBytes > 0 && loadedBytes !== undefined) {
        const clamped = Math.min(loadedBytes, totalBytes)
        const percent = Math.min(100, Math.round((clamped / totalBytes) * 100))
        return { label: `正在加载人脸识别模型 · ${formatMb(clamped)} / ${formatMb(totalBytes)} (${percent}%)`, percent }
      }
      if (loadedBytes !== undefined && loadedBytes > 0) {
        return { label: `正在加载人脸识别模型 · 已下载 ${formatMb(loadedBytes)}` }
      }
      return { label: '正在加载人脸识别模型…' }
    }
    case 'initializing-tracker':
      return { label: '正在初始化人脸追踪器…' }
    case 'first-frame':
      return { label: source === 'photo' ? '正在检测照片中的人脸…' : '正在等待首帧画面与首次人脸检测…' }
    default:
      return { label: TRYON_STATUS_LABELS[status] }
  }
}
