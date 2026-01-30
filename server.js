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
  lastClicked: { type: Date }
});

const Link = mongoose.model('Link', linkSchema);

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

// Track click and redirect
app.get('/track/:linkId', async (req, res) => {
  try {
    const { linkId } = req.params;
    
    // Find and update link
    const link = await Link.findOneAndUpdate(
      { linkId },
      { 
        $inc: { clicks: 1 },
        $set: { lastClicked: new Date() }
      },
      { new: true }
    );
    
    if (!link) {
      return res.status(404).send('Tracking link not found');
    }
    
    // Redirect to destination
    res.redirect(link.destinationUrl);
  } catch (error) {
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
