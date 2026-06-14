const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const NotificationService = require('../services/NotificationService');

const router = express.Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  const unreadOnly = req.query.unread === '1';
  const notifications = await NotificationService.listForUser(req.user.id, { unreadOnly });
  const unread = await NotificationService.unreadCount(req.user.id);
  res.json({ success: true, notifications, unread_count: unread });
});

router.post('/:id/read', async (req, res) => {
  await NotificationService.markRead(req.user.id, req.params.id);
  res.json({ success: true });
});

router.post('/read-all', async (req, res) => {
  await NotificationService.markAllRead(req.user.id);
  res.json({ success: true });
});

module.exports = router;
