export interface FrameFit {
  scale: number
  verticalMm: number
}

export const DEFAULT_FRAME_FIT: FrameFit = { scale: 1, verticalMm: 0 }
export const FRAME_FIT_LIMITS = { minScale: 0.65, maxScale: 1.25, maxVerticalMm: 8 } as const

/** Keep persisted preferences and public API inputs within a useful fitting range. */
export function normalizeFrameFit(value: Partial<FrameFit> | null | undefined): FrameFit {
  const finite = (n: unknown, fallback: number) => typeof n === 'number' && Number.isFinite(n) ? n : fallback
  return {
    scale: Math.min(FRAME_FIT_LIMITS.maxScale, Math.max(FRAME_FIT_LIMITS.minScale, finite(value?.scale, 1))),
    verticalMm: Math.min(FRAME_FIT_LIMITS.maxVerticalMm, Math.max(-FRAME_FIT_LIMITS.maxVerticalMm, finite(value?.verticalMm, 0))),
  }
}
