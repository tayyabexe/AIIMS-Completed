"use strict";

/*
 * Moves uploaded media into the database as binary, so the system stops
 * depending on a writable uploads directory.
 *
 * WHY
 * ---
 * Every image in the portal is currently a FILE on the API server's disk, and
 * the database stores only a path to it: `users.profile_picture` holds
 * "/uploads/avatars/1786018356314.png", `student_documents.file_url` the same
 * shape. That works exactly as long as one machine serves every request and
 * its disk is never replaced.
 *
 * It breaks the moment it is not. A second API instance behind a load balancer
 * cannot see the first one's uploads, so a profile picture appears and
 * disappears depending on which instance answered. A container redeploy takes
 * the directory with it. A database restore brings back rows pointing at files
 * that are no longer there — the row says the student has a B-Form on record,
 * and the link 404s. The path is a foreign key into a filesystem that nothing
 * enforces, and every one of those failures is silent.
 *
 * Holding the bytes in the row makes the record self-contained: one backup
 * captures both the fact and the file, the transaction that records a document
 * is the transaction that stores it, and deleting a student takes their
 * documents with them instead of orphaning megabytes on disk.
 *
 * WHAT THIS COSTS, HONESTLY
 * -------------------------
 * Database size and backup time. Roughly 2MB per avatar ceiling and 8MB per
 * document ceiling, against ~4,000 accounts. It also means image bytes travel
 * through MySQL rather than being served by the web server, which is why the
 * serving endpoints set long cache headers and an ETag (see mediaService) —
 * after the first request a browser revalidates with a 304 and no bytes move.
 *
 * NOTHING IS MIGRATED HERE, DELIBERATELY
 * --------------------------------------
 * The existing path columns are left in place and untouched, and the new
 * binary columns are nullable with no default. A row that has bytes is served
 * from the database; a row that does not is served from its old path, exactly
 * as it is today. So this migration cannot break an existing avatar or
 * document — on the instant it finishes, every row still resolves the way it
 * did before, and rows convert individually as each file is next uploaded.
 *
 * COLUMN TYPES
 * ------------
 * MEDIUMBLOB (16MB) rather than BLOB (64KB, far too small for any photograph)
 * or LONGBLOB (4GB, an invitation to store something that has no business in a
 * row). The application caps uploads well below the MEDIUMBLOB ceiling — 2MB
 * for an avatar, 8MB for a document — so the type is headroom, not the limit.
 *
 * The MIME type is stored beside the bytes because it cannot be recovered from
 * them reliably, and serving an image without a correct Content-Type leaves
 * the browser sniffing. The size is stored so a listing can report file sizes
 * without SELECTing the blob itself — the reason every read path in the
 * application excludes these columns unless it is actually serving the file.
 *
 * `checksum` is a SHA-256 of the bytes, used as the HTTP ETag. It is what lets
 * a browser revalidate an avatar cheaply instead of re-downloading it on every
 * page, and it is computed once on upload rather than per request.
 */

const USERS = "users";
const DOCUMENTS = "student_documents";

// Sequelize has no MEDIUMBLOB constant; `BLOB("medium")` emits it on MySQL.
const mediumBlob = (Sequelize) => Sequelize.BLOB("medium");

