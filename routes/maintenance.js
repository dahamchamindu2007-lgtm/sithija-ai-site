const express = require('express');
const { getSettings } = require('../models/Settings');

const router = express.Router();

// Public — no auth required, since the login/welcome pages need this too
// (an owner still needs to be able to log in while maintenance is on).
router.get('/status', async (req, res) => {
  const settings = await getSettings();
  res.json({
    success: true,
    maintenanceMode: settings.maintenanceMode,
    message: settings.maintenanceMessage
  });
});

module.exports = router;
