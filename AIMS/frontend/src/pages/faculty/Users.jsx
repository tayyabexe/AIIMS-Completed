import { useMemo, useState } from "react";
import Layout from "../../components/faculty/Layout.jsx";
import DataTable from "../../components/faculty/DataTable.jsx";
import Avatar from "../../components/faculty/Avatar.jsx";
import FilterBar, {
  FilterSelect,
  FilterInput,
} from "../../components/faculty/FilterBar.jsx";
import { useData } from "../../context/FacultyDataContext.jsx";
import DataGate from "../../components/faculty/DataState.jsx";
import { ROLE_LABELS } from "../../context/FacultyAuthContext.jsx";
import "./Users.css";

/*
 * THE FACULTY DIRECTORY — READ ONLY, AND WHY
 * ------------------------------------------
 * This screen used to offer "Add User", a live role dropdown, and an "Assign
 * Subjects" picker. None of them persisted: each wrote only to the in-memory
 * FacultyDataContext (updateCollection), so the change looked applied and was
 * gone on the next reload. It could not have persisted either — a teacher is
 * blocked from /api/users (403 by design) and there is no faculty endpoint for
 * a teacher to add accounts or reassign subjects; that is admin-only work done
 * in the admin portal. Only teachers can ever reach /faculty/users (the guard
 * sends every other role to its own portal), so the writes were dead in every
 * case.
 *
 * Rather than keep buttons that lie, this is now what it honestly is: a
 * read-only list of the teacher's colleagues, with the subjects each one
 * teaches. Managing users and subject assignments happens in the admin portal.
 */

export default function Users() {
  const { data, loading, error, reload } = useData();

  const users = data?.users || [];
  const subjects = data?.subjects || [];

  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");

  const filtered = useMemo(() => {
    return users.filter((u) => {
      const roleOk = role === "all" || u.role === role;
      const q = query.trim().toLowerCase();
      const queryOk =
        !q ||
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q);
      return roleOk && queryOk;
    });
  }, [users, role, query]);

  const subjectsByTeacher = (teacherId) =>
    subjects.filter((s) => s.teacherId === teacherId);

  if (loading || error) {
    return (
      <Layout title="Faculty Directory">
        <DataGate loading={loading} error={error} onRetry={reload} label="Loading directory…" />
      </Layout>
    );
  }

  return (
    <Layout title="Faculty Directory">
      <div className="reports-head">
        <div>
          <h2>Faculty Directory</h2>
          <p>
            Your colleagues and the subjects they teach. Adding accounts and
            assigning subjects is done by an administrator in the admin portal.
          </p>
        </div>
      </div>

      <FilterBar
        resetActive={role !== "all" || !!query}
        onReset={() => {
          setRole("all");
          setQuery("");
        }}
      >
        <FilterInput
          label="Search"
          placeholder="Name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <FilterSelect
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          allLabel="All Roles"
          options={Object.entries(ROLE_LABELS).map(([value, label]) => ({
            value,
            label,
          }))}
        />
      </FilterBar>

      <DataTable
        columns={[
          {
            key: "name",
            label: "User",
            render: (r) => (
              <div className="user-cell">
                <Avatar name={r.name} size={34} userId={r.user_id ?? r.userId} />
                <span style={{ fontWeight: 700 }}>{r.name}</span>
              </div>
            ),
          },
          { key: "email", label: "Email" },
          {
            key: "role",
            label: "Role / Designation",
            render: (r) => (
              <div className="role-cell">
                <span style={{ fontWeight: 600 }}>
                  {ROLE_LABELS[r.role] || r.role}
                </span>
                {r.designation ? <em>{r.designation}</em> : null}
              </div>
            ),
          },
          { key: "department", label: "Department" },
          {
            key: "subjects",
            label: "Assigned Subjects",
            render: (r) =>
              r.role === "teacher" ? (
                <div className="subject-chips">
                  {subjectsByTeacher(r.id)
                    .slice(0, 3)
                    .map((s) => (
                      <span className="subject-chip" key={s.code}>
                        {s.code}
                      </span>
                    ))}
                  {subjectsByTeacher(r.id).length > 3 && (
                    <span className="subject-chip more">
                      +{subjectsByTeacher(r.id).length - 3}
                    </span>
                  )}
                  {subjectsByTeacher(r.id).length === 0 && (
                    <span style={{ color: "var(--text-muted)" }}>—</span>
                  )}
                </div>
              ) : (
                <span style={{ color: "var(--text-muted)" }}>—</span>
              ),
          },
        ]}
        rows={filtered}
        rowKey="id"
        searchable={false}
        emptyMessage="No users found."
      />
    </Layout>
  );
}
