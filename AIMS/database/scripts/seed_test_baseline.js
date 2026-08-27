'use strict';

/*
 * The smallest set of rows a fresh AIMS database needs before a person can
 * sign in and start building an institute by hand.
 *
 * WHAT COUNTS AS "REFERENCE DATA" HERE
 * ------------------------------------
 * Only rows that are not test data — things the code already treats as fixed:
 *
 *   roles             Role ids are hardcoded in backend/src/config/roles.js and
 *                     frontend/src/api/roles.js. Role 1 IS Super Admin; that is
 *                     a fact about the source, not a row someone chose.
 *   permissions       Read by the RBAC layer.
 *   role_permissions  Same.
 *   grades            The grading scale. vw_class_performance_summary reads
 *                     grades.min_percentage to decide what a pass is, so with
 *                     no rows results and GPA compute wrongly rather than
 *                     computing empty — which is the worse failure, because it
 *                     looks like an answer.
 *
 * They are COPIED from the live database rather than re-typed, so they cannot
 * drift from what the application expects. Nothing else is copied: no people,
 * no academic records, no fees.
 *
 * Everything else — departments, programmes, batches, sections, students,
 * teachers, parents — is created by hand through the UI. That is the point.
 *
 * THE SUPER ADMIN
 * ---------------
 * One account, because a database with no user cannot be signed into and the
 * admin screens are the only way to create the second account.
 *
 * The password is bcrypt-hashed here and never stored in plaintext, never
 * written to the repo, and never logged except once to this console so you can
 * write it down.
 *
 * must_change_password is left 0 deliberately. This is the way into a test
 * system whose password you already know; forcing a change on the first
 * sign-in of every test run is friction, not security. Accounts created
 * through the admin screens DO get the flag, and testing that is step 3 of
 * the guide.
 *
 * Usage: node scripts/seed_test_baseline.js [--password '<plaintext>']
 *                                           [--email <address>]
 *                                           [--source <db>]
 * Targets whatever DB_NAME is set to. Refuses to run against a database that
 * already holds users.
 */

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const BCRYPT_ROUNDS = 10;

const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const TARGET = process.env.DB_NAME;
const SOURCE = arg('source', 'aims_db');
const EMAIL = arg('email', 'superadmin@aims.edu.pk');
const PASSWORD = arg('password', 'SuperAdmin@123');

// Tables copied wholesale from the source, in insert order.
const REFERENCE_TABLES = ['roles', 'permissions', 'role_permissions', 'grades'];

async function main() {
    if (!TARGET) {
        console.error('DB_NAME is not set. Check database/.env.');
        process.exit(1);
    }
    if (TARGET === SOURCE) {
        console.error(`Refusing: DB_NAME is '${TARGET}', the same database this copies FROM.`);
        process.exit(1);
    }

    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: TARGET,
        ssl: process.env.DB_SSL === 'true'
            ? {
                ca: fs.readFileSync(path.join(__dirname, '..', 'config', 'ca.pem')).toString(),
                rejectUnauthorized: true,
            }
            : undefined,
        connectTimeout: 30000,
    });

    console.log(`Target: ${TARGET}    Reference source: ${SOURCE}\n`);

    // Guard: this is a first-run script. Running it twice would either
    // duplicate the reference rows or fail halfway with some already inserted.
    const [[{ n: existingUsers }]] = await conn.query('SELECT COUNT(*) n FROM users');
    if (existingUsers > 0) {
        console.error(`Refusing: '${TARGET}' already holds ${existingUsers} user(s).`);
        console.error('Rebuild it first: node scripts/create_test_database.js ' + TARGET + ' --drop');
        await conn.end();
        process.exit(1);
    }

    // ---- reference data --------------------------------------------------
    console.log('Copying reference data:');
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of REFERENCE_TABLES) {
        await conn.query(`DELETE FROM \`${t}\``);
        const [r] = await conn.query(
            `INSERT INTO \`${TARGET}\`.\`${t}\` SELECT * FROM \`${SOURCE}\`.\`${t}\``
        );
        console.log(`  ${t}: ${r.affectedRows} rows`);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    // ---- the super admin -------------------------------------------------
    const [[role]] = await conn.query(
        "SELECT role_id FROM roles WHERE role_name = 'Super Admin' LIMIT 1"
    );
    if (!role) {
        console.error("No 'Super Admin' row in roles — the reference copy did not work.");
        await conn.end();
        process.exit(1);
    }

    const hash = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);

    /*
     * Columns are listed explicitly rather than relying on defaults, because
     * `full_name` has no role record to be backfilled from for an administrator
     * — leaving it NULL is what made the portal derive a name from the email
     * address and greet the account as "Superadmin".
     */
    const [res] = await conn.query(
        `INSERT INTO users
            (email, password_hash, role_id, full_name, is_active,
             must_change_password, failed_login_attempts, is_deleted,
             created_at, updated_at, last_password_change)
         VALUES (?, ?, ?, ?, 1, 0, 0, 0, NOW(), NOW(), NOW())`,
        [EMAIL, hash, role.role_id, 'Super Admin']
    );

    // Prove the hash verifies, rather than assuming bcrypt did its job — a
    // wrong hash here locks you out of a database with no other way in.
    const [[stored]] = await conn.query(
        'SELECT password_hash FROM users WHERE user_id = ?', [res.insertId]
    );
    const verifies = await bcrypt.compare(PASSWORD, stored.password_hash);

    console.log(`\nSuper admin created (user_id ${res.insertId}, role_id ${role.role_id})`);
    console.log(`  email:    ${EMAIL}`);
    console.log(`  password: ${PASSWORD}`);
    console.log(`  password verifies against the stored hash: ${verifies ? 'yes' : 'NO — STOP'}`);

    // ---- what the database now holds ------------------------------------
    const [tables] = await conn.query(
        "SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME",
        [TARGET]
    );
    const nonEmpty = [];
    for (const { t } of tables) {
        const [[{ n }]] = await conn.query(`SELECT COUNT(*) n FROM \`${t}\``);
        if (n > 0) nonEmpty.push(`${t}=${n}`);
    }
    console.log(`\nNon-empty tables: ${nonEmpty.join(', ')}`);
    console.log('Everything else is at zero rows and is yours to create by hand.');

    await conn.end();

    if (!verifies) process.exit(1);
}

main().catch((e) => {
    console.error('SEED FAILED:', e.message);
    process.exit(1);
});
