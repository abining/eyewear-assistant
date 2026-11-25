import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { GlassesRenderer, glassesMatrix } from '@/core'
import type { Settings } from '@/lib/settings'
import type { CaptureHandle, PreviewState } from '@/lib/selection'

interface Props { settings: Settings; frameUrl: string | null; onState: (state: PreviewState) => void }
export const ReferenceView = forwardRef<CaptureHandle, Props>(function ReferenceView({ settings, frameUrl, onState }, ref) {
  const box = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  const [renderer, setRenderer] = useState<GlassesRenderer | null>(null)
  const [yaw, setYaw] = useState(12), [pitch, setPitch] = useState(0)
  const [model, setModel] = useState<{ url: string | null; state: PreviewState['model']; detail: string }>({ url: null, state: 'empty', detail: '' })
  const stateCallback = useRef(onState)
  stateCallback.current = onState
  const ready = !!frameUrl && frameUrl === model.url && model.state === 'ready'
  const applyPose = (r: GlassesRenderer) => {
    r.setDebug('solid')
    r.setOccluderEnabled(settings.occlusion)
    r.setFaceShadow(settings.faceShadow)
    const q = new Quaternion().setFromEuler(new Euler(pitch * Math.PI / 180, yaw * Math.PI / 180, 0, 'YXZ'))
    const face = new Matrix4().compose(new Vector3(0, -1.5, -34), q, new Vector3(1, 1, 1))
    r.setPose({ faceMatrix: face, matrix: glassesMatrix(face, 1), faceScale: 1, landmarks: [] })
    r.render()
  }
  useEffect(() => {
    const r = new GlassesRenderer(canvas.current!)
    const resize = () => { const { clientWidth: w, clientHeight: h } = box.current!; if (w && h) r.setSize(w, h, w / h); r.render() }
    const observer = new ResizeObserver(resize)
    observer.observe(box.current!)
    resize(); setRenderer(r)
    return () => { observer.disconnect(); r.dispose() }
  }, [])
  useEffect(() => {
    if (!renderer) return
    let live = true
    renderer.clearGlasses()
    setModel({ url: frameUrl, state: frameUrl ? 'loading' : 'empty', detail: '' })
    if (frameUrl) renderer.setGlasses(frameUrl).then(() => {
      if (!live) return
      if (!renderer.glassesInfo?.meshes) throw new Error('没有可显示的网格')
      setModel({ url: frameUrl, state: 'ready', detail: '' })
    }).catch(() => { if (live) setModel({ url: frameUrl, state: 'error', detail: '镜框加载失败，请选择其他镜框。' }) })
    return () => { live = false }
  }, [renderer, frameUrl])
  useEffect(() => { if (renderer) applyPose(renderer) }, [renderer, yaw, pitch, settings.occlusion, settings.faceShadow, model])
  useEffect(() => { stateCallback.current({ frameUrl, source: 'reference', ready, model: frameUrl === model.url ? model.state : 'loading', tracking: '参考人头 · 非真人实测', detail: model.detail }) }, [frameUrl, ready, model])
  useImperativeHandle(ref, () => ({ capture: async (expectedUrl) => {
    if (!renderer || !ready || expectedUrl !== frameUrl || !canvas.current?.width || !box.current?.clientHeight) throw new Error('参考画面尚未就绪')
    if (renderer.renderer.getContext().isContextLost()) throw new Error('3D 画面暂时不可用，请刷新重试')
    applyPose(renderer)
    const result = document.createElement('canvas')
    result.width = canvas.current.width; result.height = canvas.current.height
    const ctx = result.getContext('2d')
    if (!ctx) throw new Error('画面合成失败')
    const gradient = ctx.createLinearGradient(0, 0, 0, result.height)
    gradient.addColorStop(0, '#ececee'); gradient.addColorStop(1, '#d0d1d4')
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, result.width, result.height)
    ctx.drawImage(canvas.current, 0, 0)
    return new Promise((resolve, reject) => result.toBlob((blob) => blob?.size ? resolve(blob) : reject(new Error('画面保存失败')), 'image/png'))
  } }), [renderer, ready, frameUrl, yaw, pitch, settings])
  return <div className="reference-view">
    <div ref={box} className="reference-canvas"><canvas ref={canvas} /></div>
    <div className="reference-notice">参考人头 <span>仅用于查看镜框形态，不代表你的试戴效果</span></div>
    <div className="reference-controls">
      <label>左右转动 <output>{yaw}°</output><input aria-label="参考人头左右转动" type="range" min="-65" max="65" value={yaw} onChange={(e) => setYaw(Number(e.target.value))} /></label>
      <label>上下转动 <output>{pitch}°</output><input aria-label="参考人头上下转动" type="range" min="-25" max="25" value={pitch} onChange={(e) => setPitch(Number(e.target.value))} /></label>
      <button className="text-button" onClick={() => { setYaw(0); setPitch(0) }}>回到正面</button>
    </div>
  </div>
})
