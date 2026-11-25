import { useRef, useState } from 'react'
import { Check, Glasses, Upload, X } from 'lucide-react'
import type { Frame } from '@/lib/models'
import { PALETTE_LABELS, SHAPE_LABELS, STYLE_LABELS, matchesCollection, matchesPreference, type CollectionChoice, type PaletteChoice, type StyleChoice } from '@/lib/selection'
interface Props {
  frames: Frame[]; error: string; selected: string; onSelect: (id: string) => void
  onUpload: (files: File[]) => void; onRemove: (id: string) => void
  style: StyleChoice; palette: PaletteChoice; collection: CollectionChoice
  onCollection: (collection: CollectionChoice) => void
  onStyle: (style: StyleChoice) => void; onPalette: (palette: PaletteChoice) => void
}
export function FrameIllustration({ frame }: { frame: Frame }) {
  const color = ({ black: '#252525', gold: '#b39459', clear: '#bec2c7', brown: '#7b513c', silver: '#959da8', blue: '#356386', red: '#b8403f', white: '#b6b6b6' } as const)[frame.palette!] || '#737373'
  const round = frame.shape === 'round', cat = frame.shape === 'cat-eye', aviator = frame.shape === 'aviator'
  return <svg viewBox="0 0 200 80" aria-hidden="true" className="frame-illustration">
    <g fill={frame.palette === 'clear' ? '#e7e9ecaa' : '#dce0e588'} stroke={color} strokeWidth={frame.styles?.includes('bold') ? 7 : 4} strokeLinejoin="round">
      {round ? <><circle cx="58" cy="41" r="27" /><circle cx="142" cy="41" r="27" /></> : cat ? <><path d="M20 16 85 29 82 53Q60 78 31 53Z" /><path d="m180 16-65 13 3 24q22 25 51 0Z" /></> : aviator ? <><path d="M28 21Q55 14 84 25L79 57Q64 79 37 55Z" /><path d="M172 21Q145 14 116 25L121 57Q136 79 163 55Z" /></> : <><rect x="25" y="23" width="61" height="40" rx="11" /><rect x="114" y="23" width="61" height="40" rx="11" /></>}
      <path d="M85 35Q100 26 115 35M26 31 11 25M174 31 189 25" fill="none" />
      {aviator && <path d="M84 23H116" />}
    </g>
  </svg>
}
function FramePreview({ frame }: { frame: Frame }) {
  const [failedUrl, setFailedUrl] = useState('')
  return frame.preview && failedUrl !== frame.preview ? <img className="frame-preview" src={frame.preview} alt="" loading="lazy" decoding="async" onError={() => setFailedUrl(frame.preview!)} /> : <FrameIllustration frame={frame} />
}
export function FramesPanel({ frames, error, selected, onSelect, onUpload, onRemove, style, palette, collection, onCollection, onStyle, onPalette }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const visible = frames.filter((frame) => matchesCollection(frame, collection) && matchesPreference(frame, style, palette))
  const videoCount = frames.filter((frame) => frame.collection === 'tim-video').length
  return <section className="frames-panel" aria-label="镜框选择">
    <div className="section-heading"><div><span className="eyebrow">THE FRAME COLLECTION</span><h2>镜框档案<span className="count-badge" aria-live="polite">{visible.length}</span></h2></div><Glasses size={25} strokeWidth={1.1} /></div>
    <div className="collection-tabs" role="group" aria-label="镜框系列">{([['all', '全部'], ['tim-video', '视频镜框'], ['original', '原创']] as const).map(([value, label]) => <button key={value} className={collection === value ? 'active' : ''} aria-pressed={collection === value} onClick={() => onCollection(value)}>{label}{value === 'tim-video' && <span>{videoCount}</span>}</button>)}</div>
    <div className="catalog-filters"><fieldset className="preference-group"><legend>风格偏好</legend><div className="filter-chips">{([['all', '不限'], ...Object.entries(STYLE_LABELS)] as [StyleChoice, string][]).map(([value, label]) => <button key={value} className={style === value ? 'chip active' : 'chip'} aria-pressed={style === value} onClick={() => onStyle(value)}>{label}</button>)}</div></fieldset>
    <label className="color-filter">颜色<select value={palette} onChange={(e) => onPalette(e.target.value as PaletteChoice)}><option value="all">全部颜色</option>{Object.entries(PALETTE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="catalog-result"><span>{collection === 'tim-video' ? 'VIDEO STUDIES' : collection === 'original' ? 'ORIGINAL FORMS' : 'ALL FRAMES'}</span><span aria-live="polite">{visible.length} 款可试戴</span></div>
    <div className="frame-list">
      {visible.map((frame) => <article className={`frame-card ${selected === frame.id ? 'selected' : ''}`} key={frame.id}>
        <button className="frame-select" aria-pressed={selected === frame.id} onClick={() => onSelect(frame.id)} aria-label={`试戴${frame.label}`}>
          <div className="frame-art"><FramePreview frame={frame} />{selected === frame.id && <span className="selection-check"><Check size={13} /></span>}<span className="frame-series">{frame.uploaded ? 'LOCAL' : frame.collection === 'tim-video' ? 'VIDEO' : 'ORIGINAL'}</span></div>
          <div className="frame-card-copy"><span className="frame-title">{frame.label}</span><span className="frame-meta">{frame.uploaded ? '本地上传 · 标签未提供' : `${frame.shape ? SHAPE_LABELS[frame.shape] ?? '未标注框形' : '未标注框形'} · ${frame.palette ? PALETTE_LABELS[frame.palette] ?? '未标注颜色' : '未标注颜色'}`}</span></div>
        </button>
        {frame.uploaded && <button className="remove-upload" aria-label={`删除镜框${frame.label}`} onClick={() => onRemove(frame.id)}><X size={15} /></button>}
      </article>)}
      {!visible.length && <div className="empty-filter"><Glasses size={28} /><p>还没有同时符合这些偏好的镜框</p><button className="text-button" onClick={() => { onStyle('all'); onPalette('all'); onCollection('all') }}>重置筛选，查看全部</button></div>}
    </div>
    <p className="catalog-note">视频外观近似重建，非官方商品模型；不同外观变体不代表不同商品。原创款为几何示例。推荐仅匹配已标注属性，实际外观以试戴舞台为准。</p>
    <details className="local-models"><summary>有自己的镜框模型？<Upload size={14} /></summary><button className="upload-model" onClick={() => input.current?.click()}><Upload size={16} /><span>导入本地 GLB<small>仅在本机使用 · 无标签时不做偏好推荐</small></span></button></details>
    <input ref={input} hidden type="file" accept=".glb,model/gltf-binary" multiple onChange={(e) => { const files = Array.from(e.target.files ?? []).filter((f) => /\.glb$/i.test(f.name)); if (files.length) { onUpload(files); onCollection('all') }; e.target.value = '' }} />
  </section>
}
