const mongoose = require('mongoose');

// One doc per user per day. Every chat request increments the matching
// doc's count (upserted), regardless of Pro/Free/Owner — unlike the
// rolling requestCount on User (which only tracks the free-tier daily cap
// and resets), this is permanent history used purely for analytics charts.
const UsageLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true }, // 'YYYY-MM-DD' (UTC)
  count: { type: Number, default: 0 }
});

UsageLogSchema.index({ userId: 1, date: 1 }, { unique: true });
UsageLogSchema.index({ date: 1 });

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

// Fire-and-forget style helper — call after a request succeeds.
async function logRequest(userId) {
  const date = todayString();
  await mongoose.model('UsageLog').updateOne(
    { userId, date },
    { $inc: { count: 1 } },
    { upsert: true }
  );
}

module.exports = mongoose.model('UsageLog', UsageLogSchema);
module.exports.logRequest = logRequest;
module.exports.todayString = todayString;
