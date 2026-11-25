import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm'

// Execute the production class, transforming syntax only (no type checker).
// Only the browser/media/WebGL and MediaPipe boundaries are replaced.
const source = stripTypeScriptTypes(await readFile(new URL('../src/core/TryOn.ts', import.meta.url), 'utf8'), { mode: 'transform' })
const turn = () => new Promise((resolve) => setImmediate(resolve))
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function trackerWith(overrides = {}) {
  return { prepareCalls: 0, disposeCalls: 0, resetCalls: 0, activeDelegate: 'CPU',
    async prepareVideo() { this.prepareCalls++ }, async prepareImage() { this.prepareCalls++ },
    reset() { this.resetCalls++ }, dispose() { this.disposeCalls++ }, trackVideo() { return { landmarks: [] } }, trackImage() { return { landmarks: [] } }, ...overrides }
}
async function harness(createTracker, { getUserMedia } = {}) {
  const statuses = [], progressEvents = [], poses = [], streams = [], elements = [], contexts = []
  let creationCalls = 0, scheduled = null, renderPose = null, renderCalls = 0
  const fitCalls = []
  const makeElement = (tag) => {
    const el = { tag, style: {}, clientWidth: 400, clientHeight: 300, width: 400, height: 300, children: [],
      append(...nodes) { this.children.push(...nodes) }, remove() {},
      readyState: 4, videoWidth: 400, videoHeight: 300, naturalWidth: 400, currentTime: 0,
      play: async () => {}, decode: async () => {}, srcObject: null,
      requestVideoFrameCallback(callback) { scheduled = callback; return 1 }, cancelVideoFrameCallback() { scheduled = null },
      toBlob(callback) { callback(new Blob(['pixels'], { type: 'image/png' })) },
      getContext() {
        const events = []; let mirrored = false
        const ctx = { events, translate(...args) { events.push(['translate', ...args]) }, scale(x, y) { mirrored = x === -1; events.push(['scale', x, y]) }, drawImage(image, ...args) { events.push(['draw', image.tag, mirrored, ...args]) } }
        contexts.push(ctx); return ctx
      },
    }
    elements.push(el); return el
  }
  class FakeRenderer {
    glassesInfo = { meshes: 1 }
    renderer = { getContext: () => ({ isContextLost: () => false }) }
    setDebug() {} setOccluderEnabled() {} setFaceShadow() {} setSize() {} setLighting() {} render() { renderCalls++ } dispose() {} clearGlasses() {}
    setFrameFit(scale, verticalMm) { fitCalls.push({ scale, verticalMm }) }
    setPose(pose) { renderPose = pose }
    async setGlasses() {}
  }
  const context = createContext({
    document: { createElement: makeElement }, getComputedStyle: () => ({ position: 'relative' }),
    ResizeObserver: class { observe() {} disconnect() {} }, performance, console, Blob, URL, AbortController,
    cancelAnimationFrame() {}, requestAnimationFrame(callback) { scheduled = callback; return 1 },
    createImageBitmap: async () => ({ width: 400, height: 300, close() {} }),
    navigator: { mediaDevices: { async getUserMedia() {
      if (getUserMedia) return getUserMedia(streams)
      const listeners = new Map()
      const track = {
        stopped: false,
        stop() { this.stopped = true },
        addEventListener(type, fn) { listeners.set(type, fn) },
        removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type) },
        emit(type) { listeners.get(type)?.() },
      }
      const stream = { track, getTracks: () => [track] }; streams.push(stream); return stream
    } } },
  })
  const module = new SourceTextModule(source, { context })
  const deps = {
    './lighting': { LightProbe: class { reset() {} sample() { return null } } },
    './renderer': { GlassesRenderer: FakeRenderer },
    './tracking': { FaceTracker: { create: (...args) => { creationCalls++; return createTracker(...args) } } },
  }
  await module.link((name) => { const values = deps[name]; return new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value) }, { context }) })
  await module.evaluate()
  const widget = new module.namespace.TryOn(makeElement('container'), {
    wasmPath: 'local', modelPath: 'local',
    onStatus: (status, detail) => statuses.push({ status, detail }),
    onProgress: (progress) => progressEvents.push(progress),
    onPose: (pose) => poses.push(pose),
  })
  return { widget, statuses: new Proxy(statuses, { get(t, p) { if (p === 'at') return (i) => t.at(i)?.status; return Reflect.get(t, p) } }), rawStatuses: statuses, progressEvents, poses, streams, contexts, elements, fitCalls, get renderCalls() { return renderCalls }, get creationCalls() { return creationCalls }, get renderPose() { return renderPose },
    frame() { const callback = scheduled; assert.ok(callback, 'a video frame was scheduled'); scheduled = null; elements.find((el) => el.tag === 'video').currentTime++; callback() },
    get scheduled() { return scheduled },
  }
}

