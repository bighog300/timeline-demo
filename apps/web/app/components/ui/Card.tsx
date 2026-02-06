import React, { type HTMLAttributes, type ReactNode } from 'react';

import styles from './Card.module.css';

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export default function Card({ children, className, ...props }: CardProps) {
  const classes = [styles.card, className].filter(Boolean).join(' ');
  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
}
