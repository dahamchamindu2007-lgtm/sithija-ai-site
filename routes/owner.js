const crypto = require('crypto');
const express = require('express');
const User = require('../models/User');
const Conversation = require('../models/Conversations');
const Notification = require('../models/Notification');
const UsageLog = require('../models/UsageLog');
const Publish = require('../models/Publish');
const { getSettings } = require('../models/Settings');
const { requireAuth, requireOwner } = require('../middleware/auth');
const { sendNotificationEmail } = require('../utils/mailer');

const router = express.Router();
router.use(requireAuth, requireOwner);

// Shared cascade delete: removes the user doc plus everything that
// references it (chat history, in-app notifications), so nothing orphaned
// is left behind in Mongo.
async function deleteUsersCascade(ids) {
  await Conversation.deleteMany({ userId: { $in: ids } });
  await Notification.deleteMany({ userId: { $in: ids } });
  await UsageLog.deleteMany({ userId: { $in: ids } });
  await User.deleteMany({ _id: { $in: ids } });
}

// List all users (no password hashes sent to the client)
router.get('/users', async (req, res) => {
  const users = await User.find({}, '-passwordHash').sort({ createdAt: -1 });
  res.json({ success: true, users });
});

// Toggle Pro status for one user
router.post('/users/:id/pro', async (req, res) => {
  const { isPro } = req.body;
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isPro: !!isPro },
    { new: true, fields: '-passwordHash' }
  );
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  res.json({ success: true, user });
});

// Manually reset a user's daily usage counter
router.post('/users/:id/reset-usage', async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { requestCount: 0, requestDate: '' },
    { new: true, fields: '-passwordHash' }
  );
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  res.json({ success: true, user });
});

// Bulk: give/remove Pro for a set of selected users at once
router.post('/users/bulk-pro', async (req, res) => {
  const { ids, isPro } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: 'No users selected' });
  }
  await User.updateMany({ _id: { $in: ids } }, { isPro: !!isPro });
  res.json({ success: true, updated: ids.length });
});

// Ban a single user — blocks login + every requireAuth-protected route
// immediately, but keeps the account and chat history intact (unlike delete).
router.post('/users/:id/ban', async (req, res) => {
  const { reason } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  if (user.isOwner) return res.status(403).json({ success: false, error: "Can't ban an owner account" });

  user.isBanned = true;
  user.banReason = (reason || '').trim();
  user.bannedAt = new Date();
  await user.save();
  const { passwordHash, ...safe } = user.toObject();
  res.json({ success: true, user: safe });
});

router.post('/users/:id/unban', async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isBanned: false, banReason: '', bannedAt: null },
    { new: true, fields: '-passwordHash' }
  );
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  res.json({ success: true, user });
});

// Bulk ban/unban — owner accounts in the selection are skipped rather than
// blocking the whole batch, same pattern as bulk-delete.
router.post('/users/bulk-ban', async (req, res) => {
  const { ids, reason } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: 'No users selected' });
  }
  const result = await User.updateMany(
    { _id: { $in: ids }, isOwner: { $ne: true } },
    { isBanned: true, banReason: (reason || '').trim(), bannedAt: new Date() }
  );
  res.json({ success: true, updated: result.modifiedCount });
});

router.post('/users/bulk-unban', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: 'No users selected' });
  }
  const result = await User.updateMany(
    { _id: { $in: ids } },
    { isBanned: false, banReason: '', bannedAt: null }
  );
  res.json({ success: true, updated: result.modifiedCount });
});

// Generate (or regenerate) a personal API key for a user, shown once on the
// dashboard so it can be copied. Stored in plain form on the user doc —
// same trust model this project already uses for other secrets/keys.
router.post('/users/:id/generate-key', async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const key = 'hashuai_' + crypto.randomBytes(24).toString('hex');
  user.apiKey = key;
  user.apiKeyCreatedAt = new Date();
  await user.save();
  res.json({ success: true, apiKey: key, apiKeyCreatedAt: user.apiKeyCreatedAt });
});

router.post('/users/:id/revoke-key', async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { $unset: { apiKey: '' }, apiKeyCreatedAt: null },
    { new: true, fields: '-passwordHash' }
  );
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  res.json({ success: true, user });
});

