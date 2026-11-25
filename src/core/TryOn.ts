/**
 * Virtual try-on widget without any framework: give it an element, it shows a
 * mirrored webcam (or an uploaded photo) with a glasses model on the face.
 *
 *   const tryOn = new TryOn(element, { wasmPath, modelPath })
 *   await tryOn.setGlasses('/models/round-01.glb')
 *   await tryOn.startCamera()        // or: await tryOn.showPhoto(fileOrUrl)
 */
import { LightProbe } from './lighting'
import { GlassesRenderer, type GlassesInfo } from './renderer'
import {
  FaceTracker,
  type FaceTrackerAssetProgress,
  type FaceTrackerOptions,
  type FaceTrackerProgress,
  type GlassesPose,
} from './tracking'

export type TryOnStatus =
  | 'idle'
  | 'loading'
  | 'tracking'
  | 'no-face'
  | 'camera-denied'
  | 'camera-unavailable'
  | 'error'

export type TryOnPhase =
  | 'idle'
  | 'acquiring-camera'
  | 'decoding-photo'
  | 'loading-runtime'
  | 'loading-model'
  | 'initializing-tracker'
  | 'first-frame'
  | 'tracking'
  | 'no-face'
  | 'camera-denied'
  | 'camera-unavailable'
  | 'error'

export interface TryOnProgress {
  phase: TryOnPhase
  loadedBytes?: number
  totalBytes?: number
  runtime?: FaceTrackerAssetProgress
  model?: FaceTrackerAssetProgress
}

export interface TryOnOptions extends Omit<FaceTrackerOptions, 'onProgress'> {
  onStatus?: (status: TryOnStatus, detail?: string) => void
  onProgress?: (progress: TryOnProgress) => void
  /** Called after every tracked frame (for diagnostics). */
  onPose?: (pose: GlassesPose | null) => void
  /** Draw the head occluder so its fit can be checked: a wireframe (true) or a solid head. */
  debug?: boolean | 'solid'
  /** Hide what passes behind the head (default true). */
  occlusion?: boolean
  /** Let the frame drop a soft shadow on the face (default true). */
  faceShadow?: boolean
  /**
   * Match the glasses to the camera image: light them like the face in it and
   * soften them to its sharpness (default true).
   */
  matchCamera?: boolean
}

/** The options that can be changed while the widget runs, with TryOn.update. */
export type TryOnSettings = Required<
  Pick<TryOnOptions, 'debug' | 'occlusion' | 'faceShadow' | 'matchCamera' | 'scaleFromIris' | 'fitToFace' | 'delegate'>
>

/** How often the light in the video is measured. */
const LIGHT_INTERVAL_MS = 200
/**
 * Blur that brings the glasses down to the sharpness of the picture, in pixels
 * of the source: video is softer than its resolution, a photo less so.
 */
const VIDEO_BLUR_PX = 0.7
const PHOTO_BLUR_PX = 0.4
const MAX_BLUR_CSS_PX = 1.2

const STYLE = 'position:absolute;inset:0;width:100%;height:100%;display:block;'

export class TryOn {
  private stage: HTMLDivElement
  private video: HTMLVideoElement
  private photo: HTMLImageElement
  private canvas: HTMLCanvasElement
  private renderer: GlassesRenderer
  private tracker: Promise<FaceTracker> | null = null
  private trackerResolved = false
  private abortController = new AbortController()
  private preparing: Promise<void> = Promise.resolve()
  private stream: MediaStream | null = null
  private trackEndedCleanup: (() => void) | null = null
  private mode: 'none' | 'camera' | 'photo' = 'none'
  private raf = 0
  private frameCb = 0
  private lastVideoTime = -1
  private status: TryOnStatus = 'idle'
  private resizeObserver: ResizeObserver
  private sourceAspect = 4 / 3
  private sourceWidth = 0
  private probe = new LightProbe()
  private lastLight = 0
  private generation = 0
  private disposed = false
  private lastPhoto: Blob | string | null = null
  private loadedUrl = ''
  private modelGeneration = 0
  private lastPose: GlassesPose | null = null

