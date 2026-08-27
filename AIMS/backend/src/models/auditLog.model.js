const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

/*
 * One administrative act, recorded.
 *
 * The table has existed since the original schema.sql bootstrap and was empty:
 * nothing in the application ever wrote to it. That mattered most for account
 * provisioning — admins create logins and issue passwords, and there was no
 * record of who did it, for whom, or when. A password an administrator issues
 * is a credential handed to a person; if nobody can say which administrator
 * issued it, the credential has no provenance.
 *
 * `old_value` / `new_value` are JSON snapshots. They deliberately never carry a
 * plaintext password or a password hash — see auditService.record, which strips
 * them — because an audit trail that stores credentials is a second place to
 * steal them from.
 */
const AuditLog = sequelize.define(
    "AuditLog",
    {
        log_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        // The person who did it. NOT NULL in the schema: an entry nobody can be
        // attributed to is not an audit entry.
        user_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        // e.g. "STUDENT_ADMITTED", "CREDENTIALS_REISSUED".
        action: {
            type: DataTypes.STRING(100),
            allowNull: false
        },

        // e.g. "Provisioning", "Fees".
        module: {
            type: DataTypes.STRING(50),
            allowNull: false
        },

        // What was acted on, as "table#id" where there is one.
        entity_affected: {
            type: DataTypes.STRING(100)
        },

        old_value: {
            type: DataTypes.JSON,
            allowNull: true
        },

        new_value: {
            type: DataTypes.JSON,
            allowNull: true
        },

        action_timestamp: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },

        ip_address: {
            type: DataTypes.STRING(45)
        }
    },
    {
        tableName: "audit_logs",
        timestamps: false
    }
);

module.exports = AuditLog;
