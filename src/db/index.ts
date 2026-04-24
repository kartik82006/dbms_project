import { checkDbConnection, pool } from './connection.js';
import { createDatabaseSchema } from './schema.js';
import { seedDatabase } from './seed.js';

export { checkDbConnection, pool };

export async function initializeDatabase(): Promise<void> {
	await createDatabaseSchema();
	await seedDatabase();
}

