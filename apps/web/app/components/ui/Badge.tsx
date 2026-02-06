import React, { type ReactNode } from 'react';

import styles from './Badge.module.css';

type BadgeProps = {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning';
};

export default function Badge({ children, tone = 'neutral' }: BadgeProps) {
  const classes = [styles.badge, styles[tone]].join(' ');
  return <span className={classes}>{children}</span>;
}
