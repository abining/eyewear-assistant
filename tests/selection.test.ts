import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { canCapture, formatLoadingProgress, matchesCollection, matchesPreference, recommendation, sourceTime, type PreviewState } from '../src/lib/selection.ts'
import { parseFrameCatalog, type Frame } from '../src/lib/models.ts'

const frame: Frame = { id: 'gold', label: '金色圆框', url: '/round.glb', shape: 'round', styles: ['minimal', 'classic'], palette: 'gold' }
const ready: PreviewState = { frameUrl: frame.url, source: 'camera', ready: true, model: 'ready', tracking: '人脸追踪中', detail: '' }
test('风格与颜色需同时匹配，全部筛选保留无标签上传', () => {
  assert.equal(matchesPreference(frame, 'minimal', 'gold'), true)
  assert.equal(matchesPreference(frame, 'bold', 'gold'), false)
  assert.equal(matchesPreference(frame, 'classic', 'black'), false)
  assert.equal(matchesPreference({ id: 'upload', label: '上传', url: 'blob:test' }, 'all', 'all'), true)
  assert.equal(matchesPreference({ id: 'upload', label: '上传', url: 'blob:test' }, 'minimal', 'all'), false)
})
test('推荐引用明确属性与实际匹配偏好，不凭上传名称猜风格', () => {
  assert.match(recommendation(frame, 'classic', 'gold'), /圆框 · 金色配色/)
  assert.match(recommendation(frame, 'classic', 'gold'), /符合你选择的「经典」风格和「金色」颜色/)
  assert.doesNotMatch(recommendation(frame, 'bold', 'black'), /符合你选择/)
  assert.equal(recommendation({ id: 'upload', label: '经典金色圆框', url: 'blob:test', uploaded: true }, 'classic', 'gold'), '此模型尚无形状、颜色或风格标签，暂不提供偏好推荐。')
})
test('切框与切来源时，旧预览状态不能允许新快照', () => {
  assert.equal(canCapture(ready, frame.url, 'camera', 0), true)
  assert.equal(canCapture(ready, '/next.glb', 'camera', 0), false)
  assert.equal(canCapture(ready, frame.url, 'photo', 0), false)
  assert.equal(canCapture(null, frame.url, 'camera', 0), false)
})
test('加载中、失败、无人脸或达到三张上限都不能拍照', () => {
  for (const model of ['loading', 'error', 'empty'] as const) assert.equal(canCapture({ ...ready, model }, frame.url, 'camera', 0), false)
  assert.equal(canCapture({ ...ready, ready: false }, frame.url, 'camera', 0), false)
  assert.equal(canCapture(ready, frame.url, 'camera', 2), true)
  assert.equal(canCapture(ready, frame.url, 'camera', 3), false)
  assert.equal(canCapture(ready, undefined, 'camera', 0), false)
})
test('参考画面只在其自己的来源状态就绪时允许快照', () => {
  assert.equal(canCapture({ ...ready, source: 'reference' }, frame.url, 'reference', 0), true)
  assert.equal(canCapture(ready, frame.url, 'reference', 0), false)
})

test('视频与原创系列隔离，未标系列的原有款保留，上传仅在全部中出现', () => {
  const video: Frame = { ...frame, id: 'video', collection: 'tim-video', palette: 'blue', shape: 'shield' }
  const upload: Frame = { id: 'upload', label: '无标签', url: 'blob:test', uploaded: true }
  assert.equal(matchesCollection(video, 'tim-video'), true)
  assert.equal(matchesCollection(video, 'original'), false)
  assert.equal(matchesCollection(frame, 'original'), true)
  assert.equal(matchesCollection(upload, 'original'), false)
  assert.equal(matchesCollection(upload, 'all'), true)
  assert.equal(matchesPreference(video, 'classic', 'blue'), true)
  assert.match(recommendation(video, 'all', 'blue'), /护目镜 · 蓝色配色/)
})

