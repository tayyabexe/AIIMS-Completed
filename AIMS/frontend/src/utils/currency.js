// The portal's currency, in one place.
//
// AIMS is a Pakistani university system: every monetary column in aims_db
// (fee_structures.amount, student_fees.total_payable, challans.total_amount,
// receipts.amount_paid, payments.amount_paid) is Pakistani Rupees, and the API
// says so explicitly — money-bearing responses carry a `currency` object put
// there by backend/src/middlewares/currency.middleware.js.
//
// Screens used to print `₹` from a local template string, and the compact
// forms used the Indian `L` (lakh) and `Cr` (crore) suffixes. Both are wrong
// for this product. Everything currency-shaped now goes through this module so
// there is exactly one place a symbol can come from.
//
// The backend's shape is mirrored here rather than imported, because the very
// first paint of a screen happens before any response has arrived; `applyServerCurrency`
// lets a response correct it if the API is ever reconfigured.

export const PKR = {
  code: 'PKR',
  symbol: 'Rs.',
  name: 'Pakistani Rupee',
  locale: 'en-PK',
  decimalDigits: 2,
};

let active = { ...PKR };

/**
 * Adopts the currency an API response declared. Safe to call with any body:
 * a response without a `currency` block leaves the current setting alone.
 */
export const applyServerCurrency = (body) => {
  const c = body && body.currency;
  if (!c || !c.symbol || !c.code) return active;

  active = {
    code: c.code,
    symbol: c.symbol,
    name: c.name || c.code,
    locale: c.locale || PKR.locale,
    decimalDigits: Number.isFinite(c.decimal_digits) ? c.decimal_digits : PKR.decimalDigits,
  };
  return active;
};

export const currency = () => active;

/** Just the symbol — for column headings such as "Amount (Rs.)". */
export const currencySymbol = () => active.symbol;

const toNumber = (value) => {
  const n = typeof value === 'string' ? Number(value.replace(/[^0-9.-]/g, '')) : Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * "Rs. 88,000" — the default for any amount shown in a table, receipt or
 * detail row. Whole rupees unless `decimals` is asked for, because fee amounts
 * in this database are whole numbers and ".00" on every row is noise.
 *
 * A null/undefined/unparsable amount renders as an em dash rather than
 * "Rs. NaN", so a missing figure reads as missing.
 */
export function formatMoney(value, { decimals = 0, fallback = '—' } = {}) {
  const n = toNumber(value);
  if (n === null) return fallback;

  return `${active.symbol} ${n.toLocaleString(active.locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * "Rs. 88K" / "Rs. 2.4M" — for stat tiles and chart axes where the full number
 * would not fit.
 *
 * Deliberately K/M/B and not the lakh/crore suffixes the screens used before:
 * those belong to the Indian numbering system this portal was mistakenly
 * carrying over.
 */
export function formatMoneyCompact(value, { fallback = '—' } = {}) {
  const n = toNumber(value);
  if (n === null) return fallback;

  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';

  const trim = (x) => {
    const s = x.toFixed(1);
    return s.endsWith('.0') ? s.slice(0, -2) : s;
  };

  if (abs >= 1e9) return `${active.symbol} ${sign}${trim(abs / 1e9)}B`;
  if (abs >= 1e6) return `${active.symbol} ${sign}${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${active.symbol} ${sign}${trim(abs / 1e3)}K`;

  return `${active.symbol} ${sign}${Math.round(abs).toLocaleString(active.locale)}`;
}

/** The compact form without the symbol, for axis ticks that carry their own. */
export function compactAmount(value) {
  const formatted = formatMoneyCompact(value, { fallback: '' });
  return formatted ? formatted.replace(`${active.symbol} `, '') : '';
}
