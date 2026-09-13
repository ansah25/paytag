import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { Spinner } from './Spinner';

export type ButtonVariant =
  | 'accent'
  | 'solid'
  | 'outline'
  | 'outline-muted'
  | 'ghost'
  | 'danger-outline';

export type ButtonSize = 36 | 40 | 44 | 48 | 56;

const BASE =
  'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-pill transition-colors disabled:pointer-events-none disabled:opacity-50';

const VARIANTS: Record<ButtonVariant, string> = {
  accent: 'bg-accent font-bold text-on-accent hover:bg-btn hover:text-on-btn',
  solid: 'bg-btn font-bold text-on-btn hover:bg-accent hover:text-on-accent',
  outline: 'border border-line2 font-semibold text-ink hover:border-ink',
  // Small in-row actions (Copy, Remove) — hairline border, secondary ink.
  'outline-muted': 'border border-line font-semibold text-ink2 hover:border-ink hover:text-ink',
  ghost: 'font-semibold text-ink2 hover:bg-surface2 hover:text-ink',
  'danger-outline': 'border border-danger font-bold text-danger hover:bg-danger-bg',
};

const SIZES: Record<ButtonSize, string> = {
  36: 'min-h-9 gap-1.5 px-3 text-xs',
  40: 'min-h-10 gap-2 px-4 text-[13px]',
  44: 'min-h-11 gap-2 px-[18px] text-sm',
  48: 'min-h-12 gap-2.5 px-[22px] text-[15px]',
  56: 'min-h-14 gap-2.5 px-6 text-base',
};

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Disables the button and shows a spinner. Pair with `loadingLabel`. */
  loading?: boolean;
  /** Replaces the label while `loading` ("Saving…", "Waiting for signature…"). */
  loadingLabel?: ReactNode;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}

type NativeButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & { href?: undefined };

type LinkButtonProps = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps | 'href'> & {
    href: string;
    /** Force a plain <a>. Defaults to true for http(s)/mailto/sms/tel hrefs. */
    external?: boolean;
  };

export type ButtonProps = NativeButtonProps | LinkButtonProps;

const isLinkProps = (props: ButtonProps): props is LinkButtonProps =>
  typeof props.href === 'string';

export function Button(props: ButtonProps) {
  const size = props.size ?? 44;
  const classes = cx(
    BASE,
    VARIANTS[props.variant ?? 'accent'],
    SIZES[size],
    props.fullWidth && 'w-full',
    props.className,
  );

  if (isLinkProps(props)) {
    const {
      variant: _variant,
      size: _size,
      loading: _loading,
      loadingLabel: _loadingLabel,
      fullWidth: _fullWidth,
      className: _className,
      href,
      external,
      children,
      ...anchorProps
    } = props;
    const isExternal = external ?? /^(https?:|mailto:|sms:|tel:)/.test(href);
    if (isExternal) {
      const newTab = /^https?:/.test(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {};
      return (
        <a href={href} className={classes} {...newTab} {...anchorProps}>
          {children}
        </a>
      );
    }
    return (
      <Link href={href} className={classes} {...anchorProps}>
        {children}
      </Link>
    );
  }

  const {
    variant: _variant,
    size: _size,
    loading = false,
    loadingLabel,
    fullWidth: _fullWidth,
    className: _className,
    href: _href,
    type = 'button',
    disabled,
    children,
    ...buttonProps
  } = props;

  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes}
      {...buttonProps}
    >
      {loading && <Spinner size={size <= 40 ? 12 : 14} />}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
}
