// Page-wide atmospheric mesh. Rendered once in the root layout so every route
// shares the exact same ambient color — no per-section variation. The white
// veil is heavy on purpose: the mesh should read as a hint of brand color,
// not as background art that competes with content.
//
// `position: fixed` keeps it pinned to the viewport while the page scrolls,
// so the atmosphere stays consistent through every section. `z-index: -10`
// keeps it underneath all content but above the body's flat white fill.
export function AmbientBackdrop() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: -10 }}
    >
      <div
        className="mesh-blob animate-mesh-drift"
        style={{
          width: '60vw',
          height: '60vw',
          left: '-15%',
          top: '-25%',
          background: '#5469D4',
          opacity: 0.32,
        }}
      />
      <div
        className="mesh-blob animate-mesh-drift-2"
        style={{
          width: '50vw',
          height: '50vw',
          right: '-15%',
          top: '-10%',
          background: '#7E5CFF',
          opacity: 0.26,
        }}
      />
      <div
        className="mesh-blob animate-mesh-drift"
        style={{
          width: '55vw',
          height: '55vw',
          right: '-10%',
          bottom: '-30%',
          background: '#FF5A6E',
          opacity: 0.22,
        }}
      />
      <div
        className="mesh-blob animate-mesh-drift-2"
        style={{
          width: '45vw',
          height: '45vw',
          left: '-10%',
          bottom: '-25%',
          background: '#00D4FF',
          opacity: 0.22,
        }}
      />
      {/* Lighter veil — color should show through clearly without overpowering. */}
      <div className="absolute inset-0 bg-white/68" />
    </div>
  );
}
