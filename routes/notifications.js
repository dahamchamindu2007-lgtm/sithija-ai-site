const express = require('express');
const Notification = require('../models/Notification');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Latest 30 notifications for the logged-in user, newest first
router.get('/', async (req, res) => {
  const notifications = await Notification.find({ userId: req.user._id })
    .sort({ createdAt: -1 })
    .limit(30);
  const unreadCount = await Notification.countDocuments({ userId: req.user._id, read: false });
  res.json({ success: true, notifications, unreadCount });
});

// Mark one notification as read
router.post('/:id/read', async (req, res) => {
  await Notification.updateOne(
    { _id: req.params.id, userId: req.user._id },
    { read: true }
  );
  res.json({ success: true });
});

// Mark all as read (e.g. when the bell dropdown is opened)
router.post('/read-all', async (req, res) => {
  await Notification.updateMany({ userId: req.user._id, read: false }, { read: true });
  res.json({ success: true });
});

module.exports = router;
