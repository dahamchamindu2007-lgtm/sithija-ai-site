const mongoose = require('mongoose');

// Singleton — always exactly one document, fetched/updated via the helpers
// below instead of Settings.find(), so callers never have to think about
// which doc to use.
const SettingsSchema = new mongoose.Schema({
  maintenanceMode: { type: Boolean, default: false },
  maintenanceMessage: {
    type: String,
    default: "We're doing some quick maintenance. Please check back shortly."
  },
  updatedAt: { type: Date, default: Date.now }
});

const Settings = mongoose.model('Settings', SettingsSchema);

async function getSettings() {
  let doc = await Settings.findOne();
  if (!doc) doc = await Settings.create({});
  return doc;
}

module.exports = { Settings, getSettings };
