interface Props {
  file?: string;
  status?: string;
  latency?: string;
}

/**
 * Static SDK usage sample for the landing page. Hand-tokenized (keywords in
 * ink2, strings in accent, comments in ink3) so no syntax highlighter ships.
 */
export function CodeCard({ file = 'resolve.ts', status = '200 OK', latency = '38 ms' }: Props) {
  return (
    <figure className="min-w-0 overflow-hidden rounded-inset-xl border border-line bg-bg">
      <figcaption className="flex justify-between gap-3 border-b border-line px-5 py-3 font-mono text-xs text-ink2">
        <span>{file}</span>
        <span>
          <span className="text-accent">{status}</span> · {latency}
        </span>
      </figcaption>
      {/* Focusable so keyboard users can scroll it on narrow screens. */}
      <pre tabIndex={0} className="overflow-x-auto p-[22px] font-mono text-[13.5px] leading-[1.7] text-ink">
        <code>
          <span className="text-ink2">import</span> {'{ resolve } '}
          <span className="text-ink2">from</span> <span className="text-accent">&quot;@paytagdev/sdk&quot;</span>;
          {'\n\n'}
          <span className="text-ink2">const</span> {'user = '}
          <span className="text-ink2">await</span> {'resolve('}
          <span className="text-accent">&quot;derrick&quot;</span>);
          {'\n\n'}
          <span className="text-ink3">
            {`// { username: "derrick",
//   addresses: {
//     ethereum: "0x4f3edf83…d8a3c2",
//     solana:   "4Nd1mYz7K8jM…",
//     bitcoin:  "bc1qw508d6q…" } }`}
          </span>
        </code>
      </pre>
    </figure>
  );
}
