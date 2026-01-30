require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/tracking-links')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Link Schema
const linkSchema = new mongoose.Schema({
  linkId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  destinationUrl: { type: String, required: true },
  clicks: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  lastClicked: { type: Date },
  clickRecords: [{
    timestamp: { type: Date, default: Date.now },
    ipAddress: String,
    country: String,
    city: String,
    region: String,
    latitude: Number,
    longitude: Number,
    userAgent: String,
    browser: String,
    os: String,
    device: String,
    referrer: String
  }]
});

const Link = mongoose.model('Link', linkSchema);

// Helper function to parse user agent
function parseUserAgent(userAgent) {
  const ua = userAgent.toLowerCase();
  
  // Detect browser
  let browser = 'Unknown';
  if (ua.includes('chrome') && !ua.includes('edg')) browser = 'Chrome';
  else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'Safari';
  else if (ua.includes('firefox')) browser = 'Firefox';
  else if (ua.includes('edg')) browser = 'Edge';
  else if (ua.includes('opera') || ua.includes('opr')) browser = 'Opera';
  
  // Detect OS
  let os = 'Unknown';
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('mac')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';
  
  // Detect device type
  let device = 'Desktop';
  if (ua.includes('mobile')) device = 'Mobile';
  else if (ua.includes('tablet') || ua.includes('ipad')) device = 'Tablet';
  
  return { browser, os, device };
}

// Helper function to get IP address from request
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || 
         req.headers['x-real-ip'] || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress ||
         'Unknown';
}

// Helper function to get geolocation from IP using free API
async function getGeolocation(ip) {
  try {
    // Remove IPv6 prefix if present
    const cleanIp = ip.replace('::ffff:', '');
    
    // Skip localhost/private IPs
    if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'Unknown') {
      return {
        country: 'Unknown',
        city: 'Unknown',
        region: 'Unknown',
        latitude: null,
        longitude: null
      };
    }
    
    // Use ip-api.com free geolocation service
    const response = await fetch(`http://ip-api.com/json/${cleanIp}`);
    const data = await response.json();
    
    if (data.status === 'success') {
      return {
        country: data.country || 'Unknown',
        city: data.city || 'Unknown',
        region: data.regionName || 'Unknown',
        latitude: data.lat || null,
        longitude: data.lon || null
      };
    }
  } catch (error) {
    console.error('Geolocation error:', error);
  }
  
  return {
    country: 'Unknown',
    city: 'Unknown',
    region: 'Unknown',
    latitude: null,
    longitude: null
  };
}

// API Routes

// Create a new tracking link
app.post('/api/links', async (req, res) => {
  try {
    const { name, destinationUrl } = req.body;
    
    // Generate unique ID
    const linkId = 'link_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    // Create new link
    const newLink = new Link({
      linkId,
      name,
      destinationUrl
    });
    
    await newLink.save();
    
    // Generate tracking URL
    const trackingUrl = `${req.protocol}://${req.get('host')}/track/${linkId}`;
    
    res.json({
      success: true,
      link: newLink,
      trackingUrl
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all links
app.get('/api/links', async (req, res) => {
  try {
    const links = await Link.find().sort({ createdAt: -1 });
    res.json({ success: true, links });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get analytics summary
app.get('/api/analytics', async (req, res) => {
  try {
    const links = await Link.find();
    const totalLinks = links.length;
    const totalClicks = links.reduce((sum, link) => sum + link.clicks, 0);
    const avgClicks = totalLinks > 0 ? Math.round(totalClicks / totalLinks) : 0;
    
    res.json({
      success: true,
      analytics: {
        totalLinks,
        totalClicks,
        avgClicks
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a link
app.delete('/api/links/:linkId', async (req, res) => {
  try {
    const { linkId } = req.params;
    await Link.findOneAndDelete({ linkId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get detailed click records for a specific link
app.get('/api/links/:linkId/records', async (req, res) => {
  try {
    const { linkId } = req.params;
    const link = await Link.findOne({ linkId });
    
    if (!link) {
      return res.status(404).json({ success: false, error: 'Link not found' });
    }
    
    res.json({ 
      success: true, 
      link: {
        name: link.name,
        destinationUrl: link.destinationUrl,
        clicks: link.clicks,
        createdAt: link.createdAt
      },
      records: link.clickRecords 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Track click and redirect
app.get('/track/:linkId', async (req, res) => {
  try {
    const { linkId } = req.params;
    
    // Get tracking data
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const referrer = req.headers['referer'] || req.headers['referrer'] || 'Direct';
    const { browser, os, device } = parseUserAgent(userAgent);
    
    // Get geolocation
    const geoData = await getGeolocation(ipAddress);
    
    // Create click record
    const clickRecord = {
      timestamp: new Date(),
      ipAddress: ipAddress,
      country: geoData.country,
      city: geoData.city,
      region: geoData.region,
      latitude: geoData.latitude,
      longitude: geoData.longitude,
      userAgent: userAgent,
      browser: browser,
      os: os,
      device: device,
      referrer: referrer
    };
    
    // Find and update link
    const link = await Link.findOneAndUpdate(
      { linkId },
      { 
        $inc: { clicks: 1 },
        $set: { lastClicked: new Date() },
        $push: { clickRecords: clickRecord }
      },
      { new: true }
    );
    
    if (!link) {
      return res.status(404).send('Tracking link not found');
    }
    
    // Redirect to destination
    res.redirect(link.destinationUrl);
  } catch (error) {
    console.error('Tracking error:', error);
    res.status(500).send('Error processing tracking link');
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
