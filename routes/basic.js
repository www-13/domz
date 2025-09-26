// routes/basic.js
const express = require('express');
const router = express.Router();
const Post = require('../models/Post');
const User = require('../models/User');

function isLoggedIn(req, res, next) {
  if (req.session.userId) next();
  else res.redirect('/login');
}

// Root route - redirect to dashboard if logged in, otherwise to login
router.get('/', (req, res) => {
  if (req.session.userId) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/login');
  }
});

router.get('/dashboard', isLoggedIn, async (req, res) => {
  try {
    // Get posts for feed
    const posts = await Post.getFeedPosts(req.session.userId, 1, 10);

    // Load current user for sidebar avatar
    const currentUser = await User.findById(req.session.userId).select('username profilePicture');
    
    // Calculate time remaining and other data for each post
    const postsWithMetadata = posts.map(post => {
      const now = new Date();
      const expiration = new Date(post.expiresAt);
      const remainingMs = expiration - now;
      
      let timeRemaining = 'Expired';
      if (remainingMs > 0) {
        const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
        const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
        
        if (remainingHours > 0) {
          timeRemaining = `${remainingHours}h ${remainingMinutes}m left`;
        } else {
          timeRemaining = `${remainingMinutes}m left`;
        }
      }
      
      // Format creation time
      const createdAt = new Date(post.createdAt);
      const timeDiff = now - createdAt;
      let timeAgo = '';
      
      if (timeDiff < 60000) { // Less than 1 minute
        timeAgo = 'Just now';
      } else if (timeDiff < 3600000) { // Less than 1 hour
        const minutes = Math.floor(timeDiff / 60000);
        timeAgo = `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
      } else if (timeDiff < 86400000) { // Less than 1 day
        const hours = Math.floor(timeDiff / 3600000);
        timeAgo = `${hours} hour${hours > 1 ? 's' : ''} ago`;
      } else {
        const days = Math.floor(timeDiff / 86400000);
        timeAgo = `${days} day${days > 1 ? 's' : ''} ago`;
      }
      
      return {
        ...post,
        timeRemaining,
        timeAgo,
        likeCount: post.likes ? post.likes.length : 0,
        commentCount: post.comments ? post.comments.length : 0,
        isLikedByUser: post.likes ? post.likes.some(like => like.user && like.user._id && like.user._id.toString() === req.session.userId.toString()) : false
      };
    });
    
    res.render('index', { 
      username: req.session.username || 'Guest',
      posts: postsWithMetadata,
      currentUserId: req.session.userId,
      currentUser: currentUser
    });
  } catch (err) {
    console.error('Error loading dashboard:', err);
    res.render('index', { 
      username: req.session.username || 'Guest',
      posts: [],
      currentUserId: req.session.userId,
      currentUser: null
    });
  }
});

router.get('/messages', isLoggedIn, (req, res) => {
  res.render('messages', { username: req.session.username || 'Guest' });
});

router.get('/friends', isLoggedIn, (req, res) => {
  res.render('friends', { username: req.session.username || 'Guest' });
});


module.exports = router;