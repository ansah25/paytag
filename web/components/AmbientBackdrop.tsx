// Page-wide atmospheric backdrop. Rendered once in the root layout so every
// route shares the exact same ambient color — no per-section variation.
//
// The previous implementation used four absolutely-positioned divs with
// `filter: blur(80px)` and infinite animations — four GPU layers running a
// blur kernel at 60fps for the entire session. We now stack CSS radial
// gradients in a single layer. Radial gradients are inherently smooth (no
// blur kernel needed) and a single static layer composites for free. Same
// visual outcome, ~75% less paint cost — especially noticeable on mobile.
//
// Alpha values bake in what was previously two layers (colored blob × white
// veil). The body's own white background fills the transparent middle, so no
// wash is needed.
//
// `position: fixed` pins it to the viewport. `z-index: -10` puts it behind
// all content but above body's flat fill (body uses `isolation: isolate` so
// this negative z is scoped inside body's stacking context).
export function AmbientBackdrop() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 pointer-events-none"
      style={{
        zIndex: -10,
        backgroundImage: [
          'radial-gradient(60vw 60vw at -15% -25%, rgba(84,105,212,0.18), transparent 55%)',
          'radial-gradient(50vw 50vw at 115% -10%, rgba(126,92,255,0.15), transparent 55%)',
          'radial-gradient(55vw 55vw at 110% 130%, rgba(255,90,110,0.13), transparent 55%)',
          'radial-gradient(45vw 45vw at -10% 125%, rgba(0,212,255,0.13), transparent 55%)',
        ].join(', '),
      }}
    />
  );
}
