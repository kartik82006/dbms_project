import express from 'express';
import type { Express } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerParkingRoutes } from './routes/parking.js';
import { registerSystemRoutes } from './routes/system.js';

export function createExpressApplication(): Express {
    const app = express();
    const currentFilePath = fileURLToPath(import.meta.url);
    const currentDirPath = path.dirname(currentFilePath);
    const publicDirPath = path.resolve(currentDirPath, '../../public');

    app.use(express.json());
    app.use(express.static(publicDirPath));

    app.get('/', (_req, res) => {
        res.sendFile(path.join(publicDirPath, 'index.html'));
    });

    registerSystemRoutes(app);
    registerParkingRoutes(app);

    return app;

}