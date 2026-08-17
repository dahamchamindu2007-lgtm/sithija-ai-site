const UsageLog = require('../models/UsageLog');

const DAILY_LIMIT = 20;

function todayString() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD' in UTC
}

// Use AFTER requireAuth. Counts against the user's MongoDB doc,
// so switching phones/browsers with the same account does not reset the limit.
async function checkRateLimit(req, res, next) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  if (user.isPro || user.isOwner) {
    req.rateLimit = { remaining: 'unlimited', limit: 'unlimited' };
    // Pro/owner requests skip the daily cap but still get logged, so
    // owner-dashboard analytics reflect real total usage, not just free tier.
    UsageLog.logRequest(user._id).catch(err => console.error('UsageLog error:', err.message));
    return next();
  }

  const today = todayString();
  if (user.requestDate !== today) {
    user.requestDate = today;
    user.requestCount = 0;
  }

  if (user.requestCount >= DAILY_LIMIT) {
    return res.status(429).json({
      success: false,
      error: `Daily limit reached (${DAILY_LIMIT} requests/day). Try again tomorrow or upgrade to Pro.`,
      remaining: 0
    });
  }

  user.requestCount += 1;
  await user.save();
  UsageLog.logRequest(user._id).catch(err => console.error('UsageLog error:', err.message));

  req.rateLimit = { remaining: DAILY_LIMIT - user.requestCount, limit: DAILY_LIMIT };
  next();
}

module.exports = { checkRateLimit, DAILY_LIMIT };
