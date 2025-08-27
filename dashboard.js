require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const basicAuth = require('express-basic-auth');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Initialize database
const db = new sqlite3.Database('./combined_bot.db');

// View engine & static files
app.set('view engine', 'ejs');
app.set('views', path.resolve(__dirname, 'views'));
app.use(express.static(path.resolve(__dirname, 'public')));

// Basic authentication
app.use(basicAuth({
  users: { [process.env.ADMIN_USER || 'admin']: process.env.ADMIN_PASS || 'supersecret' },
  challenge: true,
  realm: 'Combined Bot Dashboard'
}));

// IP whitelist middleware
const ALLOWED_IPS = (process.env.DASH_ALLOW_IPS || '127.0.0.1,::1').split(',');
app.use((req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
  if (ALLOWED_IPS.includes(clientIP) || ALLOWED_IPS.includes('127.0.0.1')) {
    next();
  } else {
    res.status(403).send('Access denied');
  }
});

// Dashboard route
app.get('/', async (req, res) => {
  try {
    const stats = await new Promise((resolve, reject) => {
      db.all(`SELECT 
        COUNT(*) as total,
        SUM(verified) as verified,
        SUM(CASE WHEN inGameName IS NOT NULL AND timezone IS NOT NULL AND language IS NOT NULL THEN 1 ELSE 0 END) as profiled,
        SUM(CASE WHEN alliance IS NOT NULL THEN 1 ELSE 0 END) as withAlliance,
        SUM(autoTranslate) as autoTranslateUsers
      FROM profiles`, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows[0] || { total: 0, verified: 0, profiled: 0, withAlliance: 0, autoTranslateUsers: 0 });
      });
    });

    const recentUsers = await new Promise((resolve, reject) => {
      db.all(`SELECT userId, inGameName, alliance, language, joinedAt, verified, autoTranslate 
              FROM profiles 
              ORDER BY joinedAt DESC 
              LIMIT 10`, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const allianceCounts = await new Promise((resolve, reject) => {
      db.all(`SELECT alliance, COUNT(*) as count 
              FROM profiles 
              WHERE alliance IS NOT NULL 
              GROUP BY alliance`, [], (err, rows) => {
        if (err) reject(err);
        else {
          const counts = {};
          (rows || []).forEach(row => {
            counts[row.alliance] = row.count;
          });
          resolve(counts);
        }
      });
    });

    const languageCounts = await new Promise((resolve, reject) => {
      db.all(`SELECT language, COUNT(*) as count 
              FROM profiles 
              WHERE language IS NOT NULL 
              GROUP BY language`, [], (err, rows) => {
        if (err) reject(err);
        else {
          const counts = {};
          (rows || []).forEach(row => {
            counts[row.language] = row.count;
          });
          resolve(counts);
        }
      });
    });

    res.render('dashboard', {
      stats,
      recentUsers,
      allianceCounts,
      languageCounts
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).send('Internal server error');
  }
});

// API endpoint for real-time updates
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await new Promise((resolve, reject) => {
      db.all(`SELECT 
        COUNT(*) as total,
        SUM(verified) as verified,
        SUM(CASE WHEN inGameName IS NOT NULL AND timezone IS NOT NULL AND language IS NOT NULL THEN 1 ELSE 0 END) as profiled,
        SUM(CASE WHEN alliance IS NOT NULL THEN 1 ELSE 0 END) as withAlliance,
        SUM(autoTranslate) as autoTranslateUsers
      FROM profiles`, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows[0] || { total: 0, verified: 0, profiled: 0, withAlliance: 0, autoTranslateUsers: 0 });
      });
    });

    res.json(stats);
  } catch (error) {
    console.error('API stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// WebSocket for real-time updates
io.on('connection', (socket) => {
  console.log('Dashboard client connected');
  
  socket.on('disconnect', () => {
    console.log('Dashboard client disconnected');
  });
});

// Broadcast updates every 30 seconds
setInterval(async () => {
  try {
    const stats = await new Promise((resolve, reject) => {
      db.all(`SELECT 
        COUNT(*) as total,
        SUM(verified) as verified,
        SUM(CASE WHEN inGameName IS NOT NULL AND timezone IS NOT NULL AND language IS NOT NULL THEN 1 ELSE 0 END) as profiled,
        SUM(CASE WHEN alliance IS NOT NULL THEN 1 ELSE 0 END) as withAlliance,
        SUM(autoTranslate) as autoTranslateUsers
      FROM profiles`, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows[0] || { total: 0, verified: 0, profiled: 0, withAlliance: 0, autoTranslateUsers: 0 });
      });
    });

    io.emit('statsUpdate', stats);
  } catch (error) {
    console.error('Error broadcasting stats:', error);
  }
}, 30000);

// Start server
const PORT = process.env.DASH_PORT || 3000;
server.listen(PORT, () => {
  console.log(`📊 Combined Bot Dashboard running at http://localhost:${PORT}`);
  console.log(`🔐 Login: ${process.env.ADMIN_USER || 'admin'} / ${process.env.ADMIN_PASS || 'supersecret'}`);
});
