import { useRef } from "react";

const LENGTH = 6;

export default function OtpInput({ value, onChange, onComplete }) {
  const refs = useRef([]);

  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] || "");

  const setDigit = (index, digit) => {
    const next = [...digits];
    next[index] = digit;
    const joined = next.join("").trim();
    onChange(joined);
    if (joined.length === LENGTH) onComplete?.(joined);
  };

  const handleChange = (index, raw) => {
    const digit = raw.replace(/\D/g, "").slice(-1);
    setDigit(index, digit);
    if (digit && index < LENGTH - 1) refs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index, e) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
    if (e.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus();
    if (e.key === "ArrowRight" && index < LENGTH - 1) refs.current[index + 1]?.focus();
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LENGTH);
    if (!pasted) return;
    onChange(pasted);
    if (pasted.length === LENGTH) onComplete?.(pasted);
    refs.current[Math.min(pasted.length, LENGTH - 1)]?.focus();
  };

  return (
    <div className="flex gap-2.5" onPaste={handlePaste}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={digit}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label={`Digit ${i + 1}`}
          className="num h-14 w-11 rounded-lg border border-ink-200 bg-white text-center text-xl font-bold text-navy-900 outline-none transition focus:border-navy-500 focus:ring-4 focus:ring-navy-500/10"
        />
      ))}
    </div>
  );
}
