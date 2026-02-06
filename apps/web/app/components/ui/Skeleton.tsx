import React, { type HTMLAttributes } from 'react';

import styles from './Skeleton.module.css';

type SkeletonProps = HTMLAttributes<HTMLDivElement> & {
  width?: string;
  height?: string;
};

export default function Skeleton({ width = '100%', height = '16px', style, ...props }: SkeletonProps) {
  return (
    <div
      className={styles.skeleton}
      style={{ width, height, ...style }}
      aria-hidden="true"
      {...props}
    />
  );
}
