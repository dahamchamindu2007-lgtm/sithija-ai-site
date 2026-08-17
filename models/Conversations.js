const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'ai'], required: true },
  content: { type: String, required: true },
  // Which tier badge (sithi-lite/sithi-normal/sithi-pro) this AI reply was
  // sent under — cosmetic only, doesn't change which upstream model answers.
  tier: { type: String, enum: ['sithi-lite', 'sithi-normal', 'sithi-pro'] },
  // 'image' messages hold a generated image in imageData (base64 data URI);
  // content is then just the prompt text used as a caption.
  type: { type: String, enum: ['text', 'image'], default: 'text' },
  imageData: { type: String },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const ConversationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, default: 'New chat' },
  messages: { type: [MessageSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Keep the sidebar list query (find by userId, sort by updatedAt) fast.
ConversationSchema.index({ userId: 1, updatedAt: -1 });

module.exports = mongoose.model('Conversation', ConversationSchema);
