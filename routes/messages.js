// routes/messages.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const User = require('../models/User');
const Message = require('../models/Message');
const Friendship = require('../models/Friendship');

// Configure multer for message file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '../public/uploads/messages');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'msg-' + req.session.userId + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: function (req, file, cb) {
    // Allow images, videos, audio, and documents
    const allowedTypes = /jpeg|jpg|png|gif|webp|bmp|mp4|avi|mov|mkv|webm|mp3|wav|ogg|m4a|aac|flac|pdf|doc|docx|txt|zip|rar|json/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = file.mimetype.startsWith('image/') || 
                     file.mimetype.startsWith('video/') || 
                     file.mimetype.startsWith('audio/') ||
                     file.mimetype.startsWith('application/') ||
                     file.mimetype === 'text/plain';

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('File type not allowed. Supported types: images, videos, audio, documents'));
    }
  }
});

// Middleware to check if user is logged in
function isLoggedIn(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.redirect('/login');
  }
}

// Messages page route
router.get('/messages', isLoggedIn, async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    
    // Get friends list
    const friends = await Friendship.getFriends(currentUserId);

    // Get current user info
    const currentUser = await User.findById(currentUserId).select('username email');

    res.render('messages', { 
      users: friends, 
      currentUser: currentUser || { username: req.session.username || 'Guest' },
      currentUserId: currentUserId
    });
  } catch (err) {
    console.error('Error loading messages page:', err);
    res.status(500).send('Server error');
  }
});

// Get chat history between two users
router.get('/api/messages/:userId', isLoggedIn, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.session.userId;

    // Check if users are friends
    const areFriends = await Friendship.areFriends(currentUserId, userId);
    if (!areFriends) {
      return res.status(403).json({ error: 'You can only message friends' });
    }

    // Get messages between current user and selected user
    const messages = await Message.find({
      $or: [
        { sender: currentUserId, recipient: userId },
        { sender: userId, recipient: currentUserId }
      ]
    })
    .populate('sender', 'username')
    .populate('recipient', 'username')
    .sort({ createdAt: 1 })
    .limit(50); // Limit to last 50 messages

    // Mark messages as read
    await Message.updateMany(
      { sender: userId, recipient: currentUserId, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    res.json(messages);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all friends (for user list)
router.get('/api/users', isLoggedIn, async (req, res) => {
  try {
    const friends = await Friendship.getFriends(req.session.userId);
    res.json(friends);
  } catch (err) {
    console.error('Error fetching friends:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get unread counts per sender and total
router.get('/api/messages/unread-counts', isLoggedIn, async (req, res) => {
  try {
    const currentUserId = req.session.userId;

    const pipeline = [
      { $match: { recipient: new mongoose.Types.ObjectId(currentUserId), isRead: false } },
      { $group: { _id: '$sender', count: { $sum: 1 } } }
    ];

    const results = await Message.aggregate(pipeline);

    const counts = {};
    let total = 0;
    results.forEach(r => {
      counts[r._id.toString()] = r.count;
      total += r.count;
    });

    res.json({ counts, total });
  } catch (err) {
    console.error('Error fetching unread counts:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Send a message (fallback for non-socket clients)
router.post('/api/messages', isLoggedIn, async (req, res) => {
  try {
    const { recipientId, content } = req.body;
    const senderId = req.session.userId;

    if (!recipientId || !content) {
      return res.status(400).json({ error: 'Recipient and content required' });
    }

    // Check if users are friends
    const areFriends = await Friendship.areFriends(senderId, recipientId);
    if (!areFriends) {
      return res.status(403).json({ error: 'You can only message friends' });
    }

    const message = new Message({
      sender: senderId,
      recipient: recipientId,
      content: content.trim(),
      messageType: 'text'
    });

    await message.save();
    await message.populate('sender', 'username');
    await message.populate('recipient', 'username');

    res.json(message);
  } catch (err) {
    console.error('Error sending message:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Upload file for message
router.post('/api/messages/upload', isLoggedIn, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { recipientId } = req.body;
    const senderId = req.session.userId;

    if (!recipientId) {
      return res.status(400).json({ error: 'Recipient required' });
    }

    // Check if users are friends
    const areFriends = await Friendship.areFriends(senderId, recipientId);
    if (!areFriends) {
      return res.status(403).json({ error: 'You can only send files to friends' });
    }

    // Determine message type based on file
    let messageType = 'file';
    if (req.file.mimetype.startsWith('image/')) {
      messageType = 'image';
    } else if (req.file.mimetype.startsWith('video/')) {
      messageType = 'video';
    } else if (req.file.mimetype.startsWith('audio/')) {
      messageType = 'audio';
    }

    const filePath = '/uploads/messages/' + req.file.filename;
    
    const message = new Message({
      sender: senderId,
      recipient: recipientId,
      content: req.file.originalname, // Store original filename as content
      messageType: messageType,
      filePath: filePath,
      fileSize: req.file.size,
      fileName: req.file.originalname
    });

    await message.save();
    await message.populate('sender', 'username');
    await message.populate('recipient', 'username');

    res.json({
      message: 'File uploaded successfully',
      data: message
    });
  } catch (err) {
    console.error('Error uploading file:', err);
    
    // Clean up uploaded file if there was an error
    if (req.file) {
      const filePath = req.file.path;
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    
    res.status(500).json({ error: 'Server error' });
  }
});

// Log call attempt
router.post('/api/calls/log', isLoggedIn, async (req, res) => {
  try {
    const { recipientId, type, duration, status } = req.body;
    const callerId = req.session.userId;
    
    // Simple call log - you might want a separate Call model
    const callLog = {
      caller: callerId,
      recipient: recipientId,
      type: type, // 'outgoing', 'incoming'
      status: status, // 'completed', 'missed', 'declined', 'failed'
      duration: duration || 0,
      timestamp: new Date()
    };
    
    console.log('Call logged:', callLog);
    
    res.json({ success: true, message: 'Call logged successfully' });
  } catch (err) {
    console.error('Error logging call:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Upload audio recording
router.post('/api/messages/upload-audio', isLoggedIn, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded' });
    }

    const { recipientId, duration } = req.body;
    const senderId = req.session.userId;

    if (!recipientId) {
      return res.status(400).json({ error: 'Recipient required' });
    }

    // Check if users are friends
    const areFriends = await Friendship.areFriends(senderId, recipientId);
    if (!areFriends) {
      return res.status(403).json({ error: 'You can only send audio to friends' });
    }

    const filePath = '/uploads/messages/' + req.file.filename;
    const audioDuration = duration || 0;
    
    const message = new Message({
      sender: senderId,
      recipient: recipientId,
      content: `Audio message (${Math.round(audioDuration)}s)`, // Display duration
      messageType: 'audio',
      filePath: filePath,
      fileSize: req.file.size,
      fileName: req.file.originalname || 'voice_message.webm'
    });

    await message.save();
    await message.populate('sender', 'username');
    await message.populate('recipient', 'username');

    res.json({
      message: 'Audio uploaded successfully',
      data: message
    });
  } catch (err) {
    console.error('Error uploading audio:', err);
    
    // Clean up uploaded file if there was an error
    if (req.file) {
      const filePath = req.file.path;
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
