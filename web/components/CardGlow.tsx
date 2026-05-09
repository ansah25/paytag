// Corner glow blob for cards. Drop this inside a `relative overflow-hidden`
// card and wrap the card's content in `<div className="relative">` so the
// content paints above the blob. Mirrors the "Why paytag" pattern used on
// the landing page so every card on every route has the same family resemblance.
interface Props {
  color?: string;
  opacity?: number;
  /** Which corner the blob lives in. */
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  /** Tailwind size token; default 11rem (`w-44`). Pass 'lg' for 14rem. */
  size?: 'md' | 'lg';
}

const POSITIONS: Record<NonNullable<Props['position']>, string> = {
  'top-right': '-right-12 -top-12',
  'top-left': '-left-12 -top-12',
  'bottom-right': '-right-12 -bottom-12',
  'bottom-left': '-left-12 -bottom-12',
};

const SIZES: Record<NonNullable<Props['size']>, string> = {
  md: 'w-44 h-44',
  lg: 'w-56 h-56',
};

export function CardGlow({
  color = '#5469D4',
  opacity = 0.18,
  position = 'top-right',
  size = 'md',
}: Props) {
  return (
    <div
      aria-hidden
      className={`absolute ${POSITIONS[position]} ${SIZES[size]} rounded-full blur-2xl pointer-events-none`}
      style={{ background: color, opacity }}
    />
  );
}
