const path = require('path');
const logger = require('morgan');
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const methodOverride = require('method-override');
const app = express();
require('dotenv').config();

// Routes
const basic = require('./routes/basic'); // dashboard and public routes
const auth = require('./routes/auth');   // login/signup routes
const messages = require('./routes/messages'); // messages routes
const friends = require('./routes/friends'); // friends routes
const posts = require('./routes/posts'); // posts routes
const profile = require('./routes/profile'); // profile routes

// Socket.IO
const http = require('http').Server(app);
const io = require('socket.io')(http);

const port = process.env.PORT || 3003;

// --- View Engine & Middleware ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(logger('dev'));

// Body parser - must come before route mounting
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Method override
app.use(methodOverride('_method'));

// Session setup
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'defaultsecret',
    resave: false,
    saveUninitialized: false,
  })
);

// --- Routes ---
app.use('/', auth); // login/signup routes mounted at /
app.use('/', messages); // messages routes mounted at /
app.use('/', friends); // friends routes mounted at /
app.use('/', posts); // posts routes mounted at /
app.use('/', profile); // profile routes mounted at /
app.use('/', basic);    // dashboard or public routes mounted at /


// --- Socket.IO connection ---
const User = require('./models/User');
const Message = require('./models/Message');
const Friendship = require('./models/Friendship');

