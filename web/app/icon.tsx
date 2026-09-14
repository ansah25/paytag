import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

// Browser-tab favicon: the header's accent "@" mark. Rendered to PNG, so CSS
// variables aren't available — these are the dark-theme --accent / --on-accent.
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
          background: '#7DD3C8',
          borderRadius: '50%',
          color: '#101012',
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
