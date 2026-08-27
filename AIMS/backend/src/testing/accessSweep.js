// Access-control sweep: every GET route x 8 roles + 3 negative identities.
// Read-only. Does not create, update, or delete anything.
const BASE = "http://localhost:5000";

const ACCOUNTS = [
    ["SuperAdmin", 1, "system.administrator@aims.edu.pk", "SuperAdmin@1234"],
    ["Admin", 2, "admin2@aims.edu.pk", "Admin@1234"],
    ["Teacher", 3, "teacher2@aims.edu.pk", "Teacher@1234"],
    ["Student", 4, "student1@aims.edu.pk", "Student@1234"],
    ["Parent", 5, "parent1@aims.edu.pk", "Parent@1234"],
    ["HR", 6, "nadia.rehman@aims.edu.pk", "Hr@1234"],
    ["Accountant", 7, "saima.akhtar@aims.edu.pk", "Accountant@1234"],
    ["Library", 8, "rabia.nawaz@aims.edu.pk", "Library@1234"]
];

const call = async (method, path, token, body) => {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
        const r = await fetch(BASE + path, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });
        const text = await r.text();
        return { status: r.status, text };
    } catch (e) {
        return { status: 0, text: e.message };
    }
};

(async () => {
    const tokens = {};
    for (const [label, , email, password] of ACCOUNTS) {
        const r = await call("POST", "/api/auth/login", null, { email, password });
        try {
            tokens[label] = JSON.parse(r.text).token;
        } catch { tokens[label] = null; }
    }

    const routes = require(process.env.TMP + "/routes.json")
        .filter(r => r.method === "GET" && !r.p.includes(":"))
        .map(r => r.prefix + (r.p === "/" ? "" : r.p));

    const extra = [
        "/api/students/1828", "/api/attendance/60004", "/api/exams/36",
        "/api/users/2", "/api/teachers/1", "/api/gpa/1",
        "/api/attendance/student/6", "/api/marks/student/1828",
        "/api/results/cgpa/1828", "/api/teacher-dashboard/1"
    ];

    const all = [...new Set([...routes, ...extra])].sort();

    const header = ["ROUTE".padEnd(42), ...ACCOUNTS.map(a => a[0].slice(0, 6).padEnd(6)),
        "none".padEnd(5), "bad".padEnd(5)].join(" ");
    console.log(header);
    console.log("-".repeat(header.length));

    const leaks = [];
    for (const path of all) {
        const cells = [];
        for (const [label] of ACCOUNTS) {
            const r = await call("GET", path, tokens[label]);
            cells.push(String(r.status).padEnd(6));
            if (/password_hash/.test(r.text)) leaks.push(`${path} [${label}]`);
        }
        const anon = await call("GET", path, null);
        const bad = await call("GET", path, "aaa.bbb.ccc");
        if (/password_hash/.test(anon.text)) leaks.push(`${path} [NO TOKEN]`);
        console.log([path.padEnd(42), ...cells,
            String(anon.status).padEnd(5), String(bad.status).padEnd(5)].join(" "));
    }

    console.log("\n=== password_hash LEAKS ===");
    console.log(leaks.length ? leaks.join("\n") : "none");
})();
