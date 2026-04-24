import { createServer } from 'node:http';
import { createExpressApplication } from './app/index.js';

export function createHttpServer() {
    return createServer(createExpressApplication());
}
