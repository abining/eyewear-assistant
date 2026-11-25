import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm'
import * as three from 'three'
import { syncMediaPipeAssets } from '../scripts/copy-mediapipe.mjs'

async function trackerHarness({ fetchImpl, createFromOptions, onCreateTrackerArgs } = {}) {
  const createdBlobs = [], revokedBlobs = []
  let blobSeq = 0
  const context = createContext({
    console,
    Float32Array,
    Uint8Array,
    Blob,
    AbortController,
    setTimeout,
    clearTimeout,
    URL: {
      createObjectURL(blob) { const u = `blob:test/${++blobSeq}`; createdBlobs.push({ u, blob }); return u },
      revokeObjectURL(u) { revokedBlobs.push(u) },
    },
    HTMLVideoElement: class {},
    HTMLImageElement: class {},
  })
  const modules = new Map()
  function synthetic(values) {
    return new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value) }, { context })
  }
  const dependencies = {
    three: synthetic(three),
    '@mediapipe/tasks-vision': synthetic({
      FilesetResolver: { forVisionTasks: async () => ({}) },
      FaceLandmarker: {
        createFromOptions: createFromOptions ?? (async (fileset, options) => {
          onCreateTrackerArgs?.({ fileset, options })
          return { close() {} }
        }),
      },
    }),
  }
  async function load(name) {
    if (dependencies[name]) return dependencies[name]
    if (!modules.has(name)) {
      const source = stripTypeScriptTypes(await readFile(new URL(`../src/core/${name.replace('./', '')}.ts`, import.meta.url), 'utf8'), { mode: 'transform' })
      const module = new SourceTextModule(source, { context }); modules.set(name, module)
      await module.link(load)
    }
    return modules.get(name)
  }
  const module = await load('./tracking'); await module.evaluate()
  return { FaceTracker: module.namespace.FaceTracker, createdBlobs, revokedBlobs, fetchImpl }
}

async function defaultTrackerSetup() {
  const { FaceTracker } = await trackerHarness()
  const tracker = await FaceTracker.create({ wasmPath: 'local', modelPath: 'local', fitToFace: false })
  const source = { width: 1280, height: 720 }
  const face = new three.Matrix4().makeTranslation(0, 0, -40)
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  for (const [x, upper, lower, outer, inner, iris] of [[0.4, 159, 145, 33, 133, 468], [0.6, 386, 374, 263, 362, 473]]) {
    landmarks[upper] = { x, y: 0.48, z: 0 }; landmarks[lower] = { x, y: 0.52, z: 0 }
    landmarks[outer] = { x: x - 0.04, y: 0.5, z: 0 }; landmarks[inner] = { x: x + 0.04, y: 0.5, z: 0 }
    landmarks[iris] = { x, y: 0.5, z: 0 }
    landmarks[iris + 1] = { x: x - 0.012, y: 0.5, z: 0 }; landmarks[iris + 3] = { x: x + 0.012, y: 0.5, z: 0 }
    landmarks[iris + 2] = { x, y: 0.48, z: 0 }; landmarks[iris + 4] = { x, y: 0.52, z: 0 }
  }
  return { tracker, landmarks, source, face }
}

test('闭眼或单眼眨眼时忽略虹膜猜测，保留已有缩放；重新睁眼后恢复测量', async () => {
  const { tracker, landmarks, source, face } = await defaultTrackerSetup()
  const result = { facialTransformationMatrixes: [{ data: face.elements }], faceLandmarks: [landmarks] }
  const valid = tracker.poseFrom(result, source, 1 / 30, true).faceScale
  assert.ok(Number.isFinite(valid)); assert.notEqual(valid, 1)
  landmarks[145].y = landmarks[159].y
  assert.equal(tracker.measureIrisScale(landmarks, face, source), null)
  assert.equal(tracker.poseFrom(result, source, 1 / 30, true).faceScale, valid)
  landmarks[374].y = landmarks[386].y
  assert.equal(tracker.measureIrisScale(landmarks, face, source), null)
  landmarks[145].y = 0.52; landmarks[374].y = 0.52
  assert.ok(Number.isFinite(tracker.measureIrisScale(landmarks, face, source)))
  tracker.reset(); landmarks[145].y = landmarks[159].y
  assert.equal(tracker.poseFrom(result, source, 1 / 30, true).faceScale, 1)
})

