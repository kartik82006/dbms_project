import { getPort } from './config/env.js';
import { createHttpServer } from './server.js';
import { checkDbConnection, initializeDatabase } from './db/index.js';

async function bootstrap(): Promise<void> {
    await checkDbConnection();
    await initializeDatabase();

    const server = createHttpServer();
    const port = getPort();
    
    server.listen(port, () => {
        console.log(`Server is running on port ${port}`);
    });
}

bootstrap().catch((error: unknown) => {
    console.error('Error starting server or database setup', error);
    process.exit(1);
});