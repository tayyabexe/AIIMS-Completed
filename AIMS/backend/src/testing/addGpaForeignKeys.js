// Adds the missing referential integrity on the gpa table.
// gpa.student_id and gpa.semester_id had no foreign keys, which allowed GPA
// rows to be stored against students/semesters that do not exist.
// Verifies there are no orphan rows before attempting to add the constraints.
require("dotenv").config();
const { sequelize } = require("../database/connection");

const q = (s) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT });

(async () => {

    const existing = await q(`
        SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'gpa'
          AND REFERENCED_TABLE_NAME IS NOT NULL
    `);

    console.log("Existing foreign keys on gpa:",
        existing.length ? existing.map(e => `${e.COLUMN_NAME}->${e.REFERENCED_TABLE_NAME}`).join(", ") : "none");

    const orphanStudents = (await q(`
        SELECT COUNT(*) c FROM gpa g
        LEFT JOIN students s ON s.student_id = g.student_id
        WHERE s.student_id IS NULL
    `))[0].c;

    const orphanSemesters = (await q(`
        SELECT COUNT(*) c FROM gpa g
        LEFT JOIN semesters sm ON sm.semester_id = g.semester_id
        WHERE sm.semester_id IS NULL
    `))[0].c;

    console.log(`Orphan rows -> students: ${orphanStudents}, semesters: ${orphanSemesters}`);

    if (orphanStudents > 0 || orphanSemesters > 0) {
        console.log("\nABORTED: clean up orphan rows before adding constraints.");
        await sequelize.close();
        return;
    }

    const constraints = [
        ["fk_gpa_student", "student_id", "students", "student_id"],
        ["fk_gpa_semester", "semester_id", "semesters", "semester_id"]
    ];

    for (const [name, col, refTable, refCol] of constraints) {

        if (existing.some(e => e.CONSTRAINT_NAME === name)) {
            console.log(`  ${name} already present, skipping`);
            continue;
        }

        try {
            await sequelize.query(`
                ALTER TABLE gpa
                ADD CONSTRAINT ${name}
                FOREIGN KEY (${col}) REFERENCES ${refTable}(${refCol})
                ON DELETE RESTRICT ON UPDATE CASCADE
            `);
            console.log(`  added ${name}: gpa.${col} -> ${refTable}.${refCol}`);
        } catch (e) {
            console.log(`  FAILED ${name}: ${e.message.slice(0, 120)}`);
        }

    }

    const after = await q(`
        SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'gpa'
          AND REFERENCED_TABLE_NAME IS NOT NULL
    `);

    console.log("\nForeign keys on gpa now:");
    after.forEach(f =>
        console.log(`  ${f.CONSTRAINT_NAME}: gpa.${f.COLUMN_NAME} -> ${f.REFERENCED_TABLE_NAME}.${f.REFERENCED_COLUMN_NAME}`));

    await sequelize.close();

})();
