export default function OffsetPagination({ page, totalPages, onChange, busy }) {
  if (!Number.isFinite(totalPages) || totalPages <= 1) return null;

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-3 border-t border-ink-100 px-4 py-3"
    >
      <button
        type="button"
        className="btn-ghost !py-2 !text-[13px]"
        onClick={() => onChange(page - 1)}
        disabled={busy || page <= 1}
      >
        Previous
      </button>
      <p className="text-[12px] font-semibold text-muted">
        Page {page} of {totalPages}
      </p>
      <button
        type="button"
        className="btn-ghost !py-2 !text-[13px]"
        onClick={() => onChange(page + 1)}
        disabled={busy || page >= totalPages}
      >
        Next
      </button>
    </nav>
  );
}
