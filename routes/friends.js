// routes/friends.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Friendship = require('../models/Friendship');

// Middleware to check if user is logged in
function isLoggedIn(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.redirect('/login');
  }
}

// Friends page route
router.get('/friends', isLoggedIn, async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    
    // Get current user info
    const currentUser = await User.findById(currentUserId).select('username email');
    
    // Get all users except current user and existing friends/requests
    const existingRelationships = await Friendship.find({
      $or: [
        { requester: currentUserId },
        { recipient: currentUserId }
      ]
    }).select('requester recipient');
    
    const excludedIds = [currentUserId];
    existingRelationships.forEach(rel => {
      excludedIds.push(rel.requester.toString());
      excludedIds.push(rel.recipient.toString());
    });
    
    const suggestedUsers = await User.find({ 
      _id: { $nin: excludedIds }
    }).select('username email isOnline lastSeen').limit(10);
    
    // Get pending friend requests (received)
    const friendRequests = await Friendship.getPendingRequests(currentUserId);
    
    // Get friends list
    const friends = await Friendship.getFriends(currentUserId);
    
    // Get sent requests
    const sentRequests = await Friendship.getSentRequests(currentUserId);
    
    res.render('friends', {
      currentUser: currentUser || { username: req.session.username || 'Guest' },
      currentUserId: currentUserId,
      suggestedUsers,
      friendRequests,
      friends,
      sentRequests
    });
  } catch (err) {
    console.error('Error loading friends page:', err);
    res.status(500).send('Server error');
  }
});

// Send friend request
router.post('/api/friends/request', isLoggedIn, async (req, res) => {
  try {
    const { recipientId } = req.body;
    const requesterId = req.session.userId;
    
    if (!recipientId) {
      return res.status(400).json({ error: 'Recipient ID required' });
    }
    
    if (requesterId === recipientId) {
      return res.status(400).json({ error: 'Cannot send friend request to yourself' });
    }
    
    // Check if recipient exists
    const recipient = await User.findById(recipientId);
    if (!recipient) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if friendship already exists
    const existingFriendship = await Friendship.findOne({
      $or: [
        { requester: requesterId, recipient: recipientId },
        { requester: recipientId, recipient: requesterId }
      ]
    });
    
    if (existingFriendship) {
      if (existingFriendship.status === 'accepted') {
        return res.status(400).json({ error: 'You are already friends' });
      } else if (existingFriendship.status === 'pending') {
        return res.status(400).json({ error: 'Friend request already sent' });
      }
    }
    
    // Create new friend request
    const friendship = new Friendship({
      requester: requesterId,
      recipient: recipientId,
      status: 'pending'
    });
    
    await friendship.save();
    await friendship.populate('requester', 'username');
    await friendship.populate('recipient', 'username');
    
    res.json({ 
      message: 'Friend request sent successfully',
      friendship: friendship
    });
  } catch (err) {
    console.error('Error sending friend request:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Accept friend request
router.post('/api/friends/accept', isLoggedIn, async (req, res) => {
  try {
    const { friendshipId } = req.body;
    const currentUserId = req.session.userId;
    
    if (!friendshipId) {
      return res.status(400).json({ error: 'Friendship ID required' });
    }
    
    const friendship = await Friendship.findOne({
      _id: friendshipId,
      recipient: currentUserId,
      status: 'pending'
    });
    
    if (!friendship) {
      return res.status(404).json({ error: 'Friend request not found' });
    }
    
    friendship.status = 'accepted';
    await friendship.save();
    
    await friendship.populate('requester', 'username');
    await friendship.populate('recipient', 'username');
    
    res.json({ 
      message: 'Friend request accepted',
      friendship: friendship
    });
  } catch (err) {
    console.error('Error accepting friend request:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Decline friend request
router.post('/api/friends/decline', isLoggedIn, async (req, res) => {
  try {
    const { friendshipId } = req.body;
    const currentUserId = req.session.userId;
    
    if (!friendshipId) {
      return res.status(400).json({ error: 'Friendship ID required' });
    }
    
    const friendship = await Friendship.findOne({
      _id: friendshipId,
      recipient: currentUserId,
      status: 'pending'
    });
    
    if (!friendship) {
      return res.status(404).json({ error: 'Friend request not found' });
    }
    
    await Friendship.findByIdAndDelete(friendshipId);
    
    res.json({ message: 'Friend request declined' });
  } catch (err) {
    console.error('Error declining friend request:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove friend
router.post('/api/friends/remove', isLoggedIn, async (req, res) => {
  try {
    const { friendId } = req.body;
    const currentUserId = req.session.userId;
    
    if (!friendId) {
      return res.status(400).json({ error: 'Friend ID required' });
    }
    
    const friendship = await Friendship.findOne({
      $or: [
        { requester: currentUserId, recipient: friendId, status: 'accepted' },
        { requester: friendId, recipient: currentUserId, status: 'accepted' }
      ]
    });
    
    if (!friendship) {
      return res.status(404).json({ error: 'Friendship not found' });
    }
    
    await Friendship.findByIdAndDelete(friendship._id);
    
    res.json({ message: 'Friend removed successfully' });
  } catch (err) {
    console.error('Error removing friend:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Search users
router.get('/api/friends/search', isLoggedIn, async (req, res) => {
  try {
    const { query } = req.query;
    const currentUserId = req.session.userId;
    
    if (!query || query.trim().length < 2) {
      return res.json([]);
    }
    
    // Get existing relationships to exclude
    const existingRelationships = await Friendship.find({
      $or: [
        { requester: currentUserId },
        { recipient: currentUserId }
      ]
    }).select('requester recipient');
    
    const excludedIds = [currentUserId];
    existingRelationships.forEach(rel => {
      excludedIds.push(rel.requester.toString());
      excludedIds.push(rel.recipient.toString());
    });
    
    const users = await User.find({
      _id: { $nin: excludedIds },
      $or: [
        { username: { $regex: query.trim(), $options: 'i' } },
        { email: { $regex: query.trim(), $options: 'i' } }
      ]
    }).select('username email isOnline lastSeen').limit(10);
    
    res.json(users);
  } catch (err) {
    console.error('Error searching users:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get mutual friends count
router.get('/api/friends/mutual/:userId', isLoggedIn, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.session.userId;
    
    const currentUserFriends = await Friendship.getFriends(currentUserId);
    const otherUserFriends = await Friendship.getFriends(userId);
    
    const currentUserFriendIds = currentUserFriends.map(friend => friend._id.toString());
    const mutualFriends = otherUserFriends.filter(friend => 
      currentUserFriendIds.includes(friend._id.toString())
    );
    
    res.json({ mutualCount: mutualFriends.length, mutualFriends });
  } catch (err) {
    console.error('Error getting mutual friends:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;