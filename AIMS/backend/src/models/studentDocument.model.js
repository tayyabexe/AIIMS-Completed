const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const StudentDocument = sequelize.define(
    "StudentDocument",
    {

        doc_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        student_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },

        doc_type: {
            type: DataTypes.ENUM(
                "CNIC",
                "B-Form",
                "Photo",
                "Certificate",
                "Transcript",
                "Medical",
                "Other"
            ),
            allowNull: false
        },

        /*
         * The LEGACY location: a web path under the /uploads static mount.
         * Nullable as of migration 20260815090000 — a document stored as bytes
         * has no path. Rows written before that migration still use it, and
         * the serving code falls back to it whenever `file_data` is NULL.
         */
        file_url: {
            type: DataTypes.STRING,
            allowNull: true
        },

        /*
         * The document itself.
         *
         * Excluded from every ordinary read by the defaultScope below, for the
         * same reason as the avatar: the documents list on a student profile
         * shows type, date and verification state for a dozen rows, and none
         * of that needs the file. Only the download endpoint asks for it.
         */
        file_data: {
            type: DataTypes.BLOB("medium"),
            allowNull: true
        },

        file_mime: {
            type: DataTypes.STRING(100),
            allowNull: true
        },

        // The name the file had when it was uploaded, so a download arrives as
        // "b-form.pdf" rather than as the primary key.
        file_name: {
            type: DataTypes.STRING(255),
            allowNull: true
        },

        file_size: {
            type: DataTypes.INTEGER,
            allowNull: true
        },

        file_checksum: {
            type: DataTypes.STRING(64),
            allowNull: true
        },

        verified: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },

        uploaded_at: {
            type: DataTypes.DATE
        }

    },
    {

        tableName: "student_documents",

        timestamps: false,

        // See the note on file_data. Listing a student's documents must not
        // drag their scans across the wire.
        defaultScope: {
            attributes: { exclude: ["file_data"] }
        },

        scopes: {
            /* The one caller that wants the bytes: the document download route. */
            withFile: {
                attributes: [
                    "doc_id",
                    "student_id",
                    "doc_type",
                    "file_url",
                    "file_data",
                    "file_mime",
                    "file_name",
                    "file_size",
                    "file_checksum",
                    "uploaded_at"
                ]
            }
        }

    }
);

module.exports = StudentDocument;