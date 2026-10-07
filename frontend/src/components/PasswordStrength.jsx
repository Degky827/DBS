import { scorePassword } from "../utils/passwordScore";

const LEVELS = [
  { label: "Too weak", bars: 1, color: "bg-red-500" },
  { label: "Weak", bars: 2, color: "bg-orange-500" },
  { label: "Fair", bars: 3, color: "bg-gold-500" },
  { label: "Strong", bars: 4, color: "bg-emerald-500" },
];


export default function PasswordStrength({ password }) {
  const score = scorePassword(password);
  const level = score < 0 ? null : LEVELS[score];

  return (
    <div className="mt-2">
      <div className="flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              level && i <= level.bars - 1 ? level.color : "bg-ink-200"
            }`}
          />
        ))}
      </div>
      <p className="mt-1.5 text-xs font-medium text-ink-400">
        {level
          ? `${level.label} — use 8+ characters with uppercase, lowercase and a number`
          : "Use 8+ characters with uppercase, lowercase and a number"}
      </p>
    </div>
  );
}
