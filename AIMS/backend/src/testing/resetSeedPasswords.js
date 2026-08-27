// Resets seed-account passwords to the documented per-role values and stores
// fresh bcrypt hashes. Only touches accounts whose stored hash does NOT already
// verify against the documented password, so working accounts are left alone.
require("dotenv").config();
const bcrypt = require("bcrypt");
const { sequelize } = require("../database/connection");

const ROLE_PW = {
    1: "SuperAdmin@1234",
    2: "Admin@1234",
    3: "Teacher@1234",
    4: "Student@1234",
    5: "Parent@1234",
    6: "Hr@1234",
    7: "Accountant@1234",
    8: "Library@1234"
};

const q = (s, r) => sequelize.query(s, { type: sequelize.QueryTypes.SELECT, replacements: r });

(async () => {
    const users = await q(
        "SELECT user_id, email, role_id, password_hash FROM users WHERE is_deleted = 0 ORDER BY role_id, user_id"
    );

    const broken = [];
    for (const u of users) {
        const pw = ROLE_PW[u.role_id];
        if (!pw) continue;
        let ok = false;
        try {
            ok = await bcrypt.compare(pw, u.password_hash || "");
        } catch {
            ok = false;                       // not a valid bcrypt hash at all
        }
        if (!ok) broken.push(u);
    }

    console.log(`Scanned ${users.length} active users.`);
    console.log(`Accounts whose password does not match the documented value: ${broken.length}\n`);
    broken.forEach(u =>
        console.log(`  role=${u.role_id}  ${String(u.email).padEnd(34)} hash=${String(u.password_hash).slice(0, 12)}...`));

    if (!broken.length) {
        console.log("\nNothing to reset.");
        await sequelize.close();
        return;
    }

    console.log("\nResetting...\n");
    for (const u of broken) {
        const pw = ROLE_PW[u.role_id];
        const hash = await bcrypt.hash(pw, 10);
        await sequelize.query(
            "UPDATE users SET password_hash = :h, failed_login_attempts = 0 WHERE user_id = :id",
            { replacements: { h: hash, id: u.user_id } }
        );
        const after = (await q("SELECT password_hash FROM users WHERE user_id = :id", { id: u.user_id }))[0];
        const verified = await bcrypt.compare(pw, after.password_hash);
        console.log(`  ${verified ? "OK  " : "FAIL"} ${String(u.email).padEnd(34)} -> ${pw}`);
    }

    await sequelize.close();
})();
