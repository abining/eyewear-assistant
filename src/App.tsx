import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Glasses, ImageUp, Loader2, Plus, ScanFace, Trash2, X } from 'lucide-react'
import { FramesPanel } from '@/components/FramesPanel'
import { ReferenceView } from '@/components/ReferenceView'
import { TryOnView, type Stats } from '@/components/TryOnView'
import { frameFromFile, loadFrames, type Frame } from '@/lib/models'
import { defaultSettings } from '@/lib/settings'
import { SOURCE_LABELS, canCapture, recommendation, type CollectionChoice, type CaptureHandle, type PaletteChoice, type PreviewState, type Source, type StyleChoice } from '@/lib/selection'

interface Snapshot { id: string; frameName: string; url: string; source: Source; time: string }
const initialView: Source = new URLSearchParams(location.search).get('view') === 'reference' ? 'reference' : 'camera'
export default function App() {
  const [view, setView] = useState<Source>(initialView)
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [photoVersion, setPhotoVersion] = useState(0)
  const [frames, setFrames] = useState<Frame[]>([])
  const [framesError, setFramesError] = useState('')
  const [selected, setSelected] = useState('')
  const [style, setStyle] = useState<StyleChoice>('all')
  const [palette, setPalette] = useState<PaletteChoice>('all')
  const [collection, setCollection] = useState<CollectionChoice>('all')
  const [state, setState] = useState<PreviewState | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [capturing, setCapturing] = useState(false)
  const [notice, setNotice] = useState('')
  const preview = useRef<CaptureHandle>(null), photoInput = useRef<HTMLInputElement>(null)
  const studioCard = useRef<HTMLDivElement>(null)
  const snapshotStore = useRef<Snapshot[]>([]), uploadedUrls = useRef(new Set<string>())
  const pending = useRef(false), alive = useRef(true)
  const frame = frames.find((f) => f.id === selected)
  const ready = canCapture(state, frame?.url, view, snapshots.length) && !capturing
  const modelState = state?.frameUrl === frame?.url && state?.source === view ? state.model : 'loading'
  const modelText = !frame ? '等待选择镜框' : modelState === 'ready' ? '镜框已就绪' : modelState === 'error' ? '镜框加载失败' : '正在加载镜框…'

  useEffect(() => {
    alive.current = true
    let live = true
    loadFrames().then((list) => {
      if (!live) return
      setFrames(list)
      const wanted = new URLSearchParams(location.search).get('model')
      setSelected((list.find((f) => f.id === wanted) ?? list[0])?.id ?? '')
      if (!list.length) setFramesError('镜框清单为空，可以上传本地 GLB 模型。')
    }).catch(() => { if (live) setFramesError('无法加载镜框清单，请刷新重试，或上传本地 GLB 模型。') })
    return () => {
      live = false; alive.current = false
      snapshotStore.current.forEach((s) => URL.revokeObjectURL(s.url))
      uploadedUrls.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])
  const chooseView = (next: Source) => { if (next === view) return; setState(null); setNotice(''); setView(next) }
  const pickPhoto = () => photoInput.current?.click()
  const chooseFrame = (id: string) => {
    setSelected(id); setNotice('')
    if (window.matchMedia('(max-width: 820px)').matches) {
      studioCard.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    }
  }
  const capture = async () => {
    if (!frame || !preview.current || pending.current || !canCapture(state, frame.url, view, snapshotStore.current.length)) return
    pending.current = true; setCapturing(true); setNotice('')
    const metadata = { frameName: frame.label, source: view, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
    try {
      const blob = await preview.current.capture(frame.url)
      if (!alive.current) return
      if (snapshotStore.current.length >= 3) throw new Error('最多保留 3 张，请先删除一张。')
      const snapshot = { ...metadata, id: crypto.randomUUID(), url: URL.createObjectURL(blob) }
      snapshotStore.current = [...snapshotStore.current, snapshot]
      setSnapshots(snapshotStore.current)
      setNotice(`已加入「${metadata.frameName}」的${SOURCE_LABELS[metadata.source]}快照`)
    } catch (error) { if (alive.current) setNotice(error instanceof Error ? error.message : '保存失败，请重试。') }
    finally { pending.current = false; if (alive.current) setCapturing(false) }
  }
  const removeSnapshot = (id?: string) => {
    const removed = snapshotStore.current.filter((s) => !id || s.id === id)
    removed.forEach((s) => URL.revokeObjectURL(s.url))
    snapshotStore.current = snapshotStore.current.filter((s) => id && s.id !== id)
    setSnapshots(snapshotStore.current)
  }
  return <div className="app-shell">
    <header className="app-header">
      <a className="brand" href="./" aria-label="镜选首页"><span className="brand-icon"><Glasses size={25} strokeWidth={1.7} /></span><span>镜选<span className="brand-english">FRAME / FINDER</span></span></a>
      <span className="header-tag">眼镜，换个视角。</span>
    </header>
    <main className="workspace">
      <div className="studio-heading"><div><span className="eyebrow">A NEW POINT OF VIEW / 眼镜试戴实验室</span><h1>一副眼镜。<span>另一种自己。</span></h1><p>从镜框的线条，到你的风格。试戴、转动，放在一起比较。</p></div><div className="edition-label"><span>FRAME STUDIES</span><strong>{String(frames.length).padStart(2, '0')}</strong><span>款镜框 · 自由探索</span></div></div>
      <section className="studio-column">
        <div className="studio-card" ref={studioCard}>
          <div className="stage-toolbar"><div className="source-tabs" role="group" aria-label="试戴画面来源">
            {([{ value: 'camera', label: '摄像头', Icon: Camera }, { value: 'photo', label: '照片', Icon: ImageUp }, { value: 'reference', label: '参考人头', Icon: ScanFace }] as const).map(({ value, label, Icon }) => <button key={value} aria-pressed={view === value} className={view === value ? 'active' : ''} onClick={() => chooseView(value)}><Icon size={16} />{label}</button>)}
          </div><span className="source-label">{view === 'camera' ? '镜像画面' : view === 'photo' ? '本地照片' : '非真人实测'}</span></div>
          <div className={`preview-stage ${view}`}>
            {view === 'reference' ? <ReferenceView ref={preview} settings={defaultSettings} frameUrl={frame?.url ?? null} onState={setState} /> : <TryOnView key={`${view}-${photoVersion}`} ref={preview} settings={defaultSettings} frameUrl={frame?.url ?? null} source={view} photo={photo} onPickPhoto={pickPhoto} onStats={setStats} onState={setState} />}
          </div>
          <div className="preview-status" aria-live="polite"><span className={`status-dot ${state?.ready ? 'ready' : ''}`} /><span>{state?.source === view ? state.tracking : '准备画面中'}</span>{view === 'camera' && state?.ready && stats && <span className="fps-label">{stats.fps > 0 ? `${stats.fps.toFixed(0)} fps` : '采样中'}</span>}{view === 'photo' && <button className="text-button" onClick={pickPhoto}>{photo ? '更换照片' : '选择照片'}</button>}</div>
          <div className="current-frame"><div><span className="eyebrow">正在试戴</span><h2>{frame?.label ?? '选择一副镜框'}</h2><span className={`model-status ${modelState === 'error' ? 'failed' : ''}`}>{modelState === 'loading' && frame ? <Loader2 size={13} className="animate-spin" /> : modelState === 'ready' ? <Check size={13} /> : null}{modelText}</span></div><button className="primary-button capture-button" disabled={!ready} onClick={() => void capture()}>{capturing ? <Loader2 size={17} className="animate-spin" /> : <Plus size={17} />}加入对比<span>{snapshots.length}/3</span></button></div>
          {state?.detail && <p className="stage-error" role="alert">{state.detail}</p>}
          <p className="capture-guidance">{snapshots.length === 3 ? '对比区已满，删除一张即可继续添加。' : view === 'reference' ? '参考人头也可保存对比，快照会始终标记为参考。' : '检测到人脸且当前镜框加载完成后，即可保存试戴画面。'}</p>
        </div>
        {frame && <div className="recommendation"><span className="recommendation-icon"><Glasses size={19} /></span><div><h3>这副镜框的性格</h3><p>{recommendation(frame, style, palette)}</p>{frame.description && <p className="frame-description">{frame.description}</p>}</div></div>}
      </section>
      <aside className="selection-column"><FramesPanel frames={frames} error={framesError} selected={selected} onSelect={chooseFrame} style={style} palette={palette} collection={collection} onCollection={setCollection} onStyle={setStyle} onPalette={setPalette} onUpload={(files) => {
        const added = files.map(frameFromFile); added.forEach((f) => uploadedUrls.current.add(f.url)); setFrames((list) => [...list, ...added]); setSelected(added[added.length - 1].id); setStyle('all'); setPalette('all')
      }} onRemove={(id) => {
        const removed = frames.find((f) => f.id === id); if (!removed?.uploaded) return
        const rest = frames.filter((f) => f.id !== id); setFrames(rest)
        if (selected === id) setSelected(rest[0]?.id ?? '')
        URL.revokeObjectURL(removed.url); uploadedUrls.current.delete(removed.url)
      }} /></aside>
      <section className="comparison-section" aria-label="试戴快照对比"><div className="comparison-heading"><div><span className="eyebrow">SIDE BY SIDE</span><h2>并排看，慢慢选。 <span>{snapshots.length} / 3</span></h2></div><button className="text-button" disabled={!snapshots.length} onClick={() => removeSnapshot()}><Trash2 size={15} />清空对比</button></div>
        <p className="comparison-note">摄像头快照摄于不同时间，姿态可能不同；照片模式可用同一底图比较。快照仅保留在当前页面，刷新后清除。</p>
        <div className="comparison-grid">{Array.from({ length: 3 }, (_, index) => { const snapshot = snapshots[index]; return snapshot ? <article className="snapshot-card" key={snapshot.id}><div className="snapshot-image"><img src={snapshot.url} alt={`${snapshot.frameName}的${SOURCE_LABELS[snapshot.source]}试戴快照`} /><span className={`snapshot-source ${snapshot.source === 'reference' ? 'reference' : ''}`}>{snapshot.source === 'reference' ? '参考人头 · 非真人' : SOURCE_LABELS[snapshot.source]}</span><button aria-label={`删除${snapshot.frameName}对比快照`} onClick={() => removeSnapshot(snapshot.id)}><X size={16} /></button></div><div className="snapshot-caption"><h3>{snapshot.frameName}</h3><span>{snapshot.time}</span></div></article> : <div className="comparison-placeholder" key={`empty-${index}`}><span>0{index + 1}</span><Glasses size={30} strokeWidth={1} /><p>{index === 0 ? '你的第一副镜框' : '另一种可能'}</p></div> })}</div>
        <div className="capture-notice" role="status" aria-live="polite">{notice}</div>
      </section>
    </main>
    <footer className="app-footer"><span>镜选 / FRAME FINDER</span><p>视觉试戴预览 · 不用于验光、瞳距或尺寸测量</p><a href="/license.txt">仅限非商业使用</a></footer>
    <input ref={photoInput} type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; setPhoto(file); setPhotoVersion((n) => n + 1); chooseView('photo') }} />
  </div>
}