test('初始化失败后重试真正重新创建 tracker，失败时停止媒体', async () => {
  const tracker = trackerWith(); let attempts = 0
  const h = await harness(async () => { if (++attempts === 1) throw new Error('WASM unavailable'); return tracker })
  await h.widget.startCamera()
  assert.equal(h.statuses.at(-1), 'error'); assert.equal(h.streams[0].track.stopped, true); assert.equal(h.widget.source, 'none')
  await h.widget.startCamera(); h.frame()
  assert.equal(h.creationCalls, 2); assert.equal(h.statuses.at(-1), 'tracking'); assert.equal(h.widget.source, 'camera')
  h.widget.dispose(); await turn()
})

test('并发启动共享初始化，只让最后一次启动准备模型和接管画面', async () => {
  const gate = deferred(), tracker = trackerWith(), h = await harness(() => gate.promise)
  const first = h.widget.startCamera(); await turn()
  const second = h.widget.startCamera(); await turn()
  assert.equal(h.creationCalls, 1); assert.equal(h.streams[0].track.stopped, true)
  gate.resolve(tracker); await Promise.all([first, second])
  assert.equal(tracker.prepareCalls, 1); assert.equal(h.widget.source, 'camera'); assert.equal(h.streams[1].track.stopped, false)
  h.widget.dispose(); await turn()
})

test('初始化晚于dispose返回时关闭tracker，且不重新开启画面', async () => {
  const gate = deferred(), tracker = trackerWith(), h = await harness(() => gate.promise)
  const starting = h.widget.startCamera(); await turn(); h.widget.dispose(); gate.resolve(tracker)
  await starting; await turn()
  assert.equal(tracker.prepareCalls, 0); assert.equal(tracker.disposeCalls, 1); assert.equal(h.widget.source, 'none'); assert.equal(h.scheduled, null)
  assert.equal(h.streams[0].track.stopped, true)
  await h.widget.startCamera(); assert.equal(h.creationCalls, 1); assert.equal(h.streams.length, 1)
})

test('dispose等待已开始的模型准备结束再清理，避免晚到模型泄漏', async () => {
  const gate = deferred(), tracker = trackerWith({ async prepareVideo() { this.prepareCalls++; await gate.promise } }), h = await harness(async () => tracker)
  const starting = h.widget.startCamera(); await turn(); h.widget.dispose(); await turn()
  assert.equal(tracker.disposeCalls, 0); gate.resolve(); await starting; await turn()
  assert.equal(tracker.disposeCalls, 1); assert.equal(h.widget.source, 'none'); assert.equal(h.scheduled, null)
})

test('运行中trackVideo异常关闭媒体并清除姿态，之后可重新启动', async () => {
  let calls = 0
  const tracker = trackerWith({ trackVideo() { if (++calls === 2) throw new Error('tracker runtime failed'); return { landmarks: [] } } })
  const h = await harness(async () => tracker)
  await h.widget.setGlasses('/frame.glb'); await h.widget.startCamera(); h.frame()
  assert.equal(h.statuses.at(-1), 'tracking'); h.frame()
  assert.equal(h.statuses.at(-1), 'error'); assert.equal(h.widget.source, 'none'); assert.equal(h.streams[0].track.stopped, true)
  assert.equal(h.elements.find((el) => el.tag === 'video').srcObject, null)
  assert.equal(h.renderPose, null); assert.equal(h.poses.at(-1), null); assert.equal(h.scheduled, null)
  await assert.rejects(h.widget.capture('/frame.glb'))
  await h.widget.startCamera(); h.frame(); assert.equal(h.statuses.at(-1), 'tracking')
  h.widget.dispose(); await turn()
})

test('camera capture将视频与overlay在同一次镜像变换中按顺序合成', async () => {
  const h = await harness(async () => trackerWith())
  await h.widget.setGlasses('/frame.glb'); await h.widget.startCamera(); h.frame()
  const blob = await h.widget.capture('/frame.glb'); const events = h.contexts.at(-1).events
  assert.ok(blob.size > 0)
  assert.deepEqual(events, [['translate', 400, 0], ['scale', -1, 1], ['draw', 'video', true, 0, 0, 400, 300], ['draw', 'canvas', true, 0, 0, 400, 300]])
  h.widget.dispose(); await turn()
})

test('photo capture按原方向合成照片与overlay，不施加镜像', async () => {
  const h = await harness(async () => trackerWith())
  await h.widget.setGlasses('/frame.glb'); await h.widget.showPhoto(new Blob(['photo']))
  await h.widget.capture('/frame.glb')
  assert.deepEqual(h.contexts.at(-1).events, [['draw', 'img', false, 0, 0, 400, 300], ['draw', 'canvas', false, 0, 0, 400, 300]])
  h.widget.dispose(); await turn()
})

