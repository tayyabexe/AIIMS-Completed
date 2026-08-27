'use strict';

/*
 * Builds an EMPTY database with the same structure as the live one, on the
 * same server, so a full manual test run has somewhere to write that is not
 * carrying 2,000 seeded students.
 *
 * It replays database/schema.sql then database/constraints.sql. Both are
 * generated from the live server by scripts/generate_schema_from_live.js —
 * run that first if the live schema has moved, or this builds yesterday's
 * database.
 *
 * The live database is never opened for writing here. The only thing read
 * from it is the SequelizeMeta / SequelizeData migration ledger, copied so
 * `sequelize db:migrate:status` reads all-`up` against the new database and
 * the next migration does not try to re-apply eighty-six existing ones.
 *
 * Usage: node scripts/create_test_database.js [target-db-name] [--drop]
 *                                             [--source <live-db>]
 *          target defaults to aims_test
 *          --drop   recreates it from scratch, discarding whatever is there
 *          --source the database to copy the migration ledger from, and the one
 *                   this refuses to overwrite. Defaults to aims_db.
 *
 * NOTE the source is NOT read from DB_NAME. Once .env is repointed at the test
 * database — which is the whole point of building one — DB_NAME *is* the target,
 * so using it as the source made the script guard the test database against
 * itself and copy the migration ledger out of the very database it had just
 * emptied.
 */

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DIR = path.join(__dirname, '..');

const argv = process.argv.slice(2);
const DROP = argv.includes('--drop');

const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

// Positional args only — `--source aims_db` must not be mistaken for the target.
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) { if (argv[i] === '--source') i += 1; continue; }
    positional.push(argv[i]);
}

const TARGET = positional[0] || 'aims_test';
const SOURCE = flag('source', 'aims_db');

const ssl = process.env.DB_SSL === 'true'
    ? { ca: fs.readFileSync(path.join(DIR, 'config', 'ca.pem')).toString(), rejectUnauthorized: true }
    : undefined;

const connect = (database, extra = {}) => mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database,
    ssl,
    connectTimeout: 30000,
    ...extra,
});

/*
 * Split a .sql file into statements, line by line, honouring DELIMITER.
 *
 * schema.sql wraps every stored procedure in `DELIMITER $$ … END$$ DELIMITER ;`
 * because the body is full of semicolons. So the terminator cannot be assumed
 * to be ";" — it is whatever the last DELIMITER directive said, exactly as the
 * mysql client treats it. The directive itself is consumed, never sent: it is a
 * client instruction and the server rejects it as a syntax error.
 *
 * Quoted text is tracked because a ";" inside 'a;b' is data, not a terminator.
 * Identifiers here are double-quoted (the server runs in ANSI mode) but
 * backticks appear inside generated-column expressions, so all three quote
 * characters are handled.
 */
function splitStatements(sql) {
    const out = [];
    let delimiter = ';';
    let buf = '';
    let quote = null;
    let blockComment = false;

    const flush = () => {
        const s = buf.trim();
        if (s) out.push(s);
        buf = '';
    };

    for (const rawLine of sql.split(/\r?\n/)) {
        // A DELIMITER directive is only valid on its own line, and only when
        // no statement is part-built.
        if (!quote && buf.trim() === '') {
            const m = rawLine.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
            if (m) { delimiter = m[1]; continue; }
        }

        // Whole-line comments carry no SQL.
        if (!quote && !blockComment && /^\s*--/.test(rawLine)) continue;

        let line = rawLine;

        for (let i = 0; i < line.length; i += 1) {
            const ch = line[i];

            if (quote) {
                buf += ch;
                if (ch === quote && line[i - 1] !== '\\') quote = null;
                continue;
            }

            // Inside a /* */ comment nothing is SQL, so an apostrophe in
            // prose ("the student's credits") must not open a string. The
            // characters stay in buf: the comment is part of the routine
            // body being recreated, not noise to be stripped.
            if (blockComment) {
                buf += ch;
                if (ch === '/' && line[i - 1] === '*') blockComment = false;
                continue;
            }

            // A trailing "-- comment" ends the line.
            if (ch === '-' && line[i + 1] === '-' && (i === 0 || /\s/.test(line[i - 1]))) break;

            if (ch === '/' && line[i + 1] === '*') { blockComment = true; buf += ch; continue; }

            if (ch === "'" || ch === '"' || ch === '`') { quote = ch; buf += ch; continue; }

            buf += ch;

            if (!quote && delimiter && buf.endsWith(delimiter)) {
                buf = buf.slice(0, -delimiter.length);
                flush();
            }
        }

        buf += '\n';
    }

    flush();
    return out;
}

/*
 * MySQL errors that mean "this is already true", not "this failed".
 *
 * The CHECK constraints are the reason this exists. SHOW CREATE TABLE prints
 * them inline, so they are already created by schema.sql — and
 * generate_schema_from_live.js also writes each one to constraints.sql as an
 * ALTER. The second one is refused as a duplicate name, which is correct
 * behaviour and not a defect in the resulting database: the constraint is
 * present either way. Reporting it as a failure would mean the script could
 * never report success on a schema that is in fact complete.
 */
const ALREADY_SATISFIED = [
    /Duplicate check constraint name/i,
    /Duplicate key name/i,
    /Duplicate foreign key constraint name/i,
    /already exists/i,
];

const isBenign = (message) => ALREADY_SATISFIED.some((re) => re.test(message));

/*
 * Apply statements, retrying the ones that failed until a pass makes no
 * further progress.
 *
 * Views are why. Several of them select from other views —
 * vw_at_risk_students reads vw_student_attendance_summary — and the file is
 * ordered alphabetically, not by dependency, so a view can legitimately fail
 * on the first pass and succeed on the second. Looping to a fixed point sorts
 * any dependency order without needing to know what it is.
 */
