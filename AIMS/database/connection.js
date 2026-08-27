const { Sequelize } = require("sequelize");

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    dialect: "mysql",
    logging: false,

    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
  }
);

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log("✅ Database Connected Successfully");
  } catch (error) {
    console.error("❌ Database Connection Failed");
    console.error(error.message);
    process.exit(1);
  }
};

module.exports = {
  sequelize,
  connectDB,
};