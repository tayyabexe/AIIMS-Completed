const { DataTypes, Op } = require('sequelize');

// Matches an already-renamed email like "deletedcount3_ali@aims.com"
const DELETED_EMAIL_PREFIX = /^deletedcount\d+_/;

module.exports = (sequelize) => {
  const User = sequelize.define(
    'User',
    {
      user_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
      },
      password_hash: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      role_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      phone: {
        type: DataTypes.STRING(20),
      },
      profile_picture: {
        type: DataTypes.STRING(255),
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      // Vestigial. No verification flow exists; see backend provisioningService.
      email_verified: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      failed_login_attempts: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        validate: { min: 0 },
      },
      last_login: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      last_password_change: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      is_deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: 'users',
      underscored: true, // maps createdAt/updatedAt -> created_at/updated_at
      defaultScope: {
        where: { is_deleted: false },
      },
      scopes: {
        withDeleted: {},
      },
      indexes: [
        // Documentation only - the real index lives in the migration.
        { fields: ['is_deleted'] },
      ],
    }
  );

  User.associate = (models) => {
    User.belongsTo(models.Role, { foreignKey: 'role_id', onDelete: 'RESTRICT' });
    User.hasOne(models.Student, { foreignKey: 'user_id', onDelete: 'SET NULL' });
    User.hasOne(models.Employee, { foreignKey: 'user_id', onDelete: 'CASCADE' });
    User.hasOne(models.Parent, { foreignKey: 'user_id', onDelete: 'CASCADE' });
    User.hasMany(models.LeaveRequest, { foreignKey: 'user_id', onDelete: 'CASCADE' });
    User.hasMany(models.LeaveRequest, {
      as: 'ApprovedLeaveRequests',
      foreignKey: 'approved_by',
      onDelete: 'SET NULL',
    });
    User.hasMany(models.Announcement, {
      as: 'PostedAnnouncements',
      foreignKey: 'posted_by',
      onDelete: 'CASCADE',
    });
    User.hasMany(models.Notification, { foreignKey: 'user_id', onDelete: 'CASCADE' });
  };

  // ------------------------------------------------------------
  // Flaw #2 fix: soft-deleting a user frees up their email so it
  // can be reused by a new registration. Instead of losing the
  // original email, it's renamed with an incrementing counter:
  // ali@aims.com -> deletedcount1_ali@aims.com -> (if soft-deleted
  // again after being restored) deletedcount2_ali@aims.com, etc.
  //
  // This runs as a hook (not just inside softDelete() below) so it
  // fires no matter HOW is_deleted gets set to true - via the
  // helper method, a direct .update({ is_deleted: true }), or
  // .save() after changing the field on an instance.
  //
  // NOTE: bulk updates via User.update({...}, { where: ... }) do
  // NOT trigger instance hooks unless { individualHooks: true } is
  // passed. Always soft-delete through user.softDelete() or pass
  // individualHooks: true if bulk-deleting.
  // ------------------------------------------------------------
  User.beforeUpdate(async (user) => {
    if (user.changed('is_deleted') && user.is_deleted === true) {
      const previousEmail = user._previousDataValues.email;
      const baseEmail = previousEmail.replace(DELETED_EMAIL_PREFIX, '');

      const existingCount = await User.scope('withDeleted').count({
        where: {
          email: { [Op.like]: `deletedcount%\\_${baseEmail}` },
        },
      });

      user.email = `deletedcount${existingCount + 1}_${baseEmail}`;
    }
  });

  // Convenience method so backend devs don't have to remember the
  // correct field to set - this alone is enough to trigger the
  // rename hook above.
  User.prototype.softDelete = async function () {
    return this.update({ is_deleted: true });
  };

  return User;
};