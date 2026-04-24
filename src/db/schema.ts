import { pool } from './connection.js';

export async function createDatabaseSchema(): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS parking_slots (
            id SERIAL PRIMARY KEY,
            slot_number TEXT NOT NULL UNIQUE,
            vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('bike', 'car')),
            is_occupied BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS vehicle_owners (
            id SERIAL PRIMARY KEY,
            full_name TEXT NOT NULL,
            phone_number TEXT NOT NULL UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS vehicles (
            id SERIAL PRIMARY KEY,
            vehicle_number TEXT NOT NULL UNIQUE,
            vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('bike', 'car')),
            owner_id INTEGER REFERENCES vehicle_owners(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS parking_rates (
            id SERIAL PRIMARY KEY,
            vehicle_type TEXT NOT NULL UNIQUE CHECK (vehicle_type IN ('bike', 'car')),
            hourly_rate NUMERIC(10, 2) NOT NULL CHECK (hourly_rate >= 0),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS parking_tickets (
            id SERIAL PRIMARY KEY,
            vehicle_number TEXT NOT NULL,
            vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('bike', 'car')),
            vehicle_id INTEGER REFERENCES vehicles(id),
            slot_id INTEGER NOT NULL REFERENCES parking_slots(id),
            entry_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            exit_time TIMESTAMPTZ,
            fee NUMERIC(10, 2),
            rate_per_hour NUMERIC(10, 2),
            status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed'))
        )
    `);

    await pool.query(`
        ALTER TABLE parking_tickets
        ADD COLUMN IF NOT EXISTS vehicle_id INTEGER REFERENCES vehicles(id)
    `);

    await pool.query(`
        ALTER TABLE parking_tickets
        ADD COLUMN IF NOT EXISTS rate_per_hour NUMERIC(10, 2)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS payments (
            id SERIAL PRIMARY KEY,
            ticket_id INTEGER NOT NULL UNIQUE REFERENCES parking_tickets(id),
            amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
            payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'upi', 'card')),
            payment_status TEXT NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid', 'pending', 'failed')),
            paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS parking_activity_logs (
            id SERIAL PRIMARY KEY,
            ticket_id INTEGER REFERENCES parking_tickets(id),
            action TEXT NOT NULL,
            details JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_parking_slots_type_occupied
        ON parking_slots(vehicle_type, is_occupied)
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_tickets_active_status
        ON parking_tickets(status, entry_time)
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_vehicles_owner
        ON vehicles(owner_id)
    `);
}