  constructor(
    private container: HTMLElement,
    private opts: TryOnOptions,
  ) {
    this.stage = document.createElement('div')
    this.stage.style.cssText = 'position:absolute;overflow:hidden;background:#000;'
    this.video = document.createElement('video')
    this.video.playsInline = true
    this.video.muted = true
    this.video.autoplay = true
    this.video.style.cssText = STYLE + 'object-fit:fill;'
    this.photo = document.createElement('img')
    this.photo.alt = ''
    this.photo.style.cssText = STYLE + 'object-fit:fill;'
    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = STYLE + 'pointer-events:none;'
    this.stage.append(this.video, this.photo, this.canvas)
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative'
    container.append(this.stage)

    this.renderer = new GlassesRenderer(this.canvas, { faceShadow: opts.faceShadow })
    this.renderer.setDebug(opts.debug ?? false)
    this.renderer.setOccluderEnabled(opts.occlusion !== false)
    this.resizeObserver = new ResizeObserver(() => this.layout())
    this.resizeObserver.observe(container)
    this.showSource('none')
    this.layout()
  }

  /** Share an in-flight initialization, but never cache a rejected attempt. */
  private getTracker(): Promise<FaceTracker> {
    if (this.disposed) return Promise.reject(new Error('试戴组件已关闭'))
    if (!this.tracker) {
      this.trackerResolved = false
      if (this.abortController.signal.aborted) {
        this.abortController = new AbortController()
      }
      const pending = FaceTracker.create({
        ...this.opts,
        signal: this.abortController.signal,
        onProgress: (progress) => this.emitTrackerProgress(progress),
      })
      this.tracker = pending
      void pending.then(
        () => {
          if (this.tracker === pending) this.trackerResolved = true
        },
        () => {
          if (this.tracker === pending) {
            this.tracker = null
            this.trackerResolved = false
          }
        },
      )
    }
    return this.tracker
  }

  /** Serialize model preparation so overlapping starts cannot create duplicate models. */
  private async prepareTracker(source: 'camera' | 'photo', gen: number): Promise<FaceTracker | null> {
    const tracker = await this.getTracker()
    if (this.disposed || gen !== this.generation) return null
    const preparation = this.preparing.then(async () => {
      if (this.disposed || gen !== this.generation) return
      if (source === 'camera') await tracker.prepareVideo()
      else await tracker.prepareImage()
    })
    this.preparing = preparation.catch(() => undefined)
    await preparation
    if (this.disposed || gen !== this.generation) return null
    return tracker
  }

  private emitProgress(progress: TryOnProgress): void {
    if (this.disposed) return
    this.opts.onProgress?.(progress)
  }

  private emitTrackerProgress(progress: FaceTrackerProgress): void {
    if (this.disposed || this.status !== 'loading') return
    if (progress.stage === 'runtime') {
      this.emitProgress({
        phase: 'loading-runtime',
        loadedBytes: progress.loadedBytes,
        totalBytes: progress.totalBytes,
        runtime: progress.runtime,
        model: progress.model,
      })
    } else if (progress.stage === 'model') {
      this.emitProgress({
        phase: 'loading-model',
        loadedBytes: progress.loadedBytes,
        totalBytes: progress.totalBytes,
        runtime: progress.runtime,
        model: progress.model,
      })
    } else if (progress.stage === 'initializing') {
      this.emitProgress({ phase: 'initializing-tracker' })
    }
  }

  private setStatus(status: TryOnStatus, detail?: string): void {
    if (status === this.status && !detail) return
    if (this.disposed) return
    this.status = status
    this.opts.onStatus?.(status, detail)
    if (status !== 'loading') {
      this.emitProgress({ phase: status })
    }
  }

  /** Fit the stage inside the container with the aspect ratio of the source. */
  private layout(): void {
    const cw = this.container.clientWidth
    const ch = this.container.clientHeight
    if (!cw || !ch) return
    let w = cw
    let h = cw / this.sourceAspect
    if (h > ch) {
      h = ch
      w = ch * this.sourceAspect
    }
    Object.assign(this.stage.style, {
      width: `${Math.round(w)}px`,
      height: `${Math.round(h)}px`,
      left: `${Math.round((cw - w) / 2)}px`,
      top: `${Math.round((ch - h) / 2)}px`,
    })
    this.renderer.setSize(Math.round(w), Math.round(h), this.sourceAspect)
    this.renderer.render()
    // the overlay is rendered sharper than the picture under it was taken
    let blur = 0
    if (this.opts.matchCamera !== false && this.sourceWidth && this.mode !== 'none') {
      const sourcePx = this.mode === 'photo' ? PHOTO_BLUR_PX : VIDEO_BLUR_PX
      blur = Math.min(MAX_BLUR_CSS_PX, (sourcePx * w) / this.sourceWidth)
    }
    this.canvas.style.filter = blur > 0.15 ? `blur(${blur.toFixed(2)}px)` : ''
  }

