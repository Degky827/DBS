import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";

const STYLES = {
  success: { icon: CheckCircle2, className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  error: { icon: AlertCircle, className: "border-red-200 bg-red-50 text-red-700" },
  warning: { icon: TriangleAlert, className: "border-amber-200 bg-amber-50 text-amber-800" },
  info: { icon: Info, className: "border-navy-100 bg-navy-50 text-navy-700" },
};

export default function Alert({ tone = "info", children, className = "", dismissible, onDismiss }) {
  const reduceMotion = useReducedMotion();
  const { icon: Icon, className: toneClass } = STYLES[tone] || STYLES.info;

  return (
    <AnimatePresence>
      {children ? (
        <motion.div
          role={tone === "error" ? "alert" : "status"}
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-[13px] font-medium leading-relaxed ${toneClass} ${className}`}
          initial={reduceMotion ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          <Icon size={16} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">{children}</div>
          {dismissible && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss message"
              className="shrink-0 opacity-60 transition hover:opacity-100"
            >
              &times;
            </button>
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
