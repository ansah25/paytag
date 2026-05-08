import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// iOS home-screen icon. iOS applies its own squircle mask, so we render a
// solid square (no borderRadius) and let the OS shape it — adding rounded
// corners here would double-mask and look subtly off.
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
          background:
            'linear-gradient(135deg, #5469D4 0%, #7E5CFF 50%, #FF5A6E 100%)',
          color: 'white',
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
