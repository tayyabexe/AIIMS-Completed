require('dotenv').config();
const fs = require('fs');
const path = require('path');

const sslOptions =
  process.env.DB_SSL === 'true'
    ? {
        ca: fs.readFileSync(path.resolve(__dirname, 'ca.pem')).toString(),
        rejectUnauthorized: true,
      }
    : {};

module.exports = {
  development: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'mysql',
    dialectOptions: { ssl: sslOptions },
    seederStorage: 'sequelize',
  },
  // Added for Day 14 (production readiness): previously only `development`
  // was exported, so `NODE_ENV=production sequelize db:migrate` (what a real
  // deployment runs) would crash with `config[env]` being undefined. Same
  // env vars as development - a real deployment supplies its own .env with
  // production credentials, it doesn't need separately-named variables.
  // `logging: false` turns off Sequelize's default per-query console.log,
  // which is fine for local dev but not something a production process
  // should be spamming to its logs.
  production: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'mysql',
    dialectOptions: { ssl: sslOptions },
    seederStorage: 'sequelize',
    logging: false,
  },
};