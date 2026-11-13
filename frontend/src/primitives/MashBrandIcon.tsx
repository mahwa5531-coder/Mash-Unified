"use client";

import React from 'react';

export interface MashBrandIconProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  size?: number | string;
  className?: string;
}

/**
 * Official MASH Celtic Infinity Knot Gradient Brand Icon.
 * Displays the high-resolution master brand mark with smooth subpixel scaling.
 */
export function MashBrandIcon({
  size = 16,
  className = '',
  alt = 'MASH Brand Mark',
  ...props
}: MashBrandIconProps) {
  const pixelSize = typeof size === 'number' ? `${size}px` : size;
  return (
    <img
      src="/brand-logo.png"
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
