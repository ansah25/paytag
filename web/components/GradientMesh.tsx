'use client';

interface Props {
  className?: string;
  intensity?: 'soft' | 'bold';
}

/**
 * Atmospheric gradient mesh — five blurred color blobs that gently drift.
 * Render inside a `relative overflow-hidden` parent.
 */
export function GradientMesh({ className = '', intensity = 'soft' }: Props) {
  const opacity = intensity === 'bold' ? 0.85 : 0.55;
  return (
    <div
      aria-hidden
      className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}
    >
      <div
        className="mesh-blob animate-mesh-drift"
        style={{
          width: '60vw',
          height: '60vw',
          left: '-10%',
          top: '-25%',
          background: '#5469D4',
          opacity,
        }}
      />
      <div
        className="mesh-blob animate-mesh-drift-2"
        style={{
          width: '50vw',
          height: '50vw',
          right: '-15%',
          top: '-15%',
          background: '#00D4FF',
          opacity: opacity * 0.85,
        }}
      />
      <div
        className="mesh-blob animate-mesh-drift"
        style={{
          width: '55vw',
          height: '55vw',
          right: '-5%',
          bottom: '-30%',
          background: '#FF5A6E',
          opacity: opacity * 0.7,
        }}
      />
      <div
        className="mesh-blob animate-mesh-drift-2"
        style={{
          width: '45vw',
          height: '45vw',
          left: '-5%',
          bottom: '-20%',
          background: '#7E5CFF',
          opacity: opacity * 0.85,
        }}
      />
      <div
        className="mesh-blob animate-mesh-drift"
        style={{
          width: '40vw',
          height: '40vw',
          left: '40%',
          top: '20%',
          background: '#FFB547',
          opacity: opacity * 0.55,
        }}
      />
      {/* Soft white veil so text stays readable */}
      <div className="absolute inset-0 bg-white/55 backdrop-blur-[2px]" />
    </div>
  );
}
