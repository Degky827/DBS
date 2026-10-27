import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { Inbox } from "lucide-react";

export default function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  actionLabel,
  actionTo,
  onAction,
  className = "",
}) {
  const reduceMotion = useReducedMotion();

  const action =
    actionTo || onAction ? (
      actionTo ? (
        <Link to={actionTo} className="btn-primary mt-5">
          {actionLabel}
        </Link>
      ) : (
        <button type="button" onClick={onAction} className="btn-primary mt-5">
          {actionLabel}
        </button>
      )
    ) : null;

  return (
    <motion.div
      className={`card flex flex-col items-center border-dashed px-6 py-14 text-center ${className}`}
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-ink-100 text-ink-500">
        <Icon size={22} />
      </span>
      <h2 className="mt-4 text-base font-extrabold text-navy-900">{title}</h2>
      {description ? (
        <p className="mt-1.5 max-w-md text-sm leading-relaxed text-ink-500">{description}</p>
      ) : null}
      {action}
    </motion.div>
  );
}
