import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// iOS home-screen icon. iOS applies its own squircle mask, so we render a
// solid square (no borderRadius) and let the OS shape it — adding rounded
// corners here would double-mask and look subtly off. Colors are the
// dark-theme --accent / --on-accent (PNG output can't read CSS variables).
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#7DD3C8',
          color: '#101012',
          fontSize: 124,
          fontWeight: 700,
          fontFamily: 'sans-serif',
          lineHeight: 1,
        }}
      >
        @
      </div>
    ),
    { ...size },
  );
}