module.exports = {

    async up(queryInterface, Sequelize) {

        // ---------------------------------------------------------- users

        const userColumns = await queryInterface.describeTable(USERS);

        if (!userColumns.profile_picture_data) {
            await queryInterface.addColumn(USERS, "profile_picture_data", {
                type: mediumBlob(Sequelize),
                allowNull: true,
                comment: "Avatar bytes. NULL means fall back to the profile_picture path."
            });
        }

        if (!userColumns.profile_picture_mime) {
            await queryInterface.addColumn(USERS, "profile_picture_mime", {
                type: Sequelize.STRING(100),
                allowNull: true,
                comment: "Content-Type for profile_picture_data, e.g. image/webp"
            });
        }

        if (!userColumns.profile_picture_size) {
            await queryInterface.addColumn(USERS, "profile_picture_size", {
                type: Sequelize.INTEGER,
                allowNull: true,
                comment: "Byte length of profile_picture_data, so listings need not read the blob"
            });
        }

        if (!userColumns.profile_picture_checksum) {
            await queryInterface.addColumn(USERS, "profile_picture_checksum", {
                type: Sequelize.STRING(64),
                allowNull: true,
                comment: "SHA-256 of profile_picture_data, served as the HTTP ETag"
            });
        }

        if (!userColumns.profile_picture_updated_at) {
            await queryInterface.addColumn(USERS, "profile_picture_updated_at", {
                type: Sequelize.DATE,
                allowNull: true,
                comment: "When the avatar bytes were last replaced; served as Last-Modified"
            });
        }

        // ----------------------------------------------- student_documents

        const docColumns = await queryInterface.describeTable(DOCUMENTS);

        if (!docColumns.file_data) {
            await queryInterface.addColumn(DOCUMENTS, "file_data", {
                type: mediumBlob(Sequelize),
                allowNull: true,
                comment: "Document bytes. NULL means fall back to the file_url path."
            });
        }

        if (!docColumns.file_mime) {
            await queryInterface.addColumn(DOCUMENTS, "file_mime", {
                type: Sequelize.STRING(100),
                allowNull: true,
                comment: "Content-Type for file_data"
            });
        }

        if (!docColumns.file_name) {
            await queryInterface.addColumn(DOCUMENTS, "file_name", {
                type: Sequelize.STRING(255),
                allowNull: true,
                comment: "Original filename, for the Content-Disposition on download"
            });
        }

        if (!docColumns.file_size) {
            await queryInterface.addColumn(DOCUMENTS, "file_size", {
                type: Sequelize.INTEGER,
                allowNull: true,
                comment: "Byte length of file_data"
            });
        }

        if (!docColumns.file_checksum) {
            await queryInterface.addColumn(DOCUMENTS, "file_checksum", {
                type: Sequelize.STRING(64),
                allowNull: true,
                comment: "SHA-256 of file_data, served as the HTTP ETag"
            });
        }

        /*
         * `file_url` is NOT NULL today, because a path was the only way to
         * locate a file. A document stored as bytes has no path, so the
         * constraint has to relax or every database-backed upload fails on
         * insert.
         *
         * The column stays — rows written before this migration still need it,
         * and it is the fallback the serving code checks second.
         */
        if (docColumns.file_url && docColumns.file_url.allowNull === false) {
            await queryInterface.changeColumn(DOCUMENTS, "file_url", {
                type: Sequelize.STRING(255),
                allowNull: true,
                comment: "Legacy disk path. NULL for documents stored as file_data."
            });
        }

    },

    async down(queryInterface, Sequelize) {

        const docColumns = await queryInterface.describeTable(DOCUMENTS);

        /*
         * Restoring NOT NULL on file_url would fail against any row written
         * while this migration was applied — those rows are database-backed and
         * legitimately have no path. Backfilling a placeholder path would be
         * worse: it would point at a file that does not exist and read as a
         * broken document rather than an absent one.
         *
         * So the down migration drops the binary columns and leaves file_url
         * nullable. That is a deliberate asymmetry, and the alternative is a
         * down migration that destroys uploaded documents.
         */
        for (const column of [
            "file_data", "file_mime", "file_name", "file_size", "file_checksum"
        ]) {
            if (docColumns[column]) {
                await queryInterface.removeColumn(DOCUMENTS, column);
            }
        }

        const userColumns = await queryInterface.describeTable(USERS);

        for (const column of [
            "profile_picture_data", "profile_picture_mime", "profile_picture_size",
            "profile_picture_checksum", "profile_picture_updated_at"
        ]) {
            if (userColumns[column]) {
                await queryInterface.removeColumn(USERS, column);
            }
        }

        void Sequelize;

    }

};
