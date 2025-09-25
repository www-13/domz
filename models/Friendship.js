// models/Friendship.js

const mongoose = require('mongoose');

const FriendshipSchema = new mongoose.Schema({
  requester: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined', 'blocked'],
    default: 'pending',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Create compound index to prevent duplicate friend requests
FriendshipSchema.index({ requester: 1, recipient: 1 }, { unique: true });

// Create indexes for better query performance
FriendshipSchema.index({ requester: 1, status: 1 });
FriendshipSchema.index({ recipient: 1, status: 1 });

// Middleware to update updatedAt field
FriendshipSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Static method to check if two users are friends
FriendshipSchema.statics.areFriends = async function(userId1, userId2) {
  const friendship = await this.findOne({
    $or: [
      { requester: userId1, recipient: userId2, status: 'accepted' },
      { requester: userId2, recipient: userId1, status: 'accepted' }
    ]
  });
  return !!friendship;
};

// Static method to get friends list for a user
FriendshipSchema.statics.getFriends = async function(userId) {
  const friendships = await this.find({
    $or: [
      { requester: userId, status: 'accepted' },
      { recipient: userId, status: 'accepted' }
    ]
  }).populate('requester', 'username email isOnline lastSeen')
    .populate('recipient', 'username email isOnline lastSeen');
  
  return friendships.map(friendship => {
    return friendship.requester._id.toString() === userId.toString() 
      ? friendship.recipient 
      : friendship.requester;
  });
};

// Static method to get pending requests for a user
FriendshipSchema.statics.getPendingRequests = async function(userId) {
  const requests = await this.find({
    recipient: userId,
    status: 'pending'
  }).populate('requester', 'username email isOnline lastSeen')
    .sort({ createdAt: -1 });
  
  return requests;
};

// Static method to get sent requests by a user
FriendshipSchema.statics.getSentRequests = async function(userId) {
  const requests = await this.find({
    requester: userId,
    status: 'pending'
  }).populate('recipient', 'username email isOnline lastSeen')
    .sort({ createdAt: -1 });
  
  return requests;
};

module.exports = mongoose.model('Friendship', FriendshipSchema);