  /** Measure the light on the face and hand it to the renderer. dt = 0: no smoothing. */
  private matchLight(source: HTMLVideoElement | ImageBitmap, pose: GlassesPose | null, dt: number): void {
    if (this.opts.matchCamera === false || !pose) return
    this.renderer.setLighting(this.probe.sample(source, pose.landmarks, dt))
  }

  private showSource(which: 'none' | 'camera' | 'photo'): void {
    this.video.style.display = which === 'camera' ? 'block' : 'none'
    this.photo.style.display = which === 'photo' ? 'block' : 'none'
    // the camera view is a mirror; a photo is shown as taken
    this.stage.style.transform = which === 'camera' ? 'scaleX(-1)' : 'none'
  }

  /** What is shown now. */
  get source(): 'none' | 'camera' | 'photo' {
    return this.mode
  }

  /** Apply visual fit immediately, including a paused photo, without rerunning detection. */
  setFrameFit(scale: number, verticalMm: number): void {
    if (this.disposed) return
    this.renderer.setFrameFit(scale, verticalMm)
    this.renderer.setPose(this.lastPose)
    this.renderer.render()
  }

  /** Size and parts of the glasses on show (to check a model), or null. */
  get glassesInfo(): GlassesInfo | null {
    return this.renderer.glassesInfo
  }

  /** The face tracker's delegate in use ("CPU" when the GPU could not start). */
  async activeDelegate(): Promise<'GPU' | 'CPU'> {
    return (await this.getTracker()).activeDelegate
  }

  /**
   * Change settings while running. Drawing settings apply at once; tracking
   * settings measure the face again (a photo is tracked again).
   */
  async update(settings: Partial<TryOnSettings>): Promise<void> {
    const before = { ...this.opts }
    Object.assign(this.opts, settings)
    const o = this.opts
    if ('debug' in settings) this.renderer.setDebug(o.debug ?? false)
    if ('occlusion' in settings) this.renderer.setOccluderEnabled(o.occlusion !== false)
    if ('faceShadow' in settings) this.renderer.setFaceShadow(o.faceShadow !== false)
    if ('matchCamera' in settings && o.matchCamera === false) {
      this.probe.reset()
      this.renderer.setLighting(null)
    }
    const tracker = await this.getTracker()
    if (this.disposed) return
    let retrack = false
    if ((o.delegate ?? 'GPU') !== (before.delegate ?? 'GPU')) {
      tracker.setDelegate(o.delegate ?? 'GPU')
      retrack = true
    } else if (o.scaleFromIris !== before.scaleFromIris || o.fitToFace !== before.fitToFace) {
      tracker.setOptions({ scaleFromIris: o.scaleFromIris, fitToFace: o.fitToFace })
      retrack = true
    }
    if (retrack && this.mode === 'camera') return this.startCamera()
    if ((retrack || 'matchCamera' in settings || 'debug' in settings) && this.mode === 'photo' && this.lastPhoto) {
      return this.showPhoto(this.lastPhoto)
    }
    this.layout()
  }

  preload(urls: string[]): void {
    urls.forEach((u) => void this.renderer.preload(u).catch(() => undefined))
  }

  async setGlasses(url: string | null): Promise<void> {
    const gen = ++this.modelGeneration
    this.loadedUrl = ''
    this.renderer.clearGlasses()
    if (!url) return
    await this.renderer.setGlasses(url)
    if (gen !== this.modelGeneration || this.disposed) return
    if (!this.renderer.glassesInfo?.meshes) throw new Error('模型没有可显示的网格')
    this.loadedUrl = url
    this.renderer.setPose(this.lastPose)
    this.renderer.render()
  }