io.on('connection', (socket) => {
  console.log('new connection: ' + socket.id);
  let currentUser = null;

  // User connects and joins their personal room
  socket.on('user-connected', async (data) => {
    try {
      const { userId, username } = data;
      currentUser = { userId, username };
      
      // Update user's online status and socket ID
      await User.findByIdAndUpdate(userId, {
        isOnline: true,
        lastSeen: new Date(),
        socketId: socket.id
      });
      
      // Join user to their personal room
      socket.join(userId);
      
      // Broadcast user status update to all clients
      socket.broadcast.emit('user-status-update', {
        userId: userId,
        isOnline: true,
        lastSeen: new Date()
      });
      
      console.log(`User ${username} (${userId}) connected`);
    } catch (error) {
      console.error('Error handling user connection:', error);
    }
  });

  // User joins a specific chat room
  socket.on('join-chat', async (data) => {
    try {
      const { senderId, recipientId } = data;
      const chatRoom = [senderId, recipientId].sort().join('-');
      socket.join(chatRoom);
      
      console.log(`User ${senderId} joined chat room: ${chatRoom}`);
    } catch (error) {
      console.error('Error joining chat room:', error);
    }
  });

  // Handle sending messages
  socket.on('send-message', async (data) => {
    try {
      const { senderId, recipientId, content } = data;
      
      // Validate input
      if (!senderId || !recipientId || !content) {
        socket.emit('message-error', { error: 'Missing required fields' });
        return;
      }
      
      // Check if users are friends
      const areFriends = await Friendship.areFriends(senderId, recipientId);
      if (!areFriends) {
        socket.emit('message-error', { error: 'You can only message friends' });
        return;
      }
      
      // Save message to database
      const message = new Message({
        sender: senderId,
        recipient: recipientId,
        content: content.trim(),
        messageType: 'text'
      });
      
      await message.save();
      await message.populate('sender', 'username');
      await message.populate('recipient', 'username');
      
      // Create chat room ID
      const chatRoom = [senderId, recipientId].sort().join('-');
      
      // Emit message to chat room (both sender and recipient)
      io.to(chatRoom).emit('new-message', message);
      
      // Also emit to recipient's personal room if they're not in the chat
      socket.to(recipientId).emit('new-message', message);
      
      // Send delivery confirmation to sender
      socket.emit('message-delivered', {
        messageId: message._id,
        timestamp: message.createdAt
      });
      
      console.log(`Message sent from ${senderId} to ${recipientId}`);
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('message-error', { error: 'Failed to send message' });
    }
  });

  // Handle friend request events
  socket.on('friend-request-sent', async (data) => {
    try {
      const { recipientId, requesterName } = data;
      
      // Notify recipient of new friend request
      socket.to(recipientId).emit('friend-request-received', {
        requesterName: requesterName,
        message: `${requesterName} sent you a friend request`
      });
      
      console.log(`Friend request notification sent to ${recipientId}`);
    } catch (error) {
      console.error('Error handling friend request notification:', error);
    }
  });
  
  socket.on('friend-request-accepted', async (data) => {
    try {
      const { requesterId, accepterName } = data;
      
      // Notify requester that their request was accepted
      socket.to(requesterId).emit('friend-request-response', {
        accepted: true,
        accepterName: accepterName,
        message: `${accepterName} accepted your friend request`
      });
      
      console.log(`Friend request acceptance notification sent to ${requesterId}`);
    } catch (error) {
      console.error('Error handling friend request acceptance notification:', error);
    }
  });

  // Handle message read status
  socket.on('mark-messages-read', async (data) => {
    try {
      const { senderId, recipientId } = data;
      
      // Mark all messages from sender to recipient as read
      await Message.updateMany(
        { sender: senderId, recipient: recipientId, isRead: false },
        { isRead: true, readAt: new Date() }
      );
      
      // Notify sender that messages were read
      const senderUser = await User.findById(senderId).select('socketId');
      if (senderUser && senderUser.socketId) {
        io.to(senderUser.socketId).emit('messages-read', {
          recipientId: recipientId,
          readAt: new Date()
        });
      }
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  });

  // Handle user typing indicators
  socket.on('typing-start', (data) => {
    const { senderId, recipientId } = data;
    const chatRoom = [senderId, recipientId].sort().join('-');
    socket.to(chatRoom).emit('user-typing', {
      userId: senderId,
      isTyping: true
    });
  });

  socket.on('typing-stop', (data) => {
    const { senderId, recipientId } = data;
    const chatRoom = [senderId, recipientId].sort().join('-');
    socket.to(chatRoom).emit('user-typing', {
      userId: senderId,
      isTyping: false
    });
  });

  // Handle user activity status
  socket.on('user-active', async (userId) => {
    try {
      await User.findByIdAndUpdate(userId, {
        isOnline: true,
        lastSeen: new Date()
      });
      
      socket.broadcast.emit('user-status-update', {
        userId: userId,
        isOnline: true,
        lastSeen: new Date()
      });
    } catch (error) {
      console.error('Error updating user active status:', error);
    }
  });

  socket.on('user-inactive', async (userId) => {
    try {
      await User.findByIdAndUpdate(userId, {
        lastSeen: new Date()
      });
      
      socket.broadcast.emit('user-status-update', {
        userId: userId,
        isOnline: false,
        lastSeen: new Date()
      });
    } catch (error) {
      console.error('Error updating user inactive status:', error);
    }
  });

  // Handle user disconnection
  socket.on('user-disconnected', async (userId) => {
    try {
      if (userId) {
        await User.findByIdAndUpdate(userId, {
          isOnline: false,
          lastSeen: new Date(),
          socketId: null
        });
        
        socket.broadcast.emit('user-status-update', {
          userId: userId,
          isOnline: false,
          lastSeen: new Date()
        });
        
        console.log(`User ${userId} manually disconnected`);
      }
    } catch (error) {
      console.error('Error handling user disconnection:', error);
    }
  });

  // Handle socket disconnection
  socket.on('disconnect', async () => {
    try {
      if (currentUser && currentUser.userId) {
        await User.findByIdAndUpdate(currentUser.userId, {
          isOnline: false,
          lastSeen: new Date(),
          socketId: null
        });
        
        socket.broadcast.emit('user-status-update', {
          userId: currentUser.userId,
          isOnline: false,
          lastSeen: new Date()
        });
        
        console.log(`User ${currentUser.username} (${currentUser.userId}) disconnected`);
      }
    } catch (error) {
      console.error('Error handling socket disconnection:', error);
    }
    
    console.log('Socket disconnected: ' + socket.id);
  });
});

// --- Connect to MongoDB and start server ---
mongoose
  .connect(process.env.MONGO_URL)
  .then(() => {
    http.listen(port, () => {
      console.log('MongoDB connected');
      console.log(`Server running at http://localhost:${port}/`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
  });