// Tags money-bearing responses with the currency their numbers are in.
//
// AIMS is a Pakistani university system and every amount in the database is
// PKR, but no response said so. That left each portal to print a symbol from a
// local constant, which is exactly how a screen ends up showing the wrong one.
//
// This is applied per router in app.js rather than globally, so it is visible
// at the mount point which endpoints return money. It only adds a field:
// `success`, `data`, `count` and every existing key are untouched, so an
// existing client that ignores `currency` behaves exactly as before.

const { CURRENCY } = require("../config/currency");

const attachCurrency = (req, res, next) => {

    const originalJson = res.json.bind(res);

    res.json = (body) => {

        // Error bodies carry no amounts, so they are left alone. An array body
        // (no endpoint here returns one today) has nowhere to put the field
        // without changing its shape, so it is left alone too.
        if (
            body
            && typeof body === "object"
            && !Array.isArray(body)
            && body.success !== false
            && body.currency === undefined
        ) {
            body.currency = CURRENCY;
        }

        return originalJson(body);
    };

    next();
};

module.exports = attachCurrency;
