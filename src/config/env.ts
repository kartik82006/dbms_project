import 'dotenv/config';

export function getPort(): number {
    const rawPort = process.env.PORT?.trim();

    if (!rawPort) {
        return 8080;
    }

    const parsed = Number(rawPort);

    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error('PORT must be a positive integer if provided.');
    }

    return parsed;
}
