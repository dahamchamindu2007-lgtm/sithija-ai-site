const express = require('express');
const { requireAuth } = require('../middleware/auth');
const Conversation = require('../models/Conversations');

const router = express.Router();

// GET /api/conversations — sidebar list, newest first. Messages omitted on
// purpose (could be long) so this stays cheap even with a lot of history.
router.get('/', requireAuth, async (req, res) => {
  try {
    const conversations = await Conversation.find({ userId: req.user._id })
      .select('title updatedAt createdAt')
      .sort({ updatedAt: -1 })
      .lean();

    res.json({ success: true, conversations });
  } catch (err) {
    console.error('List conversations error:', err);
    res.status(500).json({ success: false, error: 'Could not load conversations' });
  }
});

// POST /api/conversations — start a new, empty conversation.
router.post('/', requireAuth, async (req, res) => {
  try {
    const conversation = await Conversation.create({ userId: req.user._id, title: 'New chat', messages: [] });
    res.json({ success: true, conversation: { _id: conversation._id, title: conversation.title, updatedAt: conversation.updatedAt } });
  } catch (err) {
    console.error('Create conversation error:', err);
    res.status(500).json({ success: false, error: 'Could not create conversation' });
  }
});

// GET /api/conversations/:id — full message history for one conversation.
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({ _id: req.params.id, userId: req.user._id }).lean();
    if (!conversation) return res.status(404).json({ success: false, error: 'Conversation not found' });
    res.json({ success: true, conversation });
  } catch (err) {
    console.error('Get conversation error:', err);
    res.status(400).json({ success: false, error: 'Invalid conversation id' });
  }
});

// DELETE /api/conversations/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await Conversation.deleteOne({ _id: req.params.id, userId: req.user._id });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Conversation not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete conversation error:', err);
    res.status(400).json({ success: false, error: 'Invalid conversation id' });
  }
});

module.exports = router;
