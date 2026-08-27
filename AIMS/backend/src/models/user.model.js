const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const User = sequelize.define(
    "User",
    {
        user_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },

        email: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },

        /*
         * The account holder's display name.
         *
         * Denormalised from the role record — students.first_name,
         * employees.first_name, parents.first_name — by the migration
         * 20260820090000-add-user-full-name, and the ONLY name an
         * administrator has, because an admin account has no role record to
         * carry one.
         *
         * Nullable on purpose. A service account genuinely has no name, and
         * NULL says so; a placeholder like "User" would be indistinguishable
         * from a real one and would silently defeat every fallback that reads
         * this. Callers should COALESCE rather than assume.
         *
         * The role record stays authoritative for a legal name on a document.
         * This is the copy every screen and the AI assistant greet the person
         * with, so that nobody has to LEFT JOIN three tables to say hello.
         */
        full_name: {
            type: DataTypes.STRING(150),
            allowNull: true,
        },

        password_hash: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        role_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },

        phone: {
            type: DataTypes.STRING,
            allowNull: true,
        },

        /*
         * The LEGACY avatar location: a path under the /uploads static mount.
         * Still read, and still the answer for every account whose picture was
         * uploaded before avatars moved into the database — see the migration
         * 20260815090000-store-media-as-binary. New uploads leave this NULL.
         */
        profile_picture: {
            type: DataTypes.STRING,
            allowNull: true,
        },

        /*
         * The avatar itself.
         *
         * MUST NOT BE SELECTED CASUALLY. It is up to 2MB, and `users` is read
         * in bulk all over this system — the admin directory, the audience
         * builder, every list that joins a name onto a row. A page of fifty
         * accounts that selected this column would move 100MB to render fifty
         * names, so the defaultScope below excludes it and only the endpoint
         * that actually serves the image asks for it by name.
         */
        profile_picture_data: {
            type: DataTypes.BLOB("medium"),
            allowNull: true,
        },

        profile_picture_mime: {
            type: DataTypes.STRING(100),
            allowNull: true,
        },

        // Kept alongside the bytes so a listing can report a size without
        // reading them.
        profile_picture_size: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },

        // SHA-256 of the bytes, served as the HTTP ETag.
        profile_picture_checksum: {
            type: DataTypes.STRING(64),
            allowNull: true,
        },

        profile_picture_updated_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },

        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },

        // Retained so existing rows and raw queries keep working, but it no
        // longer drives anything: there is no verification flow in this system
        // and nothing ever cleared a false. Defaults true so a row created
        // through the model is not born with a warning nobody can act on.
        // See services/provisioningService.js.
        email_verified: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },

        failed_login_attempts: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },

        /*
         * Set when repeated failed sign-ins locked this account, NULL when it
         * is not locked. Only an administrator clears it — see
         * services/loginSecurity.js and POST /api/users/:id/unlock.
         *
         * Distinct from `is_active`, which is an administrator deliberately
         * taking a login out of service. Unlocking must not reactivate an
         * account somebody switched off on purpose, so the two are separate
         * columns and separate decisions.
         */
        locked_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },

        last_login: {
            type: DataTypes.DATE,
        },

        last_password_change: {
            type: DataTypes.DATE,
        },

        /*
         * Set when an administrator generated this password and read it off a
         * screen. Cleared the moment the user chooses their own. See
         * services/provisioningService.js and the changePassword handler.
         */
        must_change_password: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },

        // When admin-issued credentials were last generated for this account.
        // A timestamp only — nothing here makes the password recoverable.
        credentials_issued_at: {
            type: DataTypes.DATE,
        },

        is_deleted: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
    },
    {
        tableName: "users",
        timestamps: true,
        createdAt: "created_at",
        updatedAt: "updated_at",

        /*
         * The avatar bytes are excluded from every ordinary read.
         *
         * Without this, adding the column alone would have quietly made the
         * whole application slower: `User.findByPk` runs on every
         * authenticated request, and `User.findAll` backs the admin directory.
         * Sequelize selects every defined attribute unless told otherwise, so
         * a 2MB blob would have been pulled across the wire to answer "what is
         * this person's name".
         *
         * A scope, not a removal of the field: the model still knows the
         * column, so writes work normally and the serving endpoint can ask for
         * it explicitly via `attributes: [...]` — an explicit attribute list
         * overrides the default scope rather than merging with it.
         */
        defaultScope: {
            attributes: { exclude: ["profile_picture_data"] }
        },

        scopes: {
            /* The one caller that genuinely wants the bytes: GET /users/:id/avatar. */
            withAvatar: {
                attributes: [
                    "user_id",
                    "profile_picture",
                    "profile_picture_data",
                    "profile_picture_mime",
                    "profile_picture_size",
                    "profile_picture_checksum",
                    "profile_picture_updated_at"
                ]
            }
        }
    }
);

module.exports = User;