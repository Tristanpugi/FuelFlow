const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'fuelflow.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'partner', 'admin')),
    reputation INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS stations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    brand TEXT,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    phone TEXT,
    partner_id INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS fuel_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    station_id INTEGER NOT NULL REFERENCES stations(id),
    fuel_type TEXT NOT NULL CHECK(fuel_type IN ('unleaded', 'premium', 'diesel', 'e10')),
    price REAL NOT NULL,
    submitted_by INTEGER REFERENCES users(id),
    confirmed_count INTEGER NOT NULL DEFAULT 0,
    denied_count INTEGER NOT NULL DEFAULT 0,
    is_verified INTEGER NOT NULL DEFAULT 0,
    is_outdated INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS price_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    price_id INTEGER NOT NULL REFERENCES fuel_prices(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    vote TEXT NOT NULL CHECK(vote IN ('confirm', 'deny')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(price_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    station_id INTEGER REFERENCES stations(id),
    city TEXT,
    fuel_type TEXT NOT NULL CHECK(fuel_type IN ('unleaded', 'premium', 'diesel', 'e10')),
    target_price REAL NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    notified_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    alert_id INTEGER REFERENCES alerts(id),
    message TEXT NOT NULL,
    price REAL,
    station_name TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed only if stations table is empty
const stationCount = db.prepare('SELECT COUNT(*) as count FROM stations').get();
if (stationCount.count === 0) {
  const adminHash = bcrypt.hashSync('admin123', 10);
  const partnerHash = bcrypt.hashSync('partner123', 10);

  const insertUser = db.prepare(
    'INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)'
  );

  const adminResult = insertUser.run('admin@fuelflow.com', adminHash, 'Admin User', 'admin');
  const partnerResult = insertUser.run('partner@fuelflow.com', partnerHash, 'FuelFlow Partner', 'partner');

  const adminId = adminResult.lastInsertRowid;
  const partnerId = partnerResult.lastInsertRowid;

  const insertStation = db.prepare(
    'INSERT INTO stations (name, brand, address, city, lat, lng, partner_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const sydneyStations = [
    ['BP Pyrmont', 'BP', '123 Harris St, Pyrmont', 'Sydney', -33.8688, 151.1957],
    ['Caltex Bondi', 'Caltex', '45 Campbell Parade, Bondi Beach', 'Sydney', -33.8915, 151.2767],
    ['Shell Newtown', 'Shell', '200 King St, Newtown', 'Sydney', -33.8975, 151.1787],
    ['7-Eleven Parramatta', '7-Eleven', '89 Church St, Parramatta', 'Sydney', -33.8151, 151.0022],
    ['United Chatswood', 'United', '67 Victoria Ave, Chatswood', 'Sydney', -33.7959, 151.1803],
  ];

  const melbourneStations = [
    ['BP Melbourne CBD', 'BP', '123 Spencer St, Melbourne', 'Melbourne', -37.8136, 144.9631],
    ['Caltex Richmond', 'Caltex', '456 Church St, Richmond', 'Melbourne', -37.8182, 144.9974],
    ['Shell South Yarra', 'Shell', '78 Toorak Rd, South Yarra', 'Melbourne', -37.8395, 144.9893],
    ['7-Eleven Fitzroy', '7-Eleven', '234 Brunswick St, Fitzroy', 'Melbourne', -37.7985, 144.9789],
    ['Liberty Footscray', 'Liberty', '12 Barkly St, Footscray', 'Melbourne', -37.8007, 144.8996],
  ];

  const allStations = [...sydneyStations, ...melbourneStations];
  const stationIds = [];

  for (const s of allStations) {
    const res = insertStation.run(s[0], s[1], s[2], s[3], s[4], s[5], partnerId);
    stationIds.push(res.lastInsertRowid);
  }

// Seed data - prices are sample data representing typical 2024 Australian fuel prices (cents/L)
  const priceRanges = {
    unleaded: [180.5, 183.9, 187.4, 191.2, 185.7, 182.3, 188.9, 186.1, 190.4, 184.8],
    premium:  [202.5, 205.9, 209.4, 213.2, 207.7, 204.3, 210.9, 208.1, 212.4, 206.8],
    diesel:   [192.5, 195.9, 199.4, 203.2, 197.7, 193.3, 200.9, 198.1, 202.4, 196.8],
    e10:      [172.5, 175.9, 179.4, 183.2, 177.7, 173.3, 180.9, 178.1, 182.4, 176.8],
  };

  const insertPrice = db.prepare(
    'INSERT INTO fuel_prices (station_id, fuel_type, price, submitted_by, is_verified) VALUES (?, ?, ?, ?, 1)'
  );

  stationIds.forEach((stationId, idx) => {
    for (const fuelType of ['unleaded', 'premium', 'diesel', 'e10']) {
      insertPrice.run(stationId, fuelType, priceRanges[fuelType][idx], partnerId);
    }
  });

  console.log(`Database seeded: admin id=${adminId}, partner id=${partnerId}, ${stationIds.length} stations`);
}

module.exports = db;
