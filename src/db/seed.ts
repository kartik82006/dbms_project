import { pool } from './connection.js';

// initial pool database entries
export async function seedDatabase(): Promise<void> {
    await pool.query(`
        INSERT INTO parking_slots (slot_number, vehicle_type)
        VALUES
            ('B1', 'bike'), ('B2', 'bike'), ('B3', 'bike'), ('B4', 'bike'), ('B5', 'bike'), ('B6', 'bike'), ('B7', 'bike'),
            ('C1', 'car'), ('C2', 'car'), ('C3', 'car'), ('C4', 'car'), ('C5', 'car'), ('C6', 'car'), ('C7', 'car')
        ON CONFLICT (slot_number) DO NOTHING
    `);

    await pool.query(`
        INSERT INTO parking_rates (vehicle_type, hourly_rate)
        VALUES ('bike', 20), ('car', 40)
        ON CONFLICT (vehicle_type)
        DO UPDATE SET updated_at = NOW()
    `);

    await pool.query(`
        INSERT INTO vehicle_owners (full_name, phone_number)
        VALUES
            ('Rahul Kumar', '9876500011'),
            ('Anita Sharma', '9876500022'),
            ('Vikram Singh', '9876500033'),
            ('Priya Nair', '9876500044')
        ON CONFLICT (phone_number)
        DO UPDATE SET full_name = EXCLUDED.full_name
    `);

    await pool.query(`
        INSERT INTO vehicles (vehicle_number, vehicle_type, owner_id)
        SELECT 'TN01AB1234', 'car', o.id
        FROM vehicle_owners o
        WHERE o.phone_number = '9876500011'
        ON CONFLICT (vehicle_number)
        DO UPDATE SET vehicle_type = EXCLUDED.vehicle_type, owner_id = EXCLUDED.owner_id
    `);

    await pool.query(`
        INSERT INTO vehicles (vehicle_number, vehicle_type, owner_id)
        SELECT 'TN09XY7788', 'bike', o.id
        FROM vehicle_owners o
        WHERE o.phone_number = '9876500022'
        ON CONFLICT (vehicle_number)
        DO UPDATE SET vehicle_type = EXCLUDED.vehicle_type, owner_id = EXCLUDED.owner_id
    `);

    await pool.query(`
        INSERT INTO vehicles (vehicle_number, vehicle_type, owner_id)
        SELECT 'KA03MN4455', 'car', o.id
        FROM vehicle_owners o
        WHERE o.phone_number = '9876500033'
        ON CONFLICT (vehicle_number)
        DO UPDATE SET vehicle_type = EXCLUDED.vehicle_type, owner_id = EXCLUDED.owner_id
    `);

    await pool.query(`
        INSERT INTO vehicles (vehicle_number, vehicle_type, owner_id)
        SELECT 'KL07PQ1122', 'bike', o.id
        FROM vehicle_owners o
        WHERE o.phone_number = '9876500044'
        ON CONFLICT (vehicle_number)
        DO UPDATE SET vehicle_type = EXCLUDED.vehicle_type, owner_id = EXCLUDED.owner_id
    `);

    await pool.query(`
        INSERT INTO parking_tickets (vehicle_number, vehicle_type, vehicle_id, slot_id, entry_time, exit_time, fee, rate_per_hour, status)
        SELECT v.vehicle_number,
                v.vehicle_type,
                v.id,
                s.id,
                NOW() - INTERVAL '3 hours',
                NOW() - INTERVAL '1 hour',
                CASE WHEN v.vehicle_type = 'bike' THEN 40 ELSE 80 END,
                CASE WHEN v.vehicle_type = 'bike' THEN 20 ELSE 40 END,
                'closed'
        FROM vehicles v
        INNER JOIN parking_slots s ON s.slot_number = CASE WHEN v.vehicle_type = 'bike' THEN 'B5' ELSE 'C5' END
        WHERE v.vehicle_number = 'TN09XY7788'
            AND NOT EXISTS (
                SELECT 1
                FROM parking_tickets t
                WHERE t.vehicle_number = 'TN09XY7788'
                    AND t.status = 'closed'
            )
    `);

    await pool.query(`
        INSERT INTO parking_tickets (vehicle_number, vehicle_type, vehicle_id, slot_id, entry_time, rate_per_hour, status)
        SELECT v.vehicle_number,
                v.vehicle_type,
                v.id,
                s.id,
                NOW() - INTERVAL '45 minutes',
                CASE WHEN v.vehicle_type = 'bike' THEN 20 ELSE 40 END,
                'active'
        FROM vehicles v
        INNER JOIN parking_slots s ON s.slot_number = CASE WHEN v.vehicle_type = 'bike' THEN 'B1' ELSE 'C1' END
        WHERE v.vehicle_number = 'TN01AB1234'
            AND NOT EXISTS (
                SELECT 1
                FROM parking_tickets t
                WHERE t.vehicle_number = 'TN01AB1234'
                    AND t.status = 'active'
            )
    `);

    await pool.query(`
        INSERT INTO parking_tickets (vehicle_number, vehicle_type, vehicle_id, slot_id, entry_time, exit_time, fee, rate_per_hour, status)
        SELECT v.vehicle_number,
                v.vehicle_type,
                v.id,
                s.id,
                NOW() - INTERVAL '6 hours',
                NOW() - INTERVAL '2 hours',
                160,
                40,
                'closed'
        FROM vehicles v
        INNER JOIN parking_slots s ON s.slot_number = 'C6'
        WHERE v.vehicle_number = 'KA03MN4455'
            AND NOT EXISTS (
                SELECT 1
                FROM parking_tickets t
                WHERE t.vehicle_number = 'KA03MN4455'
                    AND t.status = 'closed'
            )
    `);

    await pool.query(`
        INSERT INTO parking_tickets (vehicle_number, vehicle_type, vehicle_id, slot_id, entry_time, rate_per_hour, status)
        SELECT v.vehicle_number,
                v.vehicle_type,
                v.id,
                s.id,
                NOW() - INTERVAL '20 minutes',
                20,
                'active'
        FROM vehicles v
        INNER JOIN parking_slots s ON s.slot_number = 'B2'
        WHERE v.vehicle_number = 'KL07PQ1122'
            AND NOT EXISTS (
                SELECT 1
                FROM parking_tickets t
                WHERE t.vehicle_number = 'KL07PQ1122'
                    AND t.status = 'active'
            )
    `);

    await pool.query(`
        UPDATE parking_slots s
        SET is_occupied = EXISTS (
            SELECT 1
            FROM parking_tickets t
            WHERE t.slot_id = s.id AND t.status = 'active'
        )
    `);

    await pool.query(`
        INSERT INTO payments (ticket_id, amount, payment_method, payment_status, paid_at)
        SELECT t.id,
                COALESCE(t.fee, 0),
                'upi',
                'paid',
                COALESCE(t.exit_time, NOW())
        FROM parking_tickets t
        WHERE t.status = 'closed'
            AND NOT EXISTS (
                SELECT 1
                FROM payments p
                WHERE p.ticket_id = t.id
            )
    `);

    await pool.query(`
        INSERT INTO parking_activity_logs (ticket_id, action, details)
        SELECT t.id,
                'SEED_ENTRY',
                jsonb_build_object('note', 'Demo entry inserted during bootstrap')
        FROM parking_tickets t
        WHERE NOT EXISTS (
            SELECT 1
            FROM parking_activity_logs l
            WHERE l.ticket_id = t.id AND l.action = 'SEED_ENTRY'
        )
    `);

    await pool.query(`
        INSERT INTO parking_activity_logs (ticket_id, action, details)
        SELECT t.id,
                'PAYMENT_LINKED',
                jsonb_build_object('note', 'Payment mapped for closed ticket during bootstrap')
        FROM parking_tickets t
        WHERE t.status = 'closed'
            AND NOT EXISTS (
                SELECT 1
                FROM parking_activity_logs l
                WHERE l.ticket_id = t.id AND l.action = 'PAYMENT_LINKED'
            )
    `);
}
