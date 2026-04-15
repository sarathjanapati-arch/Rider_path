require('dotenv').config({ path: '../.env' });

const { DEFAULT_GAP_MINUTES } = require('../analytics');

module.exports = {
  // Database
  DB_HOST: process.env.DB_HOST,
  DB_PORT: parseInt(process.env.DB_PORT, 10),
  DB_NAME: process.env.DB_NAME,
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD,

  // Server
  PORT: parseInt(process.env.PORT || '3000', 10),
  VALHALLA_URL: process.env.VALHALLA_URL || 'https://valhalla1.openstreetmap.de/route',
  GAP_MINUTES: parseInt(process.env.GAP_MINUTES || `${DEFAULT_GAP_MINUTES}`, 10),

  // Auth
  AUTH_USER: process.env.AUTH_USER || '',
  AUTH_PASSWORD: process.env.AUTH_PASSWORD || '',
  SESSION_COOKIE_NAME: 'rider_tracker_session',
  SESSION_TTL_MS: parseInt(process.env.SESSION_TTL_MS || `${12 * 60 * 60 * 1000}`, 10),

  // Cache
  CACHE_TTL_MS: parseInt(process.env.CACHE_TTL_MS || `${10 * 60 * 1000}`, 10),
};
