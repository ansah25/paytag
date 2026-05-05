interface Props {
  chain: string;
  size?: number;
}

const STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  ethereum: { bg: 'linear-gradient(135deg, #627EEA 0%, #5469D4 100%)', fg: '#fff', label: 'E' },
  solana: { bg: 'linear-gradient(135deg, #9945FF 0%, #14F195 100%)', fg: '#fff', label: 'S' },
  bitcoin: { bg: 'linear-gradient(135deg, #F7931A 0%, #FFB547 100%)', fg: '#fff', label: '₿' },
};

export function ChainGlyph({ chain, size = 28 }: Props) {
  const s = STYLES[chain] ?? { bg: '#E3E8EE', fg: '#0a2540', label: chain.charAt(0).toUpperCase() };
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-bold text-xs"
      style={{
        width: size,
        height: size,
        background: s.bg,
        color: s.fg,
        fontSize: size * 0.42,
      }}
      aria-label={chain}
    >
      {s.label}
    </span>
  );
}
