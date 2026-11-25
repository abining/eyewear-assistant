import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Camera, ImageUp, Loader2, RotateCw, ScanFace } from 'lucide-react'
import { BRIDGE_ANCHOR_CM, TryOn, type GlassesPose, type TryOnProgress, type TryOnStatus } from '@/core'
import { MEDIAPIPE_ASSETS } from '@/generated/mediapipe-assets'
import { BASE } from '@/lib/models'
import { toTryOn, type Settings } from '@/lib/settings'
import { DEFAULT_FRAME_FIT, FRAME_FIT_LIMITS, normalizeFrameFit, type FrameFit } from '@/core/frameFit'
import { formatLoadingProgress, TRYON_STATUS_LABELS, type CaptureHandle, type PreviewState } from '@/lib/selection'

export interface Stats {
  fps: number; delegate: string; faceScale: number; distanceCm: number; x: number; y: number
  fit: { strength: number; bridgeMm: [number, number, number]; earMm: number; rmsMm: number } | null
}
interface Props {
  settings: Settings
  frameUrl: string | null
  source: 'camera' | 'photo'
  photo: Blob | null
  onPickPhoto: () => void
  onStats: (stats: Stats | null) => void
  onState: (state: PreviewState) => void
}
const FRAME_FIT_STORAGE = 'eyewear:frame-fit:v1'
function savedFrameFit(): FrameFit {
  try { return normalizeFrameFit(JSON.parse(localStorage.getItem(FRAME_FIT_STORAGE) ?? 'null')) }
  catch { return { ...DEFAULT_FRAME_FIT } }
}
export const TryOnView = forwardRef<CaptureHandle, Props>(function TryOnView({ settings, frameUrl, source, photo, onPickPhoto, onStats, onState }, ref) {
  const holder = useRef<HTMLDivElement>(null)
  const [widget, setWidget] = useState<TryOn | null>(null)
  const [status, setStatus] = useState<TryOnStatus>('idle')
  const [progress, setProgress] = useState<TryOnProgress | null>(null)
  const [detail, setDetail] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [frameFit, setFrameFit] = useState(savedFrameFit)
  const [fitOpen, setFitOpen] = useState(true)
  const [model, setModel] = useState<{ url: string | null; state: PreviewState['model']; error: string }>({ url: null, state: 'empty', error: '' })
  const callbacks = useRef({ onStats, onState })
  callbacks.current = { onStats, onState }
  const applied = useRef(settings)
  const modelReady = !!frameUrl && model.url === frameUrl && model.state === 'ready'
  const ready = modelReady && status === 'tracking'
  const loading = formatLoadingProgress(progress, status, source)
  const statusLabel = loading.label
  useImperativeHandle(ref, () => ({ capture: async (expectedUrl) => {
    if (!widget || !ready || expectedUrl !== frameUrl) throw new Error('当前画面尚未就绪')
    return widget.capture(expectedUrl)
  } }), [widget, ready, frameUrl])

  useEffect(() => {
    let count = 0, since = performance.now(), fps = 0, lastReport = 0
    let live = true
    const instance = new TryOn(holder.current!, {
      wasmPath: `${BASE}${MEDIAPIPE_ASSETS.wasmDir}`,
      wasmLoaderPath: `${BASE}${MEDIAPIPE_ASSETS.wasmLoader}`,
      wasmBinaryPath: `${BASE}${MEDIAPIPE_ASSETS.wasmBinary}`,
      wasmBytes: MEDIAPIPE_ASSETS.files['vision_wasm_internal.wasm'].bytes,
      modelPath: `${BASE}${MEDIAPIPE_ASSETS.modelPath}`,
      modelBytes: MEDIAPIPE_ASSETS.files['face_landmarker.task'].bytes,
      ...toTryOn(applied.current),
      onStatus: (s, d) => { if (live) { setStatus(s); setDetail(d ?? '') } },
      onProgress: (p) => { if (live) setProgress(p) },
      onPose: (pose) => {
        if (!live) return
        const now = performance.now()
        count++
        if (now - since >= 1000) { fps = count * 1000 / (now - since); count = 0; since = now }
        if (instance.source === 'photo' || now - lastReport >= 250) {
          lastReport = now
          callbacks.current.onStats(pose ? statsOf(pose, instance.source === 'photo' ? 0 : fps, '本地') : null)
        }
      },
    })
    setWidget(instance)
    return () => { live = false; instance.dispose(); callbacks.current.onStats(null) }
  }, [])
  useEffect(() => {
    widget?.setFrameFit(frameFit.scale, frameFit.verticalMm)
    try { localStorage.setItem(FRAME_FIT_STORAGE, JSON.stringify(frameFit)) } catch { /* Still usable when storage is unavailable. */ }
  }, [widget, frameFit])
  useEffect(() => {
    if (!widget) return
    const before = toTryOn(applied.current), next = toTryOn(settings)
    const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => before[k as keyof typeof before] !== v))
    applied.current = settings
    if (Object.keys(changed).length) void widget.update(changed).catch(() => { setStatus('error'); setDetail('设置应用失败，请重新开启画面。') })
  }, [widget, settings])
  useEffect(() => {
    if (!widget) return
    let live = true
    setModel({ url: frameUrl, state: frameUrl ? 'loading' : 'empty', error: '' })
    widget.setGlasses(frameUrl).then(() => { if (live) setModel({ url: frameUrl, state: frameUrl ? 'ready' : 'empty', error: '' }) }).catch(() => {
      if (live) setModel({ url: frameUrl, state: 'error', error: '镜框加载失败，请选择其他镜框，或确认上传的是有效 GLB。' })
    })
    return () => { live = false }
  }, [widget, frameUrl])
  useEffect(() => {
    if (!widget) return
    if (source === 'camera' && enabled) void widget.startCamera()
    else if (source === 'photo' && photo) void widget.showPhoto(photo)
    else widget.stop()
  }, [widget, source, photo, enabled, attempt])
  useEffect(() => {
    callbacks.current.onState({ frameUrl, source, ready, model: model.url === frameUrl ? model.state : 'loading', tracking: source === 'photo' && !photo ? '等待选择本地照片' : statusLabel, detail: model.error || detail })
  }, [frameUrl, source, photo, ready, model, status, statusLabel, detail])

  const failed = ['camera-denied', 'camera-unavailable', 'error'].includes(status)
  const empty = source === 'photo' && !photo
  return <div className="tryon-view">
    <div ref={holder} className="stage-holder" />
    {(empty || (source === 'camera' && !enabled) || failed) && <div className="stage-message">
      <div className="stage-message-icon">{source === 'photo' ? <ImageUp /> : <Camera />}</div>
      <h2>{empty ? '用一张照片，慢慢挑选' : failed ? TRYON_STATUS_LABELS[status] : '看看哪一副更像你'}</h2>
      <p>{empty ? '选择一张正脸照片，在同一底图上比较不同镜框。' : failed ? (detail || '请确认摄像头可用，或使用照片模式。') : '开启摄像头实时试戴，也可以先查看原创镜框的参考效果。'}</p>
      {source === 'camera' && <button className="primary-button" onClick={() => { setEnabled(true); setAttempt((n) => n + 1) }}><Camera size={17} />{failed ? '重试摄像头' : '开启摄像头'}</button>}
      {source === 'photo' && photo && failed && <button className="primary-button" onClick={() => setAttempt((n) => n + 1)}><RotateCw size={17} />重试加载</button>}
      <button className="secondary-button" onClick={onPickPhoto}><ImageUp size={17} />选择本地照片</button>
    </div>}
    {!empty && !failed && (status === 'loading' || status === 'no-face') && <div className="tracking-hint" role="status">
      <div className="tracking-hint-row">{status === 'loading' ? <Loader2 size={16} className="animate-spin" /> : <ScanFace size={16} />}<span>{status === 'no-face' && source === 'photo' ? '这张照片未检测到人脸，请换一张清晰正脸照片' : statusLabel}</span></div>
      {status === 'loading' && typeof loading.percent === 'number' && <div className="loading-bar" aria-hidden="true"><span style={{ width: `${loading.percent}%` }} /></div>}
    </div>}
    {modelReady && !empty && !failed && (source === 'photo' || enabled) && <div className="fit-controls">
      <button className="fit-toggle" aria-expanded={fitOpen} aria-controls="frame-fit-panel" onClick={() => setFitOpen((open) => !open)}>佩戴校准 <span>{Math.round(frameFit.scale * 100)}% · {fitOpen ? '收起' : '展开'}</span></button>
      {fitOpen && <div id="frame-fit-panel" className="fit-panel">
        <div><label htmlFor="frame-fit-scale">镜框大小 <output>{Math.round(frameFit.scale * 100)}%</output></label>
        <input id="frame-fit-scale" type="range" min={FRAME_FIT_LIMITS.minScale * 100} max={FRAME_FIT_LIMITS.maxScale * 100} step="1" value={Math.round(frameFit.scale * 100)} onChange={(e) => setFrameFit((fit) => ({ ...fit, scale: Number(e.target.value) / 100 }))} /></div>
        <div><label htmlFor="frame-fit-vertical">上下位置 <output>{frameFit.verticalMm === 0 ? '居中' : `${frameFit.verticalMm > 0 ? '上移' : '下移'} ${Math.abs(frameFit.verticalMm)} mm`}</output></label>
        <input id="frame-fit-vertical" type="range" min={-FRAME_FIT_LIMITS.maxVerticalMm} max={FRAME_FIT_LIMITS.maxVerticalMm} step="0.5" value={frameFit.verticalMm} onChange={(e) => setFrameFit((fit) => ({ ...fit, verticalMm: Number(e.target.value) }))} /></div>
        <div className="fit-actions"><button className="text-button" onClick={() => setFrameFit((fit) => ({ ...fit, scale: 0.9 }))}>偏大？试试 90%</button><button className="text-button" onClick={() => setFrameFit({ ...DEFAULT_FRAME_FIT })}>恢复默认</button></div>
        <small>视觉微调，非实物尺寸 · 本机自动记忆</small>
      </div>}
    </div>}
    {source === 'camera' && enabled && <button className="camera-stop" onClick={() => { widget?.stop(); setEnabled(false) }}>停止摄像头</button>}
  </div>
})
function statsOf(pose: GlassesPose, fps: number, delegate: string): Stats {
  const e = pose.faceMatrix.elements, f = pose.fit
  return { fps, delegate, faceScale: pose.faceScale, distanceCm: -e[14], x: e[12], y: e[13], fit: f?.positions ? {
    strength: f.strength, bridgeMm: [(f.bridge.x - BRIDGE_ANCHOR_CM.x) * 10, (f.bridge.y - BRIDGE_ANCHOR_CM.y) * 10, (f.bridge.z - BRIDGE_ANCHOR_CM.z) * 10], earMm: f.earX * 10, rmsMm: f.residual * 10,
  } : null }
}
