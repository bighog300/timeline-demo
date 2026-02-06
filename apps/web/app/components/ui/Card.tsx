import React, { type ReactNode } from 'react';

import styles from './Card.module.css';

type CardProps = {
  children: ReactNode;
  className?: string;
};

export default function Card({ children, className }: CardProps) {
  const classes = [styles.card, className].filter(Boolean).join(' ');
  return <div className={classes}>{children}</div>;
}
