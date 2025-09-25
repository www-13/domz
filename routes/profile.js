// routes/profile.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const User = require('../models/User');
const Post = require('../models/Post');
const Friendship = require('../models/Friendship');

// Middleware to check if user is logged in
function isLoggedIn(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.redirect('/login');
  }
}

// Configure multer for profile picture uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '../public/uploads/profiles');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile-' + req.session.userId + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Get current user's profile page
router.get('/profile', isLoggedIn, async (req, res) => {
  try {
    const currentUser = await User.findById(req.session.userId)
      .select('username email fullName bio location profilePicture createdAt isOnline lastSeen');
    
    if (!currentUser) {
      return res.redirect('/login');
    }

    // Get user's posts count
    const postsCount = await Post.countDocuments({ author: req.session.userId });
    
    // Get friends count
    const friends = await Friendship.getFriends(req.session.userId);
    const friendsCount = friends.length;
    
    // Get recent posts by user
    const recentPosts = await Post.find({ author: req.session.userId })
      .sort({ createdAt: -1 })
      .limit(6)
      .populate('author', 'username profilePicture')
      .lean();

    res.render('profile', {
      currentUser,
      currentUserId: req.session.userId,
      postsCount,
      friendsCount,
      recentPosts,
      isOwnProfile: true
    });
  } catch (err) {
    console.error('Error loading profile:', err);
    res.status(500).send('Server error');
  }
});

// View another user's profile
router.get('/profile/:userId', isLoggedIn, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.session.userId;

    // Don't allow viewing own profile this way
    if (userId === currentUserId) {
      return res.redirect('/profile');
    }

    const user = await User.findById(userId)
      .select('username email fullName bio location profilePicture createdAt isOnline lastSeen');
    
    if (!user) {
      return res.status(404).render('404', { message: 'User not found' });
    }

    // Check friendship status
    const friendship = await Friendship.findOne({
      $or: [
        { requester: currentUserId, recipient: userId },
        { requester: userId, recipient: currentUserId }
      ]
    });

    let friendshipStatus = 'none';
    let canSendRequest = true;

    if (friendship) {
      if (friendship.status === 'accepted') {
        friendshipStatus = 'friends';
        canSendRequest = false;
      } else if (friendship.status === 'pending') {
        if (friendship.requester.toString() === currentUserId) {
          friendshipStatus = 'requested';
        } else {
          friendshipStatus = 'pending';
        }
        canSendRequest = false;
      }
    }

    // Get user's posts count
    const postsCount = await Post.countDocuments({ author: userId });
    
    // Get friends count
    const friends = await Friendship.getFriends(userId);
    const friendsCount = friends.length;

    // Get mutual friends
    const currentUserFriends = await Friendship.getFriends(currentUserId);
    const currentUserFriendIds = currentUserFriends.map(friend => friend._id.toString());
    const mutualFriends = friends.filter(friend => 
      currentUserFriendIds.includes(friend._id.toString())
    );

    // Get recent posts (only if friends or public posts)
    let recentPosts = [];
    if (friendshipStatus === 'friends') {
      recentPosts = await Post.find({ 
        author: userId,
        visibility: { $in: ['public', 'friends'] }
      })
      .sort({ createdAt: -1 })
      .limit(6)
      .populate('author', 'username profilePicture')
      .lean();
    } else {
      recentPosts = await Post.find({ 
        author: userId,
        visibility: 'public'
      })
      .sort({ createdAt: -1 })
      .limit(6)
      .populate('author', 'username profilePicture')
      .lean();
    }

    const currentUser = await User.findById(currentUserId).select('username');

    res.render('profile-viewer', {
      user,
      currentUser,
      currentUserId,
      postsCount,
      friendsCount,
      mutualFriends: mutualFriends.slice(0, 5), // Show up to 5 mutual friends
      mutualCount: mutualFriends.length,
      recentPosts,
      friendshipStatus,
      canSendRequest,
      isOwnProfile: false
    });
  } catch (err) {
    console.error('Error loading user profile:', err);
    res.status(500).send('Server error');
  }
});

// Update profile information
router.post('/api/profile/update', isLoggedIn, async (req, res) => {
  try {
    const { fullName, bio, location } = req.body;
    const userId = req.session.userId;

    // Validate input
    if (fullName && fullName.length > 100) {
      return res.status(400).json({ error: 'Full name is too long (max 100 characters)' });
    }
    if (bio && bio.length > 300) {
      return res.status(400).json({ error: 'Bio is too long (max 300 characters)' });
    }
    if (location && location.length > 100) {
      return res.status(400).json({ error: 'Location is too long (max 100 characters)' });
    }

    const updateData = {};
    if (fullName !== undefined) updateData.fullName = fullName.trim();
    if (bio !== undefined) updateData.bio = bio.trim();
    if (location !== undefined) updateData.location = location.trim();

    const updatedUser = await User.findByIdAndUpdate(
      userId, 
      updateData,
      { new: true, runValidators: true }
    ).select('username email fullName bio location profilePicture');

    res.json({
      message: 'Profile updated successfully',
      user: updatedUser
    });
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Upload profile picture
router.post('/api/profile/upload-picture', isLoggedIn, upload.single('profilePicture'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const userId = req.session.userId;
    const user = await User.findById(userId);

    // Delete old profile picture if exists
    if (user.profilePicture) {
      const oldImagePath = path.join(__dirname, '../public', user.profilePicture);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
      }
    }

    // Update user with new profile picture path
    const profilePicturePath = '/uploads/profiles/' + req.file.filename;
    
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { profilePicture: profilePicturePath },
      { new: true }
    ).select('username email fullName bio location profilePicture');

    res.json({
      message: 'Profile picture updated successfully',
      profilePicture: profilePicturePath,
      user: updatedUser
    });
  } catch (err) {
    console.error('Error uploading profile picture:', err);
    
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

// Delete profile picture
router.delete('/api/profile/delete-picture', isLoggedIn, async (req, res) => {
  try {
    const userId = req.session.userId;
    const user = await User.findById(userId);

    if (user.profilePicture) {
      // Delete physical file
      const imagePath = path.join(__dirname, '../public', user.profilePicture);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }

      // Update user record
      await User.findByIdAndUpdate(userId, { profilePicture: null });
    }

    res.json({ message: 'Profile picture deleted successfully' });
  } catch (err) {
    console.error('Error deleting profile picture:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user basic info (for profile links)
router.get('/api/users/:userId/info', isLoggedIn, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId)
      .select('username fullName profilePicture isOnline lastSeen');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    console.error('Error getting user info:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;