test('照片校准立即重绘，换款及拍照保留姿态，不重新初始化或推理', async () => {
  let detections = 0
  const tracker = trackerWith({ trackImage() { detections++; return { landmarks: [] } } })
  const h = await harness(async () => tracker)
  await h.widget.setGlasses('/frame.glb'); await h.widget.showPhoto(new Blob(['photo']))
  const pose = h.renderPose, before = h.renderCalls
  h.widget.setFrameFit(0.9, 2)
  assert.deepEqual(h.fitCalls.at(-1), { scale: 0.9, verticalMm: 2 })
  assert.ok(h.renderCalls > before); assert.equal(h.renderPose, pose)
  await h.widget.setGlasses('/another.glb'); await h.widget.capture('/another.glb')
  assert.equal(h.creationCalls, 1); assert.equal(tracker.prepareCalls, 1); assert.equal(detections, 1)
  assert.equal(h.widget.source, 'photo'); assert.equal(h.renderPose, pose)
  h.widget.dispose(); const calls = h.fitCalls.length; h.widget.setFrameFit(1, 0)
  assert.equal(h.fitCalls.length, calls); await turn()
})

test('摄像头与照片模式完整发射真实细粒度加载阶段，无卡死状态', async () => {
  let trackerRef
  const h = await harness(async (opts) => {
    opts.onProgress?.({ stage: 'runtime', loadedBytes: 512, totalBytes: 1024, runtime: { loadedBytes: 512, totalBytes: 1024, done: false }, model: { loadedBytes: 256, totalBytes: 512, done: false } })
    opts.onProgress?.({ stage: 'model', loadedBytes: 256, totalBytes: 512, runtime: { loadedBytes: 1024, totalBytes: 1024, done: true }, model: { loadedBytes: 256, totalBytes: 512, done: false } })
    trackerRef = trackerWith({
      async prepareVideo() { this.prepareCalls++; opts.onProgress?.({ stage: 'initializing' }) },
      async prepareImage() { this.prepareCalls++; opts.onProgress?.({ stage: 'initializing' }) },
    })
    return trackerRef
  })
  await h.widget.startCamera()
  assert.deepEqual(h.progressEvents.map((e) => e.phase), [
    'acquiring-camera',
    'loading-runtime',
    'loading-model',
    'initializing-tracker',
    'first-frame',
  ])
  h.frame()
  assert.equal(h.progressEvents.at(-1).phase, 'tracking')

  h.progressEvents.length = 0
  await h.widget.showPhoto(new Blob(['photo']))
  assert.deepEqual(h.progressEvents.map((e) => e.phase), [
    'decoding-photo',
    'initializing-tracker',
    'first-frame',
    'tracking',
  ])
  assert.equal(h.creationCalls, 1)
  h.widget.dispose(); await turn()
})

test('加载未完成时 stop() 取消请求并复位，之后可重新发起下载；已就绪则复用', async () => {
  let signalInCreate
  const gate = deferred()
  const h = await harness(async (opts) => {
    signalInCreate = opts.signal
    if (h.creationCalls === 1) return gate.promise
    return trackerWith()
  })
  const first = h.widget.startCamera(); await turn()
  assert.equal(signalInCreate.aborted, false)
  h.widget.stop()
  assert.equal(signalInCreate.aborted, true)
  assert.equal(h.statuses.at(-1), 'idle')
  gate.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
  await first; await turn()
  assert.equal(h.statuses.at(-1), 'idle')

  await h.widget.startCamera(); h.frame()
  assert.equal(h.creationCalls, 2)
  assert.equal(h.statuses.at(-1), 'tracking')
  h.widget.stop()
  await h.widget.startCamera(); h.frame()
  assert.equal(h.creationCalls, 2)
  h.widget.dispose(); await turn()
})

test('摄像头中断或权限异常返回可操作错误提示并可恢复', async () => {
  let rejectCamera = true
  const h = await harness(async () => trackerWith(), {
    getUserMedia(streams) {
      if (rejectCamera) {
        const err = new Error('Permission denied'); err.name = 'NotAllowedError'
        throw err
      }
      const listeners = new Map()
      const track = {
        stopped: false,
        stop() { this.stopped = true },
        addEventListener(type, fn) { listeners.set(type, fn) },
        removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type) },
        emit(type) { listeners.get(type)?.() },
      }
      const stream = { track, getTracks: () => [track] }; streams.push(stream); return stream
    },
  })
  await h.widget.startCamera()
  assert.equal(h.statuses.at(-1), 'camera-denied')
  assert.match(h.rawStatuses.at(-1).detail, /允许摄像头权限/)

  rejectCamera = false
  await h.widget.startCamera(); h.frame()
  assert.equal(h.statuses.at(-1), 'tracking')
  h.streams[0].track.emit('ended')
  assert.equal(h.statuses.at(-1), 'camera-unavailable')
  assert.match(h.rawStatuses.at(-1).detail, /信号已中断/)
  h.widget.dispose(); await turn()
})
