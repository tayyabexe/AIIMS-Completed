// The portal's currency, in one place.
//
// AIMS is a Pakistani university system, so every monetary value in the
// database - fee_structures.amount, student_fees.total_payable,
// challans.total_amount, receipts.amount_paid, payments.amount_paid,
// employees.basic_salary and payroll - is Pakistani Rupees.
//
// An audit of the repository for the Indian symbols (INR, the rupee sign, and
// the phrase "Indian Rupees") found no occurrence in any backend source file,
// so nothing had to be converted. What was missing is the other half: no
// response said which currency its numbers were in, which is what leaves each
// screen free to invent a symbol. Money-bearing responses now carry this
// object so every portal formats from the API rather than from a local
// constant.

const CURRENCY = {
    code: "PKR",
    symbol: "Rs.",
    name: "Pakistani Rupee",
    // en-PK renders "Rs 1,234.00"; the symbol above is the one the portals
    // should print, and this is the locale to group digits with.
    locale: "en-PK",
    decimal_digits: 2
};

// "Rs. 1,250.00". Used where the backend produces a human-readable string
// itself (receipts, challans, notification text) rather than a raw number.
const formatPKR = (amount) => {

    const value = Number(amount);

    if (!Number.isFinite(value)) return null;

    return `${CURRENCY.symbol} ${value.toLocaleString(CURRENCY.locale, {
        minimumFractionDigits: CURRENCY.decimal_digits,
        maximumFractionDigits: CURRENCY.decimal_digits
    })}`;
};

module.exports = {
    CURRENCY,
    formatPKR
};
