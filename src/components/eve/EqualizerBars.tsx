import React from 'react'
import { cn } from '@/lib/utils'

/**
 * Animated equalizer bars (CSS) used as the mic button's "audio moving" indicator
 * while voice is active. Bars use `currentColor`, so they inherit the button's
 * text color. Decorative — aria-hidden. Keyframe `eve-eq` lives in eve.css.
 */
export const EqualizerBars: React.FC<{ className?: string }> = ({ className }) => (
  <span aria-hidden className={cn('flex h-3.5 items-end gap-[2px]', className)}>
    {[0, 1, 2, 3].map((i) => (
      <span
        className="eve-eq-bar h-full w-[2px] rounded-full bg-current"
        key={i}
        style={{ animationDelay: `${i * 0.15}s` }}
      />
    ))}
  </span>
)
