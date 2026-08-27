import { RotateCcw } from 'lucide-react';
import './FilterBar.css';

/** Advanced filter bar: renders a row of filter fields + optional reset. */
export default function FilterBar({ children, onReset, resetActive, resetLabel = 'Reset Filters' }) {
  return (
    <div className="filter-bar">
      <div className="filter-bar-fields">{children}</div>
      {onReset && (
        <button
          type="button"
          className="filter-reset-btn"
          disabled={!resetActive}
          onClick={onReset}
        >
          <RotateCcw size={14} />
          {resetLabel}
        </button>
      )}
    </div>
  );
}

export function FilterField({ label, children }) {
  return (
    <div className="filter-field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function FilterSelect({ label, value, onChange, options, allLabel }) {
  return (
    <FilterField label={label}>
      {/* `?? ''` keeps this a controlled select even before the caller's
          state has a value; value={null} makes React treat it as
          uncontrolled and throw when it is next interacted with. */}
      <select value={value ?? ''} onChange={onChange}>
        {allLabel && <option value="all">{allLabel}</option>}
        {options.map((o) => (
          <option key={typeof o === 'object' ? o.value : o} value={typeof o === 'object' ? o.value : o}>
            {typeof o === 'object' ? o.label : o}
          </option>
        ))}
      </select>
    </FilterField>
  );
}

export function FilterInput({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <FilterField label={label}>
      <input type={type} value={value} placeholder={placeholder} onChange={onChange} />
    </FilterField>
  );
}

export function FilterDate({ label, value, onChange }) {
  return (
    <FilterField label={label}>
      <input type="date" value={value} onChange={onChange} />
    </FilterField>
  );
}
