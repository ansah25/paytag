interface Props {
  username: string;
  size?: number;
}

const PALETTES: Array<[string, string, string]> = [
  ['#5469D4', '#7E5CFF', '#FF5A6E'],
  ['#00D4FF', '#5469D4', '#7E5CFF'],
  ['#FFB547', '#FF5A6E', '#7E5CFF'],
  ['#13BC8C', '#00D4FF', '#5469D4'],
  ['#FF5A6E', '#FFB547', '#7E5CFF'],
];

const pick = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000;
  return PALETTES[h % PALETTES.length];
};

export function Avatar({ username, size = 48 }: Props) {
  const [a, b, c] = pick(username);
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-bold uppercase shrink-0"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${a} 0%, ${b} 50%, ${c} 100%)`,
        fontSize: size * 0.42,
        letterSpacing: '-0.01em',
        boxShadow: '0 6px 16px -4px rgba(15,42,77,0.25)',
      }}
    >
      {username.charAt(0)}
    </div>
  );
}