test('FaceTracker 并行流式下载一次 WASM 与模型，复用缓存不重复拉取，dispose 释放 Blob', async () => {
  const fetchedUrls = []
  const createCalls = []
  const progress = []
  const makeStreamResponse = (chunks, headers) => ({
    ok: true,
    status: 200,
    headers: new Headers(headers),
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }),
  })
  const fetchImpl = async (url) => {
    fetchedUrls.push(url)
    if (url.endsWith('.wasm')) {
      return makeStreamResponse(
        [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])],
        { 'content-encoding': 'br', 'content-length': '2' },
      )
    }
    return makeStreamResponse([new Uint8Array([9, 8, 7, 6])], { 'content-length': '4' })
  }

  let attempts = 0
  const { FaceTracker, createdBlobs, revokedBlobs } = await trackerHarness({
    createFromOptions: async (fileset, options) => {
      attempts++
      createCalls.push({ fileset, delegate: options.baseOptions.delegate, hasBuffer: options.baseOptions.modelAssetBuffer instanceof Uint8Array, hasPath: !!options.baseOptions.modelAssetPath })
      if (attempts === 1) throw new Error('GPU unavailable')
      return { close() {} }
    },
  })

  const tracker = await FaceTracker.create({
    wasmPath: '/mediapipe/v/wasm-abc',
    wasmLoaderPath: '/mediapipe/v/wasm-abc/vision_wasm_internal.js',
    wasmBinaryPath: '/mediapipe/v/wasm-abc/vision_wasm_internal.wasm',
    wasmBytes: 5,
    modelPath: '/mediapipe/v/model-xyz/face_landmarker.task',
    modelBytes: 4,
    fetchImpl,
    onProgress: (p) => progress.push(p),
  })

  assert.deepEqual(fetchedUrls.sort(), [
    '/mediapipe/v/model-xyz/face_landmarker.task',
    '/mediapipe/v/wasm-abc/vision_wasm_internal.wasm',
  ])
  assert.ok(progress.some((p) => p.stage === 'runtime' && p.totalBytes === 5 && p.loadedBytes === 5))
  assert.equal(createdBlobs.length, 1)

  await tracker.prepareVideo()
  // GPU failed once and fell back to CPU using modelAssetBuffer, zero extra fetch.
  assert.equal(createCalls.length, 2)
  assert.equal(tracker.activeDelegate, 'CPU')
  assert.equal(createCalls[0].hasBuffer, true)
  assert.equal(createCalls[0].hasPath, false)
  assert.equal(createCalls[1].delegate, 'CPU')

  await tracker.prepareImage()
  assert.equal(createCalls.length, 3)
  assert.equal(fetchedUrls.length, 2)
  assert.ok(progress.some((p) => p.stage === 'initializing'))

  tracker.setDelegate('GPU')
  assert.equal(revokedBlobs.length, 0)
  tracker.dispose()
  assert.deepEqual(revokedBlobs, [createdBlobs[0].u])
})

test('FaceTracker 下载卡死时触发超时并拒绝缓存失败结果', async () => {
  const { FaceTracker } = await trackerHarness()
  const aborted = []
  const fetchImpl = (url, { signal }) =>
    new Promise((_, reject) => {
      signal.addEventListener('abort', () => {
        aborted.push(url)
        const err = new Error('aborted'); err.name = 'AbortError'; reject(err)
      })
    })
  await assert.rejects(
    FaceTracker.create({
      wasmPath: '/mediapipe/v/wasm-1',
      modelPath: '/mediapipe/v/model-1/face_landmarker.task',
      fetchImpl,
      fetchTimeoutMs: 25,
    }),
    /下载超时/,
  )
  assert.equal(aborted.length, 2)
})

