const mongoose = require('mongoose');

// A page a user published from an AI-generated HTML code block. Served
// publicly (no auth) at GET /p/:slug, straight from routes/publish.js.
const PublishSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, index: true },
  html: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  disabled: { type: Boolean, default: false }, // owner "maintain" toggle — takes the public page down without deleting it
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Publish', PublishSchema);