  /** Copy both layers synchronously before encoding; model/source changes cannot relabel these pixels. */
  async capture(expectedUrl: string): Promise<Blob> {
    if (this.disposed || this.loadedUrl !== expectedUrl || this.status !== 'tracking' || !this.lastPose) {
      throw new Error('请等待当前镜框和人脸追踪就绪')
    }
    const camera = this.mode === 'camera'
    if ((!camera && this.mode !== 'photo') || (camera && (this.video.readyState < 2 || !this.video.videoWidth)) || (!camera && !this.photo.naturalWidth)) {
      throw new Error('当前没有可保存的画面')
    }
    if (!this.canvas.width || !this.canvas.height || !this.stage.clientWidth || !this.stage.clientHeight) throw new Error('画面尺寸无效')
    if (this.renderer.renderer.getContext().isContextLost()) throw new Error('3D 画面暂时不可用，请刷新重试')
    const result = document.createElement('canvas')
    result.width = this.canvas.width
    result.height = this.canvas.height
    const ctx = result.getContext('2d')
    if (!ctx) throw new Error('浏览器不支持画面合成')
    this.renderer.render()
    if (camera) { ctx.translate(result.width, 0); ctx.scale(-1, 1) }
    ctx.drawImage(camera ? this.video : this.photo, 0, 0, result.width, result.height)
    const blur = parseFloat(this.canvas.style.filter.match(/blur\(([\d.]+)/)?.[1] ?? '0')
    if (blur) ctx.filter = `blur(${blur * result.width / this.stage.clientWidth}px)`
    ctx.drawImage(this.canvas, 0, 0, result.width, result.height)
    return new Promise((resolve, reject) => result.toBlob((blob) => blob?.size ? resolve(blob) : reject(new Error('画面保存失败')), 'image/png'))
  }

  stop(): void {
    this.generation++
    if (this.tracker && !this.trackerResolved) {
      this.abortController.abort()
      this.tracker = null
      this.trackerResolved = false
      this.abortController = new AbortController()
    }
    this.stopSources()
    this.setStatus('idle')
  }

  private watchStreamTracks(stream: MediaStream, gen: number): void {
    const tracks = stream.getTracks()
    const onEnded = () => {
      if (gen !== this.generation || this.disposed) return
      this.generation++
      this.stopSources()
      this.opts.onPose?.(null)
      this.setStatus('camera-unavailable', '摄像头信号已中断，请检查设备连接后点击重试。')
    }
    tracks.forEach((track) => track.addEventListener?.('ended', onEnded, { once: true }))
    this.trackEndedCleanup = () => {
      tracks.forEach((track) => track.removeEventListener?.('ended', onEnded))
    }
  }

  /** Start the front camera and follow the face. */
  async startCamera(): Promise<void> {
    if (this.disposed) return
    const gen = ++this.generation
    this.stopSources()
    this.setStatus('loading')
    this.emitProgress({ phase: 'acquiring-camera' })
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setStatus('camera-unavailable', '当前环境无法开启摄像头，请使用 HTTPS 或 localhost 访问，或改用照片模式。')
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
    } catch (err) {
      if (gen !== this.generation || this.disposed) return
      const name = (err as DOMException)?.name
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        this.setStatus('camera-denied', '请在浏览器地址栏或系统设置中允许摄像头权限，然后点击「重试摄像头」。')
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        this.setStatus('camera-unavailable', '未检测到可用摄像头，请连接摄像头后重试，或使用本地照片/参考人头。')
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        this.setStatus('camera-unavailable', '摄像头正被其他应用占用或暂时无法读取，请关闭占用后重试。')
      } else {
        this.setStatus('camera-unavailable', (err as Error)?.message || '摄像头暂时不可用，请检查设备后重试。')
      }
      return
    }
    if (gen !== this.generation || this.disposed) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    this.stream = stream
    this.watchStreamTracks(stream, gen)
    this.video.srcObject = stream
    try {
      await this.video.play()
      if (gen !== this.generation || this.disposed) return
      const tracker = await this.prepareTracker('camera', gen)
      if (!tracker) return
      tracker.reset()
      this.mode = 'camera'
      this.showSource('camera')
      this.lastVideoTime = -1
      this.emitProgress({ phase: 'first-frame' })
      this.loop(tracker, gen)
    } catch (err) {
      if (gen !== this.generation || this.disposed) return
      this.stopSources()
      const msg = (err as Error)?.message
      this.setStatus('error', msg || '摄像头画面或人脸追踪引擎启动失败，请点击重试。')
    }
  }

  private loop(tracker: FaceTracker, gen: number): void {
    const step = () => {
      if (gen !== this.generation || this.disposed) return
      const v = this.video
      if (v.readyState >= 2 && v.videoWidth && v.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = v.currentTime
        const aspect = v.videoWidth / v.videoHeight
        if (Math.abs(aspect - this.sourceAspect) > 1e-3 || v.videoWidth !== this.sourceWidth) {
          // also covers a phone being rotated between portrait and landscape
          this.sourceAspect = aspect
          this.sourceWidth = v.videoWidth
          this.layout()
        }
        let pose: GlassesPose | null = null
        try {
          pose = tracker.trackVideo(v, performance.now())
        } catch (err) {
          this.generation++
          this.stopSources()
          this.opts.onPose?.(null)
          this.setStatus('error', String((err as Error)?.message ?? err))
          return
        }
        const now = performance.now()
        if (now - this.lastLight >= LIGHT_INTERVAL_MS) {
          this.matchLight(v, pose, this.lastLight ? (now - this.lastLight) / 1000 : 0)
          this.lastLight = now
        }
        this.lastPose = pose
        this.renderer.setPose(pose)
        this.renderer.render()
        this.setStatus(pose ? 'tracking' : 'no-face')
        this.opts.onPose?.(pose)
      }
      schedule()
    }
    const schedule = () => {
      if ('requestVideoFrameCallback' in this.video) {
        this.frameCb = this.video.requestVideoFrameCallback(step)
      } else {
        this.raf = requestAnimationFrame(step)
      }
    }
    schedule()
  }

  /** Show a still photo (File, Blob or URL) with the glasses on it. */
  async showPhoto(source: Blob | string): Promise<void> {
    if (this.disposed) return
    const gen = ++this.generation
    this.stopSources()
    this.setStatus('loading')
    this.emitProgress({ phase: 'decoding-photo' })
    this.lastPhoto = source
    const url = typeof source === 'string' ? source : URL.createObjectURL(source)
    let photoDecoded = false
    try {
      const img = this.photo
      img.src = url
      await img.decode()
      photoDecoded = true
      if (gen !== this.generation) return
      // work on an upright bitmap so phone photos with EXIF rotation are handled
      const tracker = await this.prepareTracker('photo', gen)
      if (!tracker) return
      const bitmap = await createImageBitmap(img)
      if (gen !== this.generation) { bitmap.close(); return }
      this.mode = 'photo'
      this.sourceAspect = bitmap.width / bitmap.height
      this.sourceWidth = bitmap.width
      this.showSource('photo')
      this.layout()
      this.emitProgress({ phase: 'first-frame' })
      let pose: GlassesPose | null
      try {
        pose = tracker.trackImage(bitmap)
        this.matchLight(bitmap, pose, 0)
      } finally { bitmap.close() }
      this.lastPose = pose
      this.renderer.setPose(pose)
      this.renderer.render()
      this.setStatus(pose ? 'tracking' : 'no-face')
      this.opts.onPose?.(pose)
    } catch (err) {
      if (gen !== this.generation || this.disposed) return
      const msg = err instanceof Error ? err.message : ''
      const detail = !photoDecoded
        ? '无法读取该照片（可能格式不支持或文件损坏），请换一张清晰正脸照片。'
        : msg || '人脸识别引擎加载或初始化失败，请点击重试或换一张照片。'
      this.setStatus('error', detail)
      console.error(err)
    } finally {
      if (typeof source !== 'string') URL.revokeObjectURL(url)
    }
  }

  private stopSources(): void {
    if (this.mode === 'camera') this.lastPhoto = null
    cancelAnimationFrame(this.raf)
    if (this.frameCb && 'cancelVideoFrameCallback' in this.video) {
      this.video.cancelVideoFrameCallback(this.frameCb)
    }
    this.trackEndedCleanup?.()
    this.trackEndedCleanup = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.video.srcObject = null
    this.mode = 'none'
    this.lastPose = null
    this.showSource('none')
    this.sourceWidth = 0
    this.lastLight = 0
    this.probe.reset()
    this.renderer.setLighting(null)
    this.renderer.setPose(null)
    this.renderer.render()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation++
    this.abortController.abort()
    this.stopSources()
    this.resizeObserver.disconnect()
    this.renderer.dispose()
    // A model can finish loading after disposal was requested. Close it only
    // after that work settles, so a late result cannot leak a live tracker.
    void this.tracker?.then(async (tracker) => {
      await this.preparing
      tracker.dispose()
    }).catch(() => undefined)
    this.stage.remove()
  }
}
