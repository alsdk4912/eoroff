/** 로그인 전용 — 투명 배경 SVG (스크린샷·JPEG 사용 안 함) */
export default function EoroffLoginLogo({ className = "login-hero__logo" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 200 220"
      width="120"
      height="132"
      role="img"
      aria-label="eoroff"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="eoroffWordLogin" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#1e3a6e" />
          <stop offset="45%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#4ade80" />
        </linearGradient>
      </defs>
      <rect x="24" y="0" width="152" height="152" rx="34" fill="#fff" />
      <rect x="24" y="0" width="152" height="152" rx="34" fill="none" stroke="#e2e8f0" strokeWidth="1" />
      <rect x="52" y="28" width="96" height="22" rx="4" fill="#5b9bd5" />
      <circle cx="62" cy="24" r="4" fill="#94a3b8" />
      <circle cx="138" cy="24" r="4" fill="#94a3b8" />
      <rect x="52" y="50" width="96" height="72" rx="2" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1.5" />
      <path fill="#ef4444" d="M68 62h14v28H68zm-5 5h24v6H63z" />
      <path
        fill="none"
        stroke="#22c55e"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M98 78l8 8 14-16"
      />
      <circle cx="132" cy="108" r="22" fill="#fff" stroke="#5b9bd5" strokeWidth="3" />
      <circle cx="132" cy="108" r="2" fill="#1e3a6e" />
      <path stroke="#1e3a6e" strokeWidth="2.5" strokeLinecap="round" d="M132 108V96M132 108l8 6" />
      <text
        x="100"
        y="198"
        textAnchor="middle"
        fontFamily="system-ui,-apple-system,'Segoe UI',sans-serif"
        fontSize="36"
        fontWeight="700"
        fill="url(#eoroffWordLogin)"
      >
        eoroff
      </text>
    </svg>
  );
}
