// teacher_assignments, teacher_schedules and teacher_profiles carry no
// referential integrity, which lets rows be stored against teachers/subjects
// that do not exist. Adds the constraints after confirming there are no
// orphan rows to break the ALTER.
require("dotenv").config();
const { sequelize } = require("../database/connection");

const q = (s) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT });

const PLAN = [
    ["teacher_assignments", "fk_ta_teacher", "teacher_id", "teachers", "teacher_id"],
    ["teacher_assignments", "fk_ta_subject", "subject_id", "subjects", "subject_id"],
    ["teacher_assignments", "fk_ta_batch", "batch_id", "batches", "batch_id"],
    ["teacher_schedules", "fk_ts_teacher", "teacher_id", "teachers", "teacher_id"],
    ["teacher_schedules", "fk_ts_subject", "subject_id", "subjects", "subject_id"],
    ["teacher_profiles", "fk_tp_teacher", "teacher_id", "teachers", "teacher_id"]
];

(async () => {

    const existing = await q(`
        SELECT TABLE_NAME, CONSTRAINT_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
          AND TABLE_NAME IN ('teacher_assignments','teacher_schedules','teacher_profiles')
    `);
    const have = new Set(existing.map(e => e.CONSTRAINT_NAME));

    for (const [table, name, col, refTable, refCol] of PLAN) {

        if (have.has(name)) {
            console.log(`  ${name} already present, skipping`);
            continue;
        }

        const orphans = (await q(`
            SELECT COUNT(*) c FROM ${table} t
            LEFT JOIN ${refTable} r ON r.${refCol} = t.${col}
            WHERE t.${col} IS NOT NULL AND r.${refCol} IS NULL
        `))[0].c;

        if (orphans > 0) {
            console.log(`  SKIP ${name}: ${orphans} orphan row(s) in ${table}.${col}`);
            continue;
        }

        try {
            await sequelize.query(`
                ALTER TABLE ${table}
                ADD CONSTRAINT ${name}
                FOREIGN KEY (${col}) REFERENCES ${refTable}(${refCol})
                ON DELETE RESTRICT ON UPDATE CASCADE
            `);
            console.log(`  added ${name}: ${table}.${col} -> ${refTable}.${refCol}`);
        } catch (e) {
            console.log(`  FAILED ${name}: ${e.message.slice(0, 110)}`);
        }

    }

    const after = await q(`
        SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
          AND TABLE_NAME IN ('teacher_assignments','teacher_schedules','teacher_profiles')
        ORDER BY TABLE_NAME
    `);

    console.log("\nForeign keys now:");
    after.forEach(f =>
        console.log(`  ${f.TABLE_NAME}.${f.COLUMN_NAME} -> ${f.REFERENCED_TABLE_NAME}`));

    await sequelize.close();

})();