// Analytics for the dashboard's usage chart: total requests per day for the
// last N days (across all users), plus a top-users leaderboard by
// all-time total requests. UsageLog is permanent history (unlike User's
// requestCount, which resets daily) so this survives resets/upgrades.
router.get('/analytics', async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 14, 90);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  const sinceStr = since.toISOString().slice(0, 10);

  const dailyAgg = await UsageLog.aggregate([
    { $match: { date: { $gte: sinceStr } } },
    { $group: { _id: '$date', total: { $sum: '$count' } } },
    { $sort: { _id: 1 } }
  ]);
  const dailyMap = new Map(dailyAgg.map(d => [d._id, d.total]));

  const daily = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    daily.push({ date: key, total: dailyMap.get(key) || 0 });
  }

  const topAgg = await UsageLog.aggregate([
    { $group: { _id: '$userId', total: { $sum: '$count' } } },
    { $sort: { total: -1 } },
    { $limit: 5 }
  ]);
  const topUsers = await User.populate(topAgg, { path: '_id', select: 'email isPro isOwner' });

  const [totalUsers, totalPro, totalBanned, requestsToday] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ isPro: true }),
    User.countDocuments({ isBanned: true }),
    UsageLog.aggregate([
      { $match: { date: UsageLog.todayString() } },
      { $group: { _id: null, total: { $sum: '$count' } } }
    ]).then(r => (r[0] ? r[0].total : 0))
  ]);

  res.json({
    success: true,
    daily,
    topUsers: topUsers.map(t => ({
      email: t._id ? t._id.email : 'deleted user',
      isPro: t._id ? t._id.isPro : false,
      isOwner: t._id ? t._id.isOwner : false,
      total: t.total
    })),
    totals: { totalUsers, totalPro, totalBanned, requestsToday }
  });
});

// Delete a single account (owner accounts are protected — can't delete yourself
// or another owner by mistake from the panel)
router.delete('/users/:id', async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  if (user.isOwner) return res.status(403).json({ success: false, error: "Can't delete an owner account" });

  await deleteUsersCascade([user._id]);
  res.json({ success: true });
});

// Bulk delete a set of selected users. Owner accounts in the selection are
// skipped rather than blocking the whole batch.
router.post('/users/bulk-delete', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: 'No users selected' });
  }
  const users = await User.find({ _id: { $in: ids } });
  const deletable = users.filter(u => !u.isOwner).map(u => u._id);
  const skipped = users.length - deletable.length;

  if (deletable.length) await deleteUsersCascade(deletable);
  res.json({ success: true, deleted: deletable.length, skippedOwners: skipped });
});

// Send a message to a set of selected users: stored as an in-app notification
// (shown next time they open the app) and emailed via the same Gmail sender
// used for OTPs. Email failures for one user don't stop the others.
router.post('/notify', async (req, res) => {
  const { ids, message } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: 'No users selected' });
  }
  if (!message || !message.trim()) {
    return res.status(400).json({ success: false, error: 'Message required' });
  }

  const users = await User.find({ _id: { $in: ids } });

  await Notification.insertMany(
    users.map(u => ({ userId: u._id, message: message.trim() }))
  );

  const emailResults = await Promise.allSettled(
    users.map(u => sendNotificationEmail(u.email, message.trim()))
  );
  const emailFailures = emailResults.filter(r => r.status === 'rejected').length;

  res.json({ success: true, notified: users.length, emailFailures });
});

// Read/update maintenance mode — owner-only, unlike /api/maintenance/status
// which is public (that one's for the frontend to check before rendering).
router.get('/maintenance', async (req, res) => {
  const settings = await getSettings();
  res.json({
    success: true,
    maintenanceMode: settings.maintenanceMode,
    message: settings.maintenanceMessage
  });
});

router.post('/maintenance', async (req, res) => {
  const { maintenanceMode, message } = req.body;
  const settings = await getSettings();
  if (typeof maintenanceMode === 'boolean') settings.maintenanceMode = maintenanceMode;
  if (typeof message === 'string' && message.trim()) settings.maintenanceMessage = message.trim();
  settings.updatedAt = new Date();
  await settings.save();
  res.json({ success: true, maintenanceMode: settings.maintenanceMode, message: settings.maintenanceMessage });
});

// ---------- Published pages (from the chat "Publish" button on HTML replies) ----------

// List every published page, newest first, with the publishing user's
// email attached (not just their id) so the dashboard table is readable.
router.get('/publishes', async (req, res) => {
  const pages = await Publish.find({})
    .sort({ createdAt: -1 })
    .populate('userId', 'email')
    .select('slug disabled createdAt userId');
  res.json({
    success: true,
    pages: pages.map(p => ({
      _id: p._id,
      slug: p.slug,
      url: `${req.protocol}://${req.get('host')}/p/${p.slug}`,
      disabled: p.disabled,
      createdAt: p.createdAt,
      ownerEmail: p.userId ? p.userId.email : 'deleted user'
    }))
  });
});

// Toggle a single page's public availability without deleting it — this is
// the "maintain" action: flip it off to take the link down temporarily,
// flip it back on to restore it.
router.post('/publishes/:id/toggle', async (req, res) => {
  const page = await Publish.findById(req.params.id);
  if (!page) return res.status(404).json({ success: false, error: 'Page not found' });
  page.disabled = !page.disabled;
  await page.save();
  res.json({ success: true, disabled: page.disabled });
});

// Permanently delete a published page.
router.delete('/publishes/:id', async (req, res) => {
  const page = await Publish.findByIdAndDelete(req.params.id);
  if (!page) return res.status(404).json({ success: false, error: 'Page not found' });
  res.json({ success: true });
});

module.exports = router;
