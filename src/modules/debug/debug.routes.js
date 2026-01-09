import express from 'express';
import { getCacheStats } from '../../shared/utils/dashboardCache.js';

const router = express.Router();

router.get('/debug/health', (req, res) => res.json({ status: 'ok', time: new Date() }));
router.get('/debug/cache-stats', (req, res) => {
  try {
    const stats = getCacheStats();
    res.json({ message: 'Cache stats', stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
