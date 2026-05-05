'use client';

interface Props {
  tab?: string;
  status?: string;
}

/**
 * Stripe-style dark code card showing the @paytagdev/sdk usage + response.
 * Hand-tokenized so we can color it without a heavy syntax-highlighter dep.
 */
export function CodeCard({ tab = 'resolve.ts', status = '200 OK · 38 ms' }: Props) {
  return (
    <div className="code-card">
      <div className="code-card-header">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#FF5A6E]/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#FFB547]/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#13BC8C]/80" />
          <span className="ml-3 font-mono text-[11px] text-white/55 numeric">{tab}</span>
        </div>
        <span className="font-mono text-[11px] text-white/55 numeric">{status}</span>
      </div>
      <pre className="!m-0 whitespace-pre">
{`  `}<span className="tok-keyword">{`import`}</span>{` { `}<span className="tok-prop">resolve</span>{` } `}<span className="tok-keyword">{`from`}</span>{` `}<span className="tok-string">{`"@paytagdev/sdk"`}</span>{`;

  `}<span className="tok-keyword">const</span>{` `}<span className="tok-prop">user</span>{` = `}<span className="tok-keyword">await</span>{` `}<span className="tok-fn">resolve</span>{`(`}<span className="tok-string">{`"derrick"`}</span>{`);

  `}<span className="tok-comment">{`// {`}</span>{`
  `}<span className="tok-comment">{`//   username: "derrick",`}</span>{`
  `}<span className="tok-comment">{`//   addresses: {`}</span>{`
  `}<span className="tok-comment">{`//     ethereum: "0x4f3edf83…d8a3c2",`}</span>{`
  `}<span className="tok-comment">{`//     solana:   "4Nd1mYz7K8jM…",`}</span>{`
  `}<span className="tok-comment">{`//     bitcoin:  "bc1qw508d6q…"`}</span>{`
  `}<span className="tok-comment">{`//   }`}</span>{`
  `}<span className="tok-comment">{`// }`}</span>
      </pre>
    </div>
  );
}
