import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

// Browser-tab favicon. Mirrors the gradient @ logo used in SiteHeader and
// SiteFooter so the brand mark stays in sync — change the gradient stops in
// one place and tabs / iOS / footer all follow.
export default function Icon() {
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
          borderRadius: 7,
          color: 'white',
          fontSize: 22,
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
