import { ChevronLeft, ChevronRight } from 'lucide-react';
import './Pagination.css';

// Builds a compact page list like: 1 2 3 ... 8
function buildPageList(current, total) {
  const pages = [];
  const add = (p) => pages.push(p);

  if (total <= 7) {
    for (let i = 1; i <= total; i++) add(i);
    return pages;
  }

  add(1);
  if (current > 3) add('...');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) add(i);
  if (current < total - 2) add('...');
  add(total);
  return pages;
}

export default function Pagination({
  currentPage,
  totalItems,
  itemsPerPage,
  onPageChange,
  pageSizes,
  onPageSizeChange,
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  if (totalItems === 0) return null;

  const start = (currentPage - 1) * itemsPerPage + 1;
  const end = Math.min(totalItems, currentPage * itemsPerPage);
  const pages = buildPageList(currentPage, totalPages);

  return (
    <div className="pagination">
      <div className="pagination-left">
        {pageSizes && onPageSizeChange && (
          <label className="page-size-label">
            Rows per page
            <select
              value={itemsPerPage}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
            >
              {pageSizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="pagination-info">
          Showing {start}–{end} of {totalItems}
        </span>
      </div>
      <div className="pagination-controls">
        <button
          className="page-btn"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={15} />
        </button>

        {pages.map((p, i) =>
          p === '...' ? (
            <span className="page-ellipsis" key={`e-${i}`}>…</span>
          ) : (
            <button
              key={p}
              className={`page-btn${p === currentPage ? ' active' : ''}`}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          )
        )}

        <button
          className="page-btn"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          aria-label="Next page"
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