test('copy-mediapipe 复用本地模型、按实际字节哈希归档、清理旧路径并在缺模型且下载失败时报错退出', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'mediapipe-sync-'))
  try {
    const wasmDir = join(temp, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
    await mkdir(wasmDir, { recursive: true })
    await writeFile(join(temp, 'node_modules', '@mediapipe', 'tasks-vision', 'package.json'), JSON.stringify({ version: '1.2.2' }))
    await writeFile(join(wasmDir, 'vision_wasm_internal.js'), 'console.log("loader")')
    await writeFile(join(wasmDir, 'vision_wasm_internal.wasm'), new Uint8Array([0, 97, 115, 109]))

    const legacyDest = join(temp, 'public', 'mediapipe')
    await mkdir(join(legacyDest, 'wasm'), { recursive: true })
    await mkdir(join(legacyDest, 'v', 'wasm-stale'), { recursive: true })
    await writeFile(join(legacyDest, 'wasm', 'old.wasm'), 'stale')
    await writeFile(join(legacyDest, 'v', 'wasm-stale', 'old.js'), 'stale')
    const localModel = new Uint8Array([10, 20, 30, 40])
    await writeFile(join(legacyDest, 'face_landmarker.task'), localModel)

    let fetchCalled = false
    const meta = await syncMediaPipeAssets({
      root: temp,
      fetchImpl: async () => { fetchCalled = true; throw new Error('network forbidden') },
    })
    assert.equal(fetchCalled, false)
    const expectedModelSha = createHash('sha256').update(localModel).digest('hex')
    assert.equal(meta.modelVersion, expectedModelSha.slice(0, 12))
    assert.equal(meta.files['face_landmarker.task'].sha256, expectedModelSha)

    // Stale legacy & old version directories were cleaned up; generated metadata exists.
    await assert.rejects(readFile(join(legacyDest, 'face_landmarker.task')))
    await assert.rejects(readFile(join(legacyDest, 'v', 'wasm-stale', 'old.js')))
    const versionedModel = await readFile(join(temp, 'public', meta.modelPath))
    assert.deepEqual(new Uint8Array(versionedModel), localModel)
    const generatedTs = await readFile(join(temp, 'src', 'generated', 'mediapipe-assets.ts'), 'utf8')
    assert.match(generatedTs, new RegExp(meta.wasmBinary))

    // Second run reuses the already-versioned local model without network.
    const meta2 = await syncMediaPipeAssets({
      root: temp,
      fetchImpl: async () => { fetchCalled = true; throw new Error('network forbidden') },
    })
    assert.equal(fetchCalled, false)
    assert.equal(meta2.modelVersion, meta.modelVersion)

    // Missing local model + failed download throws instead of warning-only exit 0.
    await rm(join(temp, 'public', 'mediapipe'), { recursive: true, force: true })
    await assert.rejects(
      syncMediaPipeAssets({ root: temp, fetchImpl: async () => ({ ok: false, status: 503 }) }),
      /Failed to obtain face_landmarker\.task/,
    )
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('public/_headers 仅对 /mediapipe/v/* 配置 1 年不可变缓存，且不包含会合并的 /mediapipe/* 规则', async () => {
  const headers = await readFile(new URL('../public/_headers', import.meta.url), 'utf8')
  assert.equal(headers.includes('/mediapipe/*'), false)
  const match = headers.match(/^\/mediapipe\/v\/\*\r?\n((?:[ \t]+[^\r\n]+\r?\n?)*)/m)
  assert.ok(match, 'missing /mediapipe/v/* header block')
  const cacheLines = match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^Cache-Control:/i.test(line))
  assert.deepEqual(cacheLines, ['Cache-Control: public, max-age=31536000, immutable'])
})
