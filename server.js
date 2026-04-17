const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const os = require('os');
const path = require('path');
const initializeDatabase = require('./config/initDb');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || '0.0.0.0';

const getLocalIPv4Addresses = () => {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }

  return addresses;
};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/modules', require('./routes/moduleRoutes'));
app.use('/api/enrollments', require('./routes/enrollmentRoutes'));

// Test route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((err, req, res, next) => {
  if (err && err.message && err.message.includes('Tipe file tidak didukung')) {
    return res.status(400).json({ success: false, message: err.message });
  }

  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: 'Ukuran file melebihi batas maksimal 200MB' });
  }

  if (err) {
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server', error: err.message });
  }

  return next();
});

const startServer = async () => {
  try {
    await initializeDatabase();
    app.listen(PORT, HOST, () => {
      const localIPs = getLocalIPv4Addresses();

      console.log(`✅ Server running on http://localhost:${PORT}`);
      console.log(`✅ Server running on http://127.0.0.1:${PORT}`);
      console.log(`✅ Network bind: http://${HOST}:${PORT}`);

      if (localIPs.length > 0) {
        for (const ip of localIPs) {
          console.log(`🌐 Akses dari device lain: http://${ip}:${PORT}`);
        }
      }
    });
  } catch (error) {
    console.error('❌ Gagal inisialisasi database schema:', error.message);
    process.exit(1);
  }
};

startServer();
