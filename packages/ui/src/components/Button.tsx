import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './Button.css';

export type ButtonTone = 'primary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className'
> {
  readonly children?: ReactNode;
  readonly tone?: ButtonTone;
  readonly size?: ButtonSize;
  readonly fullWidth?: boolean;
  readonly className?: string;
}

export function Button({
  children,
  tone = 'primary',
  size = 'md',
  fullWidth = false,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'orbit-button',
    `orbit-button--${tone}`,
    `orbit-button--${size}`,
    fullWidth ? 'orbit-button--full' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} type={type} {...rest}>
      {children}
    </button>
  );
}
