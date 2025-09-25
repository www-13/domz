// routes/posts.js
const express = require('express');
const router = express.Router();
const Post = require('../models/Post');
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

// Create post page
router.get('/create-post', isLoggedIn, async (req, res) => {
  try {
    const currentUser = await User.findById(req.session.userId).select('username email');
    
    res.render('create-post', {
      currentUser: currentUser || { username: req.session.username || 'Guest' },
      currentUserId: req.session.userId
    });
  } catch (err) {
    console.error('Error loading create post page:', err);
    res.status(500).send('Server error');
  }
});

// Create a new post
router.post('/api/posts', isLoggedIn, async (req, res) => {
  try {
    const { content, imageUrl, visibility = 'friends' } = req.body;
    const authorId = req.session.userId;
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Post content is required' });
    }
    
    if (content.trim().length > 2000) {
      return res.status(400).json({ error: 'Post content too long (max 2000 characters)' });
    }
    
    const post = new Post({
      author: authorId,
      content: content.trim(),
      imageUrl: imageUrl ? imageUrl.trim() : undefined,
      visibility: visibility
    });
    
    await post.save();
    await post.populate('author', 'username email isOnline');
    
    res.status(201).json({
      message: 'Post created successfully',
      post: post
    });
  } catch (err) {
    console.error('Error creating post:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get posts for feed (friends' posts)
router.get('/api/posts/feed', isLoggedIn, async (req, res) => {
  try {
    const userId = req.session.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    
    const posts = await Post.getFeedPosts(userId, page, limit);
    
    // Calculate time remaining for each post
    const postsWithTimeRemaining = posts.map(post => {
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
      
      return {
        ...post,
        timeRemaining,
        likeCount: post.likes ? post.likes.length : 0,
        commentCount: post.comments ? post.comments.length : 0,
        isLikedByUser: post.likes ? post.likes.some(like => like.user._id.toString() === userId.toString()) : false
      };
    });
    
    res.json(postsWithTimeRemaining);
  } catch (err) {
    console.error('Error fetching feed posts:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user's own posts
router.get('/api/posts/user/:userId?', isLoggedIn, async (req, res) => {
  try {
    const targetUserId = req.params.userId || req.session.userId;
    const currentUserId = req.session.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    
    // Check if requesting other user's posts
    if (targetUserId !== currentUserId) {
      // Check if users are friends or if posts are public
      const areFriends = await Friendship.areFriends(currentUserId, targetUserId);
      if (!areFriends) {
        // Only return public posts for non-friends
        const posts = await Post.find({
          author: targetUserId,
          visibility: 'public'
        })
        .populate('author', 'username email isOnline')
        .populate('likes.user', 'username')
        .populate('comments.user', 'username')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);
        
        return res.json(posts);
      }
    }
    
    const posts = await Post.getUserPosts(targetUserId, page, limit);
    res.json(posts);
  } catch (err) {
    console.error('Error fetching user posts:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Like/Unlike a post
router.post('/api/posts/:postId/like', isLoggedIn, async (req, res) => {
  try {
    const postId = req.params.postId;
    const userId = req.session.userId;
    
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    // Check if user can see this post
    if (post.visibility === 'private' && post.author.toString() !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (post.visibility === 'friends' && post.author.toString() !== userId) {
      const areFriends = await Friendship.areFriends(userId, post.author);
      if (!areFriends) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }
    
    const isLiked = post.toggleLike(userId);
    await post.save();
    
    await post.populate('author', 'username');
    
    res.json({
      message: isLiked ? 'Post liked' : 'Post unliked',
      isLiked: isLiked,
      likeCount: post.likes.length,
      post: post
    });
  } catch (err) {
    console.error('Error toggling post like:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add comment to a post
router.post('/api/posts/:postId/comment', isLoggedIn, async (req, res) => {
  try {
    const postId = req.params.postId;
    const userId = req.session.userId;
    const { content } = req.body;
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Comment content is required' });
    }
    
    if (content.trim().length > 500) {
      return res.status(400).json({ error: 'Comment too long (max 500 characters)' });
    }
    
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    // Check if user can see this post
    if (post.visibility === 'private' && post.author.toString() !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (post.visibility === 'friends' && post.author.toString() !== userId) {
      const areFriends = await Friendship.areFriends(userId, post.author);
      if (!areFriends) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }
    
    const newComment = {
      user: userId,
      content: content.trim(),
      createdAt: new Date()
    };
    
    post.comments.push(newComment);
    await post.save();
    
    await post.populate('comments.user', 'username profilePicture');
    
    // Get the newly added comment
    const addedComment = post.comments[post.comments.length - 1];
    
    res.status(201).json({
      message: 'Comment added successfully',
      comment: addedComment,
      commentCount: post.comments.length
    });
  } catch (err) {
    console.error('Error adding comment:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a post
router.delete('/api/posts/:postId', isLoggedIn, async (req, res) => {
  try {
    const postId = req.params.postId;
    const userId = req.session.userId;
    
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    // Only author can delete their post
    if (post.author.toString() !== userId) {
      return res.status(403).json({ error: 'You can only delete your own posts' });
    }
    
    await Post.findByIdAndDelete(postId);
    
    res.json({ message: 'Post deleted successfully' });
  } catch (err) {
    console.error('Error deleting post:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single post details
router.get('/api/posts/:postId', isLoggedIn, async (req, res) => {
  try {
    const postId = req.params.postId;
    const userId = req.session.userId;
    
    const post = await Post.findById(postId)
      .populate('author', 'username email isOnline profilePicture')
      .populate('likes.user', 'username profilePicture')
      .populate('comments.user', 'username profilePicture');
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    // Check if user can see this post
    if (post.visibility === 'private' && post.author._id.toString() !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (post.visibility === 'friends' && post.author._id.toString() !== userId) {
      const areFriends = await Friendship.areFriends(userId, post.author._id);
      if (!areFriends) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }
    
    res.json(post);
  } catch (err) {
    console.error('Error fetching post:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;