test('清单的模型与缩略图使用同一根路径，来源和旧款属性保持可用', () => {
  const catalog = { models: [
    { id: 'legacy', label: '旧款', file: 'old.glb' },
    { id: 'video', label: '视频款', file: 'video.glb', preview: 'previews/video.webp', collection: 'tim-video', reference: { url: 'https://example.com/video', time: 3.25 }, shape: 'shield', palette: 'blue' },
  ] }
  for (const root of ['/models/', 'https://cdn.example.com/eyewear']) {
    const frames = parseFrameCatalog(catalog, root)
    const normalized = root.replace(/\/?$/, '/')
    assert.equal(frames[0].url, `${normalized}old.glb`)
    assert.equal(frames[0].preview, undefined)
    assert.equal(frames[0].collection, undefined)
    assert.equal(frames[1].preview, `${normalized}previews/video.webp`)
    assert.equal(frames[1].reference?.time, 3.25)
    assert.equal(frames[1].palette, 'blue')
  }
  assert.throws(() => parseFrameCatalog({ models: [{ id: 'bad', label: '缺少模型' }] }, '/models/'), /必要信息/)
  assert.throws(() => parseFrameCatalog({ unrelated: [] }, '/models/'), /格式无效/)
})

test('无效视频来源不生成链接，时间点跨分钟保持准确', () => {
  const frames = parseFrameCatalog({ models: [
    { id: 'bad-link', label: '示例', file: 'a.glb', reference: { url: 'javascript:alert(1)', time: 2 } },
    { id: 'bad-time', label: '示例', file: 'b.glb', reference: { url: 'https://example.com', time: -1 } },
  ] }, '/models/')
  assert.equal(frames[0].reference, undefined)
  assert.equal(frames[1].reference, undefined)
  assert.equal(sourceTime(3.25), '00:03.25')
  assert.equal(sourceTime(5.65), '00:05.65')
  assert.equal(sourceTime(5.683), '00:05.68')
  assert.equal(sourceTime(59.99), '00:59.99')
  assert.equal(sourceTime(59.999), '01:00.00')
})

test('加载阶段文案区分权限、运行时、模型、初始化与首帧，不虚构百分比', () => {
  assert.equal(formatLoadingProgress({ phase: 'acquiring-camera' }, 'loading', 'camera').label, '正在获取摄像头权限与画面…')
  assert.equal(formatLoadingProgress({ phase: 'decoding-photo' }, 'loading', 'photo').label, '正在读取本地照片…')
  const known = formatLoadingProgress({ phase: 'loading-runtime', loadedBytes: 5 * 1024 * 1024, totalBytes: 10 * 1024 * 1024 }, 'loading', 'camera')
  assert.equal(known.percent, 50)
  assert.match(known.label, /5\.0 MB \/ 10\.0 MB \(50%\)/)
  const unknownTotal = formatLoadingProgress({ phase: 'loading-model', loadedBytes: 2 * 1024 * 1024 }, 'loading', 'photo')
  assert.equal(unknownTotal.percent, undefined)
  assert.match(unknownTotal.label, /已下载 2\.0 MB/)
  const zero = formatLoadingProgress({ phase: 'loading-runtime', loadedBytes: 0 }, 'loading', 'camera')
  assert.equal(zero.percent, undefined)
  assert.equal(zero.label, '正在加载追踪引擎 (WASM)…')
  assert.equal(formatLoadingProgress({ phase: 'initializing-tracker' }, 'loading', 'camera').label, '正在初始化人脸追踪器…')
  assert.equal(formatLoadingProgress({ phase: 'first-frame' }, 'loading', 'camera').label, '正在等待首帧画面与首次人脸检测…')
  assert.equal(formatLoadingProgress({ phase: 'first-frame' }, 'loading', 'photo').label, '正在检测照片中的人脸…')
  assert.equal(formatLoadingProgress({ phase: 'tracking' }, 'tracking', 'camera').label, '人脸追踪中')
})

test('界面移除视频来源外链与指定隐私标语，保留视频系列与非商业许可声明', async () => {
  const [app, panel, view] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/FramesPanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/TryOnView.tsx', import.meta.url), 'utf8'),
  ])
  assert.doesNotMatch(panel, /frame-source|查看.*视频来源|target="_blank"/)
  assert.doesNotMatch(app, /reference-link|查看视频来源|target="_blank"/)
  assert.doesNotMatch(app, /本地处理 · 无需上传人脸/)
  assert.doesNotMatch(view, /照片和视频仅在当前浏览器中处理|等待摄像头授权或准备人脸追踪/)
  assert.match(panel, /视频镜框/)
  assert.match(app, /仅限非商业使用/)
  assert.match(app, /\/license\.txt/)
})
