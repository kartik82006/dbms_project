import type { Express } from 'express';
import { pool } from '../../db/index.js';

export function registerSystemRoutes(app: Express): void {
    app.get('/api/health', async (_req, res) => {
        try {
            await pool.query('SELECT 1');
            res.status(200).json({ status: 'ok', db: 'connected' });
        } catch {
            res.status(500).json({ status: 'error', db: 'disconnected' });
        }
    });
}
