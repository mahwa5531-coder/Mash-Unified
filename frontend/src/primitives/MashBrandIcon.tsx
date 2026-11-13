"use client";

import React from 'react';

export interface MashBrandIconProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  size?: number | string;
  className?: string;
}

/**
 * Official MASH Celtic Infinity Knot Gradient Brand Icon.
 * Uses responsive multi-density pixel-sharpened assets (1x, 2x, 3x) for ultra-high clarity across all displays.
 */
export function MashBrandIcon({
  size = 16,
  className = '',
  alt = 'MASH Brand Mark',
  ...props
}: MashBrandIconProps) {
  const pixelSize = typeof size === 'number' ? `${size}px` : size;
  const numSize = typeof size === 'number' ? size : parseInt(String(size), 10) || 16;
  
  const defaultSrc = numSize <= 16 ? '/brand-logo-16.png' : numSize <= 24 ? '/brand-logo-24.png' : '/brand-logo.png';
  const srcSet = numSize <= 20
    ? '/brand-logo-16.png 1x, /brand-logo-32.png 2x, /brand-logo-48.png 3x'
    : numSize <= 32
    ? '/brand-logo-32.png 1x, /brand-logo-64.png 2x'
    : undefined;

  return (
    <img
      src={defaultSrc}
      srcSet={srcSet}
      alt={alt}
      width={typeof size === 'number' ? size : undefined}
      height={typeof size === 'number' ? size : undefined}
      style={{ width: pixelSize, height: pixelSize, objectFit: 'contain' }}
      className={`shrink-0 select-none ${className}`}
      draggable={false}
      decoding="async"
      {...props}
    />
  );
}

export default MashBrandIcon;
