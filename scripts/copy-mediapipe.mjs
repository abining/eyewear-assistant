// Copies the MediaPipe WASM runtime from node_modules and prepares the face
// model under content-versioned immutable paths, generating runtime metadata so
// the app loads from same-origin CDN with long-term caching and clean busting.
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const FALLBACK_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task'
const WASM_FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']
const MODEL_FILENAME = 'face_landmarker.task'

function sha256Buffer(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function findExistingModel(dest, extraModelPath) {
  const candidates = []
  if (extraModelPath && existsSync(extraModelPath)) candidates.push(extraModelPath)
  const legacy = join(dest, MODEL_FILENAME)
  if (existsSync(legacy)) candidates.push(legacy)
  const versionedRoot = join(dest, 'v')
  if (existsSync(versionedRoot)) {
    for (const entry of readdirSync(versionedRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('model-')) continue
      const candidate = join(versionedRoot, entry.name, MODEL_FILENAME)
      if (existsSync(candidate)) candidates.push(candidate)
    }
  }
  for (const candidate of candidates) {
    const stat = statSync(candidate)
    if (stat.isFile() && stat.size > 0) return candidate
  }
  return null
}

async function downloadModelBytes(fetchImpl, urls) {
  const errors = []
  for (const url of urls) {
    try {
      const res = await fetchImpl(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const bytes = Buffer.from(await res.arrayBuffer())
      if (!bytes.byteLength) throw new Error('empty response body')
      return { bytes, url }
    } catch (err) {
      errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw new Error(errors.join('; '))
}

function writeIfChanged(filePath, content) {
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath)
    const next = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
    if (existing.equals(next)) return
  }
  writeFileSync(filePath, content)
}

export async function syncMediaPipeAssets({
  root = join(dirname(fileURLToPath(import.meta.url)), '..'),
  fetchImpl = globalThis.fetch,
  modelUrls = process.env.MEDIAPIPE_MODEL_URL
    ? [process.env.MEDIAPIPE_MODEL_URL]
    : [DEFAULT_MODEL_URL, FALLBACK_MODEL_URL],
  localModelPath = process.env.MEDIAPIPE_FACE_MODEL_PATH,
  logger = console,
} = {}) {
  const pkgRoot = join(root, 'node_modules', '@mediapipe', 'tasks-vision')
  const pkgJsonPath = join(pkgRoot, 'package.json')
  const wasmSrcDir = join(pkgRoot, 'wasm')
  for (const filename of WASM_FILES) {
    const srcFile = join(wasmSrcDir, filename)
    if (!existsSync(srcFile)) {
      throw new Error(`Missing MediaPipe WASM asset: ${srcFile}`)
    }
  }
  const packageVersion = existsSync(pkgJsonPath)
    ? JSON.parse(readFileSync(pkgJsonPath, 'utf8')).version ?? 'unknown'
    : 'unknown'

  const dest = join(root, 'public', 'mediapipe')
  const versionedRoot = join(dest, 'v')
  mkdirSync(versionedRoot, { recursive: true })

  // Retain/reuse existing local face_landmarker.task before attempting any download.
  let modelBytes
  let modelSource = 'local'
  const existingModel = findExistingModel(dest, localModelPath)
  if (existingModel) {
    modelBytes = readFileSync(existingModel)
    modelSource = existingModel
  } else {
    if (typeof fetchImpl !== 'function') {
      throw new Error(`Missing local ${MODEL_FILENAME} and fetch is unavailable`)
    }
    try {
      const downloaded = await downloadModelBytes(fetchImpl, modelUrls)
      modelBytes = downloaded.bytes
      modelSource = downloaded.url
      logger.log(`downloaded ${MODEL_FILENAME} from ${downloaded.url} (${modelBytes.byteLength} bytes)`)
    } catch (err) {
      throw new Error(
        `Failed to obtain ${MODEL_FILENAME} (${err instanceof Error ? err.message : String(err)}). ` +
          `Place a valid ${MODEL_FILENAME} at ${join(dest, MODEL_FILENAME)} or set MEDIAPIPE_FACE_MODEL_PATH and re-run prepare:models.`,
      )
    }
  }

  // Hash actual bytes for deterministic, content-versioned paths.
  const wasmBuffers = Object.fromEntries(WASM_FILES.map((name) => [name, readFileSync(join(wasmSrcDir, name))]))
  const wasmHashes = Object.fromEntries(WASM_FILES.map((name) => [name, sha256Buffer(wasmBuffers[name])]))
  const wasmBundleHash = createHash('sha256')
  for (const name of WASM_FILES) {
    wasmBundleHash.update(name)
    wasmBundleHash.update(wasmBuffers[name])
  }
  const wasmVersion = wasmBundleHash.digest('hex').slice(0, 12)
  const modelSha256 = sha256Buffer(modelBytes)
  const modelVersion = modelSha256.slice(0, 12)

  const wasmDirName = `wasm-${wasmVersion}`
  const modelDirName = `model-${modelVersion}`
  const wasmDestDir = join(versionedRoot, wasmDirName)
  const modelDestDir = join(versionedRoot, modelDirName)
  mkdirSync(wasmDestDir, { recursive: true })
  mkdirSync(modelDestDir, { recursive: true })

  for (const name of WASM_FILES) {
    const target = join(wasmDestDir, name)
    if (!existsSync(target) || sha256Buffer(readFileSync(target)) !== wasmHashes[name]) {
      cpSync(join(wasmSrcDir, name), target)
    }
  }
  writeIfChanged(join(modelDestDir, MODEL_FILENAME), modelBytes)

  // Clean up legacy unversioned paths and stale version directories so dist/ never ships duplicates.
  for (const entry of readdirSync(dest, { withFileTypes: true })) {
    if (entry.name !== 'v') {
      rmSync(join(dest, entry.name), { recursive: true, force: true })
    }
  }
  for (const entry of readdirSync(versionedRoot, { withFileTypes: true })) {
    if (entry.name !== wasmDirName && entry.name !== modelDirName) {
      rmSync(join(versionedRoot, entry.name), { recursive: true, force: true })
    }
  }

  const metadata = {
    packageVersion,
    wasmVersion,
    modelVersion,
    wasmDir: `mediapipe/v/${wasmDirName}`,
    wasmLoader: `mediapipe/v/${wasmDirName}/vision_wasm_internal.js`,
    wasmBinary: `mediapipe/v/${wasmDirName}/vision_wasm_internal.wasm`,
    modelPath: `mediapipe/v/${modelDirName}/${MODEL_FILENAME}`,
    files: {
      'vision_wasm_internal.js': {
        bytes: wasmBuffers['vision_wasm_internal.js'].byteLength,
        sha256: wasmHashes['vision_wasm_internal.js'],
      },
      'vision_wasm_internal.wasm': {
        bytes: wasmBuffers['vision_wasm_internal.wasm'].byteLength,
        sha256: wasmHashes['vision_wasm_internal.wasm'],
      },
      [MODEL_FILENAME]: {
        bytes: modelBytes.byteLength,
        sha256: modelSha256,
      },
    },
  }

  const generatedPath = join(root, 'src', 'generated', 'mediapipe-assets.ts')
  mkdirSync(dirname(generatedPath), { recursive: true })
  const moduleSource =
    `// Generated by scripts/copy-mediapipe.mjs — do not edit manually.\n` +
    `export const MEDIAPIPE_ASSETS = ${JSON.stringify(metadata, null, 2)} as const\n`
  writeIfChanged(generatedPath, moduleSource)

  return { ...metadata, modelSource }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  syncMediaPipeAssets().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}