async function applyStatements(conn, statements, label) {
    let pending = statements;
    let applied = 0;
    let benign = 0;
    let pass = 0;

    while (pending.length) {
        pass += 1;
        const failed = [];

        for (const stmt of pending) {
            try {
                await conn.query(stmt);
                applied += 1;
            } catch (e) {
                if (isBenign(e.message)) { benign += 1; continue; }
                failed.push({ message: e.message, stmt });
            }
        }

        // No progress this pass: what is left is genuinely broken.
        if (failed.length === pending.length) {
            console.log(`  ${label}: ${applied}/${statements.length} applied`
                + (benign ? `, ${benign} already present` : ''));
            console.log(`  ${failed.length} FAILED after ${pass} pass(es):`);
            // Every failure is printed. A schema that "mostly" replayed is not
            // one you can test against, and a truncated list hides which part
            // is missing.
            failed.forEach((f) => console.log(
                `    ! ${f.message}\n      ${f.stmt.slice(0, 160).replace(/\s+/g, ' ')}`
            ));
            return failed.length;
        }

        pending = failed.map((f) => f.stmt);
    }

    console.log(`  ${label}: ${applied}/${statements.length} applied`
        + (benign ? `, ${benign} already present` : '')
        + (pass > 1 ? ` (${pass} passes)` : ''));
    return 0;
}

async function runFile(conn, file, label) {
    const statements = splitStatements(fs.readFileSync(path.join(DIR, file), 'utf8'));
    return applyStatements(conn, statements, label);
}

async function main() {
    const source = SOURCE;

    if (TARGET === source) {
        console.error(`Refusing: '${TARGET}' is the source database. Pick another name.`);
        process.exit(1);
    }

    console.log(`Source (read-only): ${source}@${process.env.DB_HOST}`);
    console.log(`Target:             ${TARGET}\n`);

    const admin = await connect(undefined);
    if (DROP) {
        await admin.query(`DROP DATABASE IF EXISTS \`${TARGET}\``);
        console.log(`Dropped existing '${TARGET}'.`);
    }
    await admin.query(
        `CREATE DATABASE IF NOT EXISTS \`${TARGET}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await admin.end();
    console.log(`Database '${TARGET}' ready.\n`);

    const conn = await connect(TARGET);

    // The live server runs in ANSI mode, which is why schema.sql quotes
    // identifiers with double quotes. Set it on this session explicitly rather
    // than relying on a server default that could change.
    await conn.query(
        "SET SESSION sql_mode = 'ANSI,STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'"
    );
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    console.log('Replaying structure:');
    let failed = 0;
    failed += await runFile(conn, 'schema.sql', 'schema.sql');
    failed += await runFile(conn, 'constraints.sql', 'constraints.sql');

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    // ---- the migration ledger ------------------------------------------
    // generate_schema_from_live.js deliberately skips these two, so they are
    // created and copied here.
    console.log('\nCopying the migration ledger:');
    for (const t of ['SequelizeMeta', 'SequelizeData']) {
        const [present] = await conn.query(
            'SELECT COUNT(*) c FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',
            [source, t]
        );
        if (!present[0].c) {
            console.log(`  ${t}: not present on source, skipped`);
            continue;
        }

        await conn.query(`DROP TABLE IF EXISTS \`${t}\``);
        await conn.query(`CREATE TABLE \`${TARGET}\`.\`${t}\` LIKE \`${source}\`.\`${t}\``);
        const [r] = await conn.query(
            `INSERT INTO \`${TARGET}\`.\`${t}\` SELECT * FROM \`${source}\`.\`${t}\``
        );
        console.log(`  ${t}: ${r.affectedRows} rows copied`);
    }

    // ---- what actually got built ---------------------------------------
    const count = async (sql) => (await conn.query(sql, [TARGET]))[0][0].c;
    const tables = await count("SELECT COUNT(*) c FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE'");
    const views = await count('SELECT COUNT(*) c FROM information_schema.VIEWS WHERE TABLE_SCHEMA=?');
    const procs = await count("SELECT COUNT(*) c FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=? AND ROUTINE_TYPE='PROCEDURE'");
    const fks = await count("SELECT COUNT(*) c FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=? AND CONSTRAINT_TYPE='FOREIGN KEY'");

    console.log(`\n${TARGET}: ${tables} tables, ${views} views, ${procs} procedures, ${fks} foreign keys`);

    /*
     * Row counts per table, so "empty" is a fact rather than an assumption.
     * Counted directly rather than read from information_schema.TABLES.TABLE_ROWS,
     * which is an estimate and reports nonsense on a fresh InnoDB table.
     */
    const [names] = await conn.query(
        "SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME",
        [TARGET]
    );
    const nonEmpty = [];
    for (const { t } of names) {
        const [[{ n }]] = await conn.query(`SELECT COUNT(*) n FROM \`${t}\``);
        if (n > 0) nonEmpty.push(`${t}=${n}`);
    }
    console.log(nonEmpty.length
        ? `Non-empty tables: ${nonEmpty.join(', ')}`
        : 'Every table is empty.');

    await conn.end();

    if (failed) {
        console.error(`\n${failed} statement(s) failed. The structure is INCOMPLETE — fix before using it.`);
        process.exit(1);
    }
    console.log('\nStructure replayed with no failures.');
}

main().catch((e) => {
    console.error('CREATE TEST DATABASE FAILED:', e.message);
    process.exit(1);
});
