import { pool } from './connection.js';

export async function createDatabaseRoutines(): Promise<void> {
    await pool.query(`
        CREATE OR REPLACE FUNCTION calculate_parking_fee(
            p_vehicle_type TEXT,
            p_entry_time TIMESTAMPTZ,
            p_exit_time TIMESTAMPTZ DEFAULT NOW()
        )
        RETURNS NUMERIC(10, 2)
        LANGUAGE plpgsql
        AS $$
        DECLARE
            rate_per_hour NUMERIC(10, 2);
            hours_charged INTEGER;
        BEGIN
            SELECT hourly_rate
            INTO rate_per_hour
            FROM parking_rates
            WHERE vehicle_type = p_vehicle_type;

            IF rate_per_hour IS NULL THEN
                rate_per_hour := CASE WHEN p_vehicle_type = 'bike' THEN 20 ELSE 40 END;
            END IF;

            hours_charged := GREATEST(
                1,
                CEIL(EXTRACT(EPOCH FROM (p_exit_time - p_entry_time)) / 3600.0)::INTEGER
            );

            RETURN hours_charged * rate_per_hour;
        END;
        $$
    `);

    await pool.query(`
        CREATE OR REPLACE FUNCTION sync_parking_ticket_state()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
                IF NEW.status = 'closed' THEN
                    UPDATE parking_slots
                    SET is_occupied = FALSE
                    WHERE id = NEW.slot_id;

                    INSERT INTO parking_activity_logs (ticket_id, action, details)
                    VALUES (
                        NEW.id,
                        'EXIT',
                        jsonb_build_object(
                            'slotId', NEW.slot_id,
                            'vehicleNumber', NEW.vehicle_number,
                            'fee', NEW.fee,
                            'entryTime', NEW.entry_time,
                            'exitTime', NEW.exit_time
                        )
                    );
                ELSIF NEW.status = 'active' THEN
                    UPDATE parking_slots
                    SET is_occupied = TRUE
                    WHERE id = NEW.slot_id;

                    INSERT INTO parking_activity_logs (ticket_id, action, details)
                    VALUES (
                        NEW.id,
                        'ENTRY',
                        jsonb_build_object(
                            'slotId', NEW.slot_id,
                            'vehicleNumber', NEW.vehicle_number,
                            'entryTime', NEW.entry_time
                        )
                    );
                END IF;
            END IF;

            RETURN NEW;
        END;
        $$
    `);

    await pool.query(`
        DROP TRIGGER IF EXISTS trg_parking_ticket_state ON parking_tickets
    `);

    await pool.query(`
        CREATE TRIGGER trg_parking_ticket_state
        AFTER UPDATE OF status ON parking_tickets
        FOR EACH ROW
        EXECUTE FUNCTION sync_parking_ticket_state()
    `);

    await pool.query(`
        CREATE OR REPLACE PROCEDURE close_parking_ticket(
            p_ticket_id INTEGER,
            p_payment_method TEXT DEFAULT 'cash'
        )
        LANGUAGE plpgsql
        AS $$
        DECLARE
            ticket_record RECORD;
            calculated_fee NUMERIC(10, 2);
        BEGIN
            SELECT *
            INTO ticket_record
            FROM parking_tickets
            WHERE id = p_ticket_id AND status = 'active'
            FOR UPDATE;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Active ticket % not found', p_ticket_id;
            END IF;

            calculated_fee := calculate_parking_fee(
                ticket_record.vehicle_type,
                ticket_record.entry_time,
                NOW()
            );

            UPDATE parking_tickets
            SET exit_time = NOW(),
                fee = calculated_fee,
                status = 'closed'
            WHERE id = ticket_record.id;

            INSERT INTO payments (ticket_id, amount, payment_method, payment_status)
            VALUES (ticket_record.id, calculated_fee, p_payment_method, 'paid')
            ON CONFLICT (ticket_id)
            DO UPDATE SET
                amount = EXCLUDED.amount,
                payment_method = EXCLUDED.payment_method,
                payment_status = EXCLUDED.payment_status,
                paid_at = NOW();
        END;
        $$
    `);

    await pool.query(`
        CREATE OR REPLACE FUNCTION get_recent_ticket_summary(p_limit INTEGER DEFAULT 10)
        RETURNS TABLE (
            ticket_id INTEGER,
            vehicle_number TEXT,
            vehicle_type TEXT,
            slot_number TEXT,
            entry_time TIMESTAMPTZ,
            exit_time TIMESTAMPTZ,
            fee NUMERIC(10, 2),
            status TEXT
        )
        LANGUAGE plpgsql
        AS $$
        DECLARE
            ticket_cursor CURSOR FOR
                SELECT t.id,
                       t.vehicle_number,
                       t.vehicle_type,
                       s.slot_number,
                       t.entry_time,
                       t.exit_time,
                       t.fee,
                       t.status
                FROM parking_tickets t
                INNER JOIN parking_slots s ON s.id = t.slot_id
                ORDER BY t.entry_time DESC
                LIMIT p_limit;
            ticket_row RECORD;
        BEGIN
            OPEN ticket_cursor;

            LOOP
                FETCH ticket_cursor INTO ticket_row;
                EXIT WHEN NOT FOUND;

                ticket_id := ticket_row.id;
                vehicle_number := ticket_row.vehicle_number;
                vehicle_type := ticket_row.vehicle_type;
                slot_number := ticket_row.slot_number;
                entry_time := ticket_row.entry_time;
                exit_time := ticket_row.exit_time;
                fee := ticket_row.fee;
                status := ticket_row.status;

                RETURN NEXT;
            END LOOP;

            CLOSE ticket_cursor;
        END;
        $$
    `);
}
