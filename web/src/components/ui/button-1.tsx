import type React from 'react';
import clsx from 'clsx';

import { Spinner } from './spinner-1.js';

const sizes = [
  {
    tiny: 'h-6 px-1.5 text-sm',
    small: 'h-8 px-1.5 text-sm',
    medium: 'h-10 px-2.5 text-sm',
    large: 'h-12 px-3.5 text-base',
  },
  {
    tiny: 'h-6 w-6 text-sm',
    small: 'h-8 w-8 text-sm',
    medium: 'h-10 w-10 text-sm',
    large: 'h-12 w-12 text-base',
  },
] as const;

const types = {
  primary: 'bg-gray-1000 hover:bg-gray-1000-h fill-background-100 text-background-100',
  secondary:
    'bg-background-100 hover:bg-gray-alpha-200 fill-gray-1000 text-gray-1000 border border-gray-alpha-400',
  tertiary: 'bg-transparent hover:bg-gray-alpha-200 fill-gray-1000 text-gray-1000',
  error: 'bg-red-800 hover:bg-red-900 fill-white text-white',
  warning: 'bg-amber-800 hover:bg-amber-850 fill-black text-black',
};

const shapes = {
  square: {
    tiny: 'rounded',
    small: 'rounded-md',
    medium: 'rounded-md',
    large: 'rounded-lg',
  },
  circle: {
    tiny: 'rounded-[100%]',
    small: 'rounded-[100%]',
    medium: 'rounded-[100%]',
    large: 'rounded-[100%]',
  },
  rounded: {
    tiny: 'rounded-[100px]',
    small: 'rounded-[100px]',
    medium: 'rounded-[100px]',
    large: 'rounded-[100px]',
  },
};

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  size?: keyof (typeof sizes)[0];
  type?: keyof typeof types;
  buttonType?: React.ButtonHTMLAttributes<HTMLButtonElement>['type'];
  variant?: 'styled' | 'unstyled';
  shape?: keyof typeof shapes;
  svgOnly?: boolean;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  shadow?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  size = 'medium',
  type = 'primary',
  buttonType = 'button',
  variant = 'styled',
  shape = 'square',
  svgOnly = false,
  children,
  prefix,
  suffix,
  shadow = false,
  loading = false,
  disabled = false,
  fullWidth = false,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={buttonType}
      disabled={disabled}
      tabIndex={0}
      className={clsx(
        'flex items-center justify-center gap-0.5 duration-150',
        sizes[+svgOnly][size],
        disabled || loading
          ? 'cursor-not-allowed border border-gray-400 bg-gray-100 text-gray-700'
          : types[type],
        shapes[shape][size],
        shadow && 'shadow-border-small border-none',
        fullWidth && 'w-full',
        variant === 'unstyled'
          ? 'h-fit bg-transparent px-0 text-gray-1000 outline-none hover:bg-transparent'
          : 'focus:shadow-focus-ring focus:outline-0',
        className
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === 'large' ? 24 : 16} /> : prefix}
      {!svgOnly && (
        <span
          className={clsx(
            'relative overflow-hidden overflow-ellipsis whitespace-nowrap font-sans',
            size !== 'tiny' && variant !== 'unstyled' && 'px-1.5'
          )}
        >
          {children}
        </span>
      )}
      {svgOnly ? children : null}
      {!loading && suffix}
    </button>
  );
}
