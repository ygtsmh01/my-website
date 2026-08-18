interface Props {
  seconds: number;
  total: number;
  size?: number;
}

export default function TimerRing({ seconds, total, size }: Props) {
  const s = size || 60;
  const r = s / 2 - 6;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, seconds / total));
  const dash = circumference * pct;
  const color = pct > 0.4 ? 'var(--green)' : pct > 0.15 ? 'var(--brass)' : 'var(--coral)';
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
      <circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke="var(--hairline-soft)" strokeWidth="5" />
      <circle
        cx={s / 2}
        cy={s / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeDasharray={`${dash} ${circumference}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${s / 2} ${s / 2})`}
        style={{ transition: 'stroke-dasharray .3s linear' }}
      />
      <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" fill="var(--paper)" fontFamily="var(--mono)" fontSize={s * 0.32}>
        {seconds}
      </text>
    </svg>
  );
}
