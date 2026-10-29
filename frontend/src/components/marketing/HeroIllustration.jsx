const transactions = [
  { label: "Salary deposit", meta: "Today · 09:12", amount: "+ 3,200.00", tone: "#15803D" },
  { label: "Wallet transfer", meta: "Yesterday · 18:40", amount: "− 250.00", tone: "#102B46" },
  { label: "Card payment", meta: "Mon · 11:05", amount: "− 64.20", tone: "#102B46" },
];

export default function HeroIllustration() {
  return (
    <svg
      viewBox="0 0 560 480"
      className="h-auto w-full"
      role="img"
      aria-labelledby="hero-illustration-title hero-illustration-desc"
      fill="none"
    >
      <title id="hero-illustration-title">Meridian account dashboard preview</title>
      <desc id="hero-illustration-desc">
        An illustrated banking dashboard showing a wallet balance, spending chart,
        recent transactions and a verified identity card.
      </desc>

      <rect x="18" y="18" width="524" height="444" rx="28" fill="#EEF5FF" />
      <circle cx="486" cy="72" r="46" fill="#D9E8FF" />
      <circle cx="74" cy="420" r="28" fill="#D9E8FF" />

      <g>
        <rect
          x="46"
          y="52"
          width="392"
          height="336"
          rx="20"
          fill="#FFFFFF"
          stroke="#E4E9F2"
          strokeWidth="1.5"
        />

        <rect x="46" y="52" width="392" height="52" rx="20" fill="#102B46" />
        <rect x="46" y="84" width="392" height="20" fill="#102B46" />
        <circle cx="70" cy="78" r="4" fill="#8FB4FF" opacity="0.9" />
        <circle cx="84" cy="78" r="4" fill="#8FB4FF" opacity="0.55" />
        <circle cx="98" cy="78" r="4" fill="#8FB4FF" opacity="0.3" />
        <text x="120" y="83" fill="#FFFFFF" fontSize="13" fontWeight="700" letterSpacing="0.4">
          Meridian
        </text>
        <text x="185" y="83" fill="#8FB4FF" fontSize="9" fontWeight="700" letterSpacing="2">
          BANK
        </text>
        <circle cx="406" cy="78" r="11" fill="#FFFFFF" opacity="0.12" />
        <circle cx="403" cy="75" r="4" stroke="#FFFFFF" strokeWidth="1.5" />
        <path d="M397 87c1.6-4 4.6-6 6-6s4.4 2 6 6" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />

        <text x="70" y="136" fill="#667085" fontSize="10.5" fontWeight="600" letterSpacing="1.6">
          TOTAL BALANCE
        </text>
        <text x="68" y="168" fill="#102B46" fontSize="30" fontWeight="800" letterSpacing="-0.8">
          24,860.00
        </text>
        <text x="70" y="190" fill="#667085" fontSize="10.5" fontWeight="600">
          USD · Available
        </text>

        <rect x="70" y="204" width="72" height="22" rx="11" fill="#E8F6EE" />
        <path d="M80 213l4 4 7-7" stroke="#15803D" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <text x="95" y="219" fill="#15803D" fontSize="9.5" fontWeight="700">
          +2.4% month
        </text>

        <rect x="258" y="124" width="158" height="102" rx="14" fill="#F3F6FA" />
        <text x="272" y="146" fill="#667085" fontSize="9.5" fontWeight="700" letterSpacing="1.2">
          CASH FLOW
        </text>
        {[18, 30, 24, 40, 34, 52, 44].map((height, index) => (
          <rect
            key={index}
            x={272 + index * 18}
            y={206 - height}
            width="10"
            height={height}
            rx="3"
            fill={index === 5 ? "#1769E0" : "#D9E8FF"}
          />
        ))}
        <line x1="272" y1="208" x2="402" y2="208" stroke="#E4E9F2" strokeWidth="1" />

        <line x1="70" y1="246" x2="414" y2="246" stroke="#EEF1F6" strokeWidth="1" />

        <text x="70" y="270" fill="#102B46" fontSize="11" fontWeight="700">
          Recent activity
        </text>
        <text x="372" y="270" fill="#1769E0" fontSize="9.5" fontWeight="700">
          View all
        </text>

        {transactions.map((item, index) => {
          const y = 292 + index * 32;
          return (
            <g key={item.label}>
              <rect x="70" y={y - 14} width="24" height="24" rx="8" fill="#EEF5FF" />
              <path
                d={index === 0 ? `M78 ${y}h8M82 ${y - 4}v8` : `M78 ${y}h8`}
                stroke="#1769E0"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <text x="104" y={y - 2} fill="#182230" fontSize="10.5" fontWeight="700">
                {item.label}
              </text>
              <text x="104" y={y + 10} fill="#98A2B3" fontSize="8.5" fontWeight="500">
                {item.meta}
              </text>
              <text x="414" y={y - 2} fill={item.tone} fontSize="10.5" fontWeight="700" textAnchor="end">
                {item.amount}
              </text>
            </g>
          );
        })}
      </g>

      <g>
        <rect
          x="356"
          y="318"
          width="172"
          height="76"
          rx="16"
          fill="#FFFFFF"
          stroke="#E4E9F2"
          strokeWidth="1.5"
        />
        <circle cx="384" cy="350" r="15" fill="#E8F6EE" />
        <path d="M377 350l4.5 4.5 9-9" stroke="#15803D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <text x="408" y="345" fill="#102B46" fontSize="10.5" fontWeight="800">
          Identity verified
        </text>
        <text x="408" y="360" fill="#667085" fontSize="8.5" fontWeight="500">
          KYC review approved
        </text>
        <rect x="408" y="369" width="56" height="6" rx="3" fill="#EEF1F6" />
        <rect x="408" y="369" width="56" height="6" rx="3" fill="#15803D" opacity="0.75" />
      </g>

      <g>
        <rect
          x="372"
          y="86"
          width="156"
          height="54"
          rx="14"
          fill="#FFFFFF"
          stroke="#E4E9F2"
          strokeWidth="1.5"
        />
        <rect x="386" y="100" width="26" height="26" rx="9" fill="#102B46" />
        <path
          d="M399 106l6 3v5c0 3.4-2.4 5.6-6 6.6-3.6-1-6-3.2-6-6.6v-5l6-3z"
          stroke="#8FB4FF"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <text x="422" y="112" fill="#102B46" fontSize="10" fontWeight="800">
          Protected session
        </text>
        <text x="422" y="126" fill="#667085" fontSize="8.5" fontWeight="500">
          Refresh token rotated
        </text>
      </g>

      <g>
        <rect x="46" y="404" width="150" height="40" rx="12" fill="#102B46" />
        <circle cx="68" cy="424" r="9" fill="#1769E0" />
        <path d="M64 424h8M68 420v8" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" />
        <text x="84" y="421" fill="#FFFFFF" fontSize="9" fontWeight="700">
          Wallet ready
        </text>
        <text x="84" y="433" fill="#8FB4FF" fontSize="7.5" fontWeight="600">
          Ledger-backed balance
        </text>
      </g>
    </svg>
  );
}
