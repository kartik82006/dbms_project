import 'dotenv/config';
import { Pool } from 'pg';

function normalizeConnectionString(connectionUrl: string): string {
    try {
        new URL(connectionUrl);
        return connectionUrl;
    } catch {
        const match = connectionUrl.match(/^(postgres(?:ql)?:\/\/)([^:]+):(.+)@([^/]+)\/(.+)$/i);

        if (!match) {
            throw new Error(
                'DATABASE_URL is invalid. Make sure it follows postgres://user:password@host:port/database and URL-encode special characters in password.'
            );
        }

        const protocol = match[1];
        const user = match[2];
        const password = match[3];
        const host = match[4];
        const database = match[5];

        if (!protocol || !user || !password || !host || !database) {
            throw new Error('DATABASE_URL is invalid. Missing one or more connection parts.');
        }

        const encodedPassword = encodeURIComponent(password);
        const repaired = `${protocol}${user}:${encodedPassword}@${host}/${database}`;

        new URL(repaired);
        return repaired;
    }
}

function resolveConnectionString(): string {
    const rawConnectionString = process.env.DATABASE_URL?.trim();

    if (!rawConnectionString) {
        throw new Error('DATABASE_URL is missing. Set it in .env before starting the server.');
    }

    return normalizeConnectionString(rawConnectionString);
}

const connectionString = resolveConnectionString();
const useSsl = connectionString.includes('supabase.com') || connectionString.includes('supabase.co');

export const pool = new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

export async function checkDbConnection(): Promise<void> {
    await pool.query('SELECT 1');
}
