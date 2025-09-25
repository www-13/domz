// routes/messages.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Message = require('../models/Message');
const Friendship = require('../models/Friendship');

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

module.exports = router;