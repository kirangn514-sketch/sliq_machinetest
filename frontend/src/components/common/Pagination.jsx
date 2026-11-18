export default function Pagination({ pagination, onPageChange }) {
  if (!pagination) return null;
  const { page, totalPages, total, limit } = pagination;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <div className="pagination">
      <span className="muted">
        {from}–{to} of {total}
      </span>
      <div className="pagination-buttons">
        <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          ‹ Prev
        </button>
        <span className="page-indicator">Page {page} / {totalPages}</span>
        <button type="button" className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next ›
        </button>
      </div>
    </div>
  );
}
