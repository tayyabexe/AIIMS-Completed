import { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Inbox } from 'lucide-react';
import Pagination from './Pagination.jsx';
import './DataTable.css';

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100];

/**
 * Sortable, searchable, paginated data table.
 * columns: [{ key, label, sortable, align, render, width, searchable }]
 * rows: array of plain objects.
 */
export default function DataTable({
  columns,
  rows,
  rowKey = 'id', // string column name, or function (row) => string
  searchable = true,
  searchPlaceholder = 'Search…',
  toolbar,          // ReactNode rendered above the table
  pageSizes = DEFAULT_PAGE_SIZES,
  defaultPageSize = 10,
  loading = false,
  emptyMessage = 'No records found',
  onRowClick,
}) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  useEffect(() => {
    setPage(1);
  }, [query, sortKey, sortDir, pageSize, rows.length]);

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const filtered = useMemo(() => {
    let out = rows;
    if (searchable && query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter((row) =>
        columns.some((c) => {
          if (c.searchable === false) return false;
          const v = row[c.key];
          return v !== null && v !== undefined && String(v).toLowerCase().includes(q);
        })
      );
    }
    if (sortKey) {
      out = [...out].sort((a, b) => {
        const va = a[sortKey];
        const vb = b[sortKey];
        const cmp =
          typeof va === 'number' && typeof vb === 'number'
            ? va - vb
            : String(va ?? '').localeCompare(String(vb ?? ''));
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, query, sortKey, sortDir, searchable, columns]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="data-table-wrap">
      {(searchable || toolbar) && (
        <div className="data-table-toolbar">
          <div className="data-table-toolbar-left">
            {searchable && (
              <div className="data-table-search">
                <Search size={15} />
                <input
                  type="text"
                  placeholder={searchPlaceholder}
                  value={query ?? ''}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            )}
            {toolbar}
          </div>
        </div>
      )}

      <div className="data-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  className={c.align === 'right' ? 'align-right' : c.align === 'center' ? 'align-center' : ''}
                >
                  {c.sortable !== false ? (
                    <button className="data-table-th-btn" onClick={() => toggleSort(c.key)}>
                      {c.label}
                      {sortKey === c.key ? (
                        sortDir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />
                      ) : (
                        <ArrowUpDown size={13} className="th-muted" />
                      )}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length}>
                  <div className="table-skeleton">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div className="skeleton-row" key={i}>
                        <span />
                        <span />
                        <span />
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            ) : pageRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <div className="table-empty">
                    <Inbox size={26} />
                    <span>{emptyMessage}</span>
                  </div>
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr
                  key={typeof rowKey === 'function' ? rowKey(row) : row[rowKey] ?? JSON.stringify(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={onRowClick ? 'row-clickable' : ''}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={c.align === 'right' ? 'align-right' : c.align === 'center' ? 'align-center' : ''}
                    >
                      {c.render ? c.render(row) : row[c.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="data-table-footer">
        <Pagination
          currentPage={safePage}
          totalItems={filtered.length}
          itemsPerPage={pageSize}
          onPageChange={setPage}
          pageSizes={pageSizes}
          onPageSizeChange={setPageSize}
        />
      </div>
    </div>
  );
}
