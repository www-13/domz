// models/Post.js

const mongoose = require('mongoose');

const PostSchema = new mongoose.Schema({
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000,
  },
  imageUrl: {
    type: String,
    trim: true,
  },
  likes: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    }
  }],
  comments: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    }
  }],
  visibility: {
    type: String,
    enum: ['public', 'friends', 'private'],
    default: 'friends',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    default: function() {
      // Set expiration to 50 hours from creation
      return new Date(Date.now() + (50 * 60 * 60 * 1000));
    },
    index: { expireAfterSeconds: 0 } // TTL index for automatic deletion
  }
});

// Create indexes for better query performance
PostSchema.index({ author: 1, createdAt: -1 });
PostSchema.index({ createdAt: -1 });
PostSchema.index({ 'likes.user': 1 });

// Virtual for like count
PostSchema.virtual('likeCount').get(function() {
  return this.likes ? this.likes.length : 0;
});

// Virtual for comment count
PostSchema.virtual('commentCount').get(function() {
  return this.comments ? this.comments.length : 0;
});

// Virtual for time remaining
PostSchema.virtual('timeRemaining').get(function() {
  const now = new Date();
  const expiration = new Date(this.expiresAt);
  const remainingMs = expiration - now;
  
  if (remainingMs <= 0) return 'Expired';
  
  const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
  const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (remainingHours > 0) {
    return `${remainingHours}h ${remainingMinutes}m left`;
  } else {
    return `${remainingMinutes}m left`;
  }
});

// Instance method to check if user liked the post
PostSchema.methods.isLikedBy = function(userId) {
  return this.likes.some(like => like.user.toString() === userId.toString());
};

// Instance method to toggle like
PostSchema.methods.toggleLike = function(userId) {
  const existingLike = this.likes.find(like => like.user.toString() === userId.toString());
  
  if (existingLike) {
    // Remove like
    this.likes = this.likes.filter(like => like.user.toString() !== userId.toString());
    return false; // unliked
  } else {
    // Add like
    this.likes.push({ user: userId });
    return true; // liked
  }
};

// Static method to get posts for user's feed (friends' posts)
PostSchema.statics.getFeedPosts = async function(userId, page = 1, limit = 10) {
  const Friendship = require('./Friendship');
  
  // Get user's friends
  const friends = await Friendship.getFriends(userId);
  const friendIds = friends.map(friend => friend._id);
  
  // Include user's own posts
  friendIds.push(userId);
  
  const posts = await this.find({
    author: { $in: friendIds },
    visibility: { $in: ['public', 'friends'] }
  })
  .populate('author', 'username email isOnline profilePicture')
  .populate('likes.user', 'username profilePicture')
  .populate('comments.user', 'username profilePicture')
  .sort({ createdAt: -1 })
  .skip((page - 1) * limit)
  .limit(limit)
  .lean();
  
  return posts;
};

// Static method to get user's posts
PostSchema.statics.getUserPosts = async function(userId, page = 1, limit = 10) {
  const posts = await this.find({ author: userId })
    .populate('author', 'username email isOnline profilePicture')
    .populate('likes.user', 'username profilePicture')
    .populate('comments.user', 'username profilePicture')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
    
  return posts;
};

// Ensure virtual fields are included in JSON output
PostSchema.set('toJSON', { virtuals: true });
PostSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Post', PostSchema);