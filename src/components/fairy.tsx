// The Fada dos shots (Fernanda's character), drawn in the Kick colours.
export function Fairy({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="shrink-0">
      <ellipse cx="22" cy="28" rx="13" ry="18" fill="#e9b9ae" opacity=".7" transform="rotate(-25 22 28)" />
      <ellipse cx="42" cy="28" rx="13" ry="18" fill="#e9b9ae" opacity=".7" transform="rotate(25 42 28)" />
      <path d="M32 30c-7 0-10 8-11 24h22c-1-16-4-24-11-24z" fill="#b7473b" />
      <circle cx="32" cy="22" r="9" fill="#f1c9a6" />
      <path d="M23 21c0-8 5-12 9-12s10 3 10 12c-3-4-6-5-10-5s-6 2-9 5z" fill="#3a1d12" />
      <circle cx="29" cy="23" r="1.2" fill="#202425" /><circle cx="35" cy="23" r="1.2" fill="#202425" />
      <path d="M29.5 26.5q2.5 2 5 0" stroke="#202425" strokeWidth="1.2" fill="none" />
      <path d="M44 36l9-11" stroke="#a87a12" strokeWidth="2" />
      <path d="M53 19l1.5 3.6 3.9.3-3 2.5.9 3.8-3.3-2-3.3 2 .9-3.8-3-2.5 3.9-.3z" fill="#e8c062" />
    </svg>
  );
}
