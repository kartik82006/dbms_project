import type { Express } from 'express';
import { pool } from '../../db/index.js';

export function registerParkingRoutes(app: Express): void {
    app.get('/api/slots', async (_req, res) => {
        const result = await pool.query(
            `SELECT id, slot_number, vehicle_type, is_occupied
             FROM parking_slots
             ORDER BY vehicle_type, slot_number`
        );

        res.status(200).json(result.rows);
    });

    app.get('/api/rates', async (_req, res) => {
        const result = await pool.query(
            `SELECT vehicle_type, hourly_rate, updated_at
             FROM parking_rates
             ORDER BY vehicle_type`
        );

        res.status(200).json(result.rows);
    });

    app.put('/api/rates/:vehicleType', async (req, res) => {
        const vehicleType = String(req.params.vehicleType ?? '').trim().toLowerCase();
        const hourlyRate = Number(req.body?.hourlyRate);

        if (vehicleType !== 'bike' && vehicleType !== 'car') {
            res.status(400).json({ error: "vehicleType must be 'bike' or 'car'" });
            return;
        }

        if (!Number.isFinite(hourlyRate) || hourlyRate < 0) {
            res.status(400).json({ error: 'hourlyRate must be a non-negative number' });
            return;
        }

        const result = await pool.query(
            `INSERT INTO parking_rates (vehicle_type, hourly_rate)
             VALUES ($1, $2)
             ON CONFLICT (vehicle_type)
             DO UPDATE SET hourly_rate = EXCLUDED.hourly_rate, updated_at = NOW()
             RETURNING vehicle_type, hourly_rate, updated_at`,
            [vehicleType, hourlyRate]
        );

        res.status(200).json(result.rows[0]);
    });

    app.post('/api/owners', async (req, res) => {
        const fullName = String(req.body?.fullName ?? '').trim();
        const phoneNumber = String(req.body?.phoneNumber ?? '').trim();

        if (!fullName || !phoneNumber) {
            res.status(400).json({ error: 'fullName and phoneNumber are required' });
            return;
        }

        const result = await pool.query(
            `INSERT INTO vehicle_owners (full_name, phone_number)
             VALUES ($1, $2)
             ON CONFLICT (phone_number)
             DO UPDATE SET full_name = EXCLUDED.full_name
             RETURNING id, full_name, phone_number`,
            [fullName, phoneNumber]
        );

        res.status(201).json(result.rows[0]);
    });

    app.get('/api/vehicles/search', async (req, res) => {
        const queryText = String(req.query.q ?? '').trim();

        if (!queryText) {
            res.status(200).json({ vehicles: [] });
            return;
        }

        const result = await pool.query<{
            owner_id: number | null;
            full_name: string;
            phone_number: string;
            vehicle_id: number;
            vehicle_number: string;
            vehicle_type: 'bike' | 'car';
        }>(
            `SELECT v.id AS vehicle_id,
                    v.vehicle_number,
                    v.vehicle_type,
                    o.id AS owner_id,
                    COALESCE(o.full_name, '') AS full_name,
                    COALESCE(o.phone_number, '') AS phone_number
             FROM vehicles v
             LEFT JOIN vehicle_owners o ON o.id = v.owner_id
             WHERE v.vehicle_number ILIKE $1
             ORDER BY v.vehicle_number ASC
             LIMIT 20`,
            [`%${queryText}%`]
        );

        res.status(200).json({
            vehicles: result.rows.map((row) => ({
                vehicleId: row.vehicle_id,
                vehicleNumber: row.vehicle_number,
                vehicleType: row.vehicle_type,
                ownerId: row.owner_id,
                fullName: row.full_name,
                phoneNumber: row.phone_number,
            })),
        });
    });

    app.post('/api/parking/entry', async (req, res) => {
        const fullName = String(req.body?.fullName ?? '').trim();
        const phoneNumber = String(req.body?.phoneNumber ?? '').trim();
        const vehicleNumber = String(req.body?.vehicleNumber ?? '').trim().toUpperCase();
        const vehicleType = String(req.body?.vehicleType ?? '').trim().toLowerCase();

        if (!fullName || !phoneNumber || !vehicleNumber) {
            res.status(400).json({ error: 'fullName, phoneNumber and vehicleNumber are required' });
            return;
        }

        if (vehicleType !== 'bike' && vehicleType !== 'car') {
            res.status(400).json({ error: "vehicleType must be 'bike' or 'car'" });
            return;
        }

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const ownerResult = await client.query<{ id: number; full_name: string; phone_number: string }>(
                `INSERT INTO vehicle_owners (full_name, phone_number)
                 VALUES ($1, $2)
                 ON CONFLICT (phone_number)
                 DO UPDATE SET full_name = EXCLUDED.full_name
                 RETURNING id, full_name, phone_number`,
                [fullName, phoneNumber]
            );

            const owner = ownerResult.rows[0];

            if (!owner) {
                await client.query('ROLLBACK');
                res.status(500).json({ error: 'Could not create or fetch owner record' });
                return;
            }

            const vehicleResult = await client.query<{ id: number; vehicle_number: string; vehicle_type: 'bike' | 'car' }>(
                `INSERT INTO vehicles (vehicle_number, vehicle_type, owner_id)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (vehicle_number)
                 DO UPDATE SET vehicle_type = EXCLUDED.vehicle_type, owner_id = EXCLUDED.owner_id
                 RETURNING id, vehicle_number, vehicle_type`,
                [vehicleNumber, vehicleType, owner.id]
            );

            const vehicle = vehicleResult.rows[0];

            if (!vehicle) {
                await client.query('ROLLBACK');
                res.status(500).json({ error: 'Could not create or fetch vehicle record' });
                return;
            }

            const activeTicketResult = await client.query<{ id: number; slot_number: string }>(
                `SELECT t.id, s.slot_number
                 FROM parking_tickets t
                 INNER JOIN parking_slots s ON s.id = t.slot_id
                 WHERE t.vehicle_number = $1 AND t.status = 'active'
                 LIMIT 1`,
                [vehicle.vehicle_number]
            );

            const existingActiveTicket = activeTicketResult.rows[0];

            if (existingActiveTicket) {
                await client.query('ROLLBACK');
                res.status(409).json({
                    error: 'This vehicle is already parked',
                    ticketId: existingActiveTicket.id,
                    slot: existingActiveTicket.slot_number,
                });
                return;
            }

            const slotResult = await client.query<{ id: number; slot_number: string }>(
                `SELECT id, slot_number
                 FROM parking_slots
                 WHERE vehicle_type = $1 AND is_occupied = FALSE
                 ORDER BY slot_number
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED`,
                [vehicle.vehicle_type]
            );

            const slot = slotResult.rows[0];

            if (!slot) {
                await client.query('ROLLBACK');
                res.status(409).json({ error: `No free ${vehicle.vehicle_type} slots available` });
                return;
            }

            await client.query('UPDATE parking_slots SET is_occupied = TRUE WHERE id = $1', [slot.id]);

            const rateResult = await client.query<{ hourly_rate: string }>(
                `SELECT hourly_rate
                 FROM parking_rates
                 WHERE vehicle_type = $1`,
                [vehicle.vehicle_type]
            );

            const hourlyRate = Number(rateResult.rows[0]?.hourly_rate ?? (vehicle.vehicle_type === 'bike' ? 20 : 40));

            const ticketResult = await client.query<{
                id: number;
                vehicle_number: string;
                vehicle_type: 'bike' | 'car';
                slot_id: number;
                entry_time: string;
            }>(
                `INSERT INTO parking_tickets (vehicle_number, vehicle_type, vehicle_id, slot_id, rate_per_hour)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id, vehicle_number, vehicle_type, slot_id, entry_time`,
                [vehicle.vehicle_number, vehicle.vehicle_type, vehicle.id, slot.id, hourlyRate]
            );

            await client.query(
                `INSERT INTO parking_activity_logs (ticket_id, action, details)
                 VALUES ($1, 'ENTRY', $2::jsonb)`,
                [
                    ticketResult.rows[0]?.id,
                    JSON.stringify({
                        ownerId: owner.id,
                        ownerName: owner.full_name,
                        phoneNumber: owner.phone_number,
                        vehicleNumber: vehicle.vehicle_number,
                        vehicleType: vehicle.vehicle_type,
                        slotNumber: slot.slot_number,
                        ratePerHour: hourlyRate,
                    }),
                ]
            );

            await client.query('COMMIT');

            res.status(201).json({
                message: 'Vehicle parked successfully',
                owner: {
                    id: owner.id,
                    fullName: owner.full_name,
                    phoneNumber: owner.phone_number,
                },
                vehicle,
                ticket: ticketResult.rows[0],
                slot: slot.slot_number,
            });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    });

    app.post('/api/vehicles/register', async (req, res) => {
        const vehicleNumber = String(req.body?.vehicleNumber ?? '').trim().toUpperCase();
        const vehicleType = String(req.body?.vehicleType ?? '').trim().toLowerCase();
        const ownerPhoneNumber = String(req.body?.ownerPhoneNumber ?? '').trim();

        if (!vehicleNumber || !ownerPhoneNumber) {
            res.status(400).json({ error: 'vehicleNumber and ownerPhoneNumber are required' });
            return;
        }

        if (vehicleType !== 'bike' && vehicleType !== 'car') {
            res.status(400).json({ error: "vehicleType must be 'bike' or 'car'" });
            return;
        }

        const ownerResult = await pool.query<{ id: number }>(
            `SELECT id
             FROM vehicle_owners
             WHERE phone_number = $1`,
            [ownerPhoneNumber]
        );

        const owner = ownerResult.rows[0];

        if (!owner) {
            res.status(404).json({ error: 'Owner not found. Create owner first.' });
            return;
        }

        const result = await pool.query(
            `INSERT INTO vehicles (vehicle_number, vehicle_type, owner_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (vehicle_number)
             DO UPDATE SET vehicle_type = EXCLUDED.vehicle_type, owner_id = EXCLUDED.owner_id
             RETURNING id, vehicle_number, vehicle_type, owner_id`,
            [vehicleNumber, vehicleType, owner.id]
        );

        res.status(201).json(result.rows[0]);
    });

    app.get('/api/tickets/active', async (_req, res) => {
        const result = await pool.query(
            `SELECT t.id,
                    t.vehicle_number,
                    t.vehicle_type,
                    t.entry_time,
                    s.slot_number,
                    o.full_name AS owner_name,
                    o.phone_number AS owner_phone
             FROM parking_tickets t
             INNER JOIN parking_slots s ON s.id = t.slot_id
             LEFT JOIN vehicles v ON v.id = t.vehicle_id
             LEFT JOIN vehicle_owners o ON o.id = v.owner_id
             WHERE t.status = 'active'
             ORDER BY t.entry_time ASC`
        );

        res.status(200).json(result.rows);
    });

    app.post('/api/park', async (req, res) => {
        const vehicleNumber = String(req.body?.vehicleNumber ?? '').trim().toUpperCase();
        const vehicleType = String(req.body?.vehicleType ?? '').trim().toLowerCase();

        if (!vehicleNumber) {
            res.status(400).json({ error: 'vehicleNumber is required' });
            return;
        }

        if (vehicleType !== 'bike' && vehicleType !== 'car') {
            res.status(400).json({ error: "vehicleType must be 'bike' or 'car'" });
            return;
        }

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const slotResult = await client.query<{
                id: number;
                slot_number: string;
            }>(
                `SELECT id, slot_number
                 FROM parking_slots
                 WHERE vehicle_type = $1 AND is_occupied = FALSE
                 ORDER BY slot_number
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED`,
                [vehicleType]
            );

            const slot = slotResult.rows[0];

            if (!slot) {
                await client.query('ROLLBACK');
                res.status(409).json({ error: `No free ${vehicleType} slots available` });
                return;
            }

            await client.query('UPDATE parking_slots SET is_occupied = TRUE WHERE id = $1', [slot.id]);

            const vehicleResult = await client.query<{ id: number }>(
                `SELECT id
                 FROM vehicles
                 WHERE vehicle_number = $1`,
                [vehicleNumber]
            );

            const vehicle = vehicleResult.rows[0];

            const rateResult = await client.query<{ hourly_rate: string }>(
                `SELECT hourly_rate
                 FROM parking_rates
                 WHERE vehicle_type = $1`,
                [vehicleType]
            );

            const hourlyRate = Number(rateResult.rows[0]?.hourly_rate ?? (vehicleType === 'bike' ? 20 : 40));

            const ticketResult = await client.query<{
                id: number;
                vehicle_number: string;
                vehicle_type: string;
                slot_id: number;
                entry_time: string;
                rate_per_hour: string;
            }>(
                `INSERT INTO parking_tickets (vehicle_number, vehicle_type, vehicle_id, slot_id, rate_per_hour)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id, vehicle_number, vehicle_type, slot_id, entry_time, rate_per_hour`,
                [vehicleNumber, vehicleType, vehicle?.id ?? null, slot.id, hourlyRate]
            );

            await client.query(
                `INSERT INTO parking_activity_logs (ticket_id, action, details)
                 VALUES ($1, 'ENTRY', $2::jsonb)`,
                [
                    ticketResult.rows[0]?.id,
                    JSON.stringify({ vehicleNumber, vehicleType, slotNumber: slot.slot_number, ratePerHour: hourlyRate }),
                ]
            );

            await client.query('COMMIT');

            res.status(201).json({
                message: 'Vehicle parked successfully',
                ticket: ticketResult.rows[0],
                slot: slot.slot_number,
            });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    });

    app.post('/api/exit/:ticketId', async (req, res) => {
        const ticketId = Number(req.params.ticketId);
        const paymentMethod = String(req.body?.paymentMethod ?? 'cash').trim().toLowerCase();

        if (!Number.isInteger(ticketId) || ticketId <= 0) {
            res.status(400).json({ error: 'ticketId must be a positive integer' });
            return;
        }

        if (!['cash', 'upi', 'card'].includes(paymentMethod)) {
            res.status(400).json({ error: "paymentMethod must be 'cash', 'upi', or 'card'" });
            return;
        }

        try {
            const ticketCheckResult = await pool.query<{ id: number; status: 'active' | 'closed' }>(
                `SELECT id, status
                 FROM parking_tickets
                 WHERE id = $1`,
                [ticketId]
            );

            const existingTicket = ticketCheckResult.rows[0];

            if (!existingTicket) {
                res.status(404).json({ error: 'Ticket ID not found' });
                return;
            }

            if (existingTicket.status !== 'active') {
                res.status(409).json({ error: 'Ticket is already closed' });
                return;
            }

            await pool.query('CALL close_parking_ticket($1, $2)', [ticketId, paymentMethod]);

            const result = await pool.query<{
                ticket_id: number;
                vehicle_number: string;
                entry_time: string;
                exit_time: string | null;
                fee: string | null;
                payment_status: string | null;
            }>(
                `SELECT t.id AS ticket_id,
                        t.vehicle_number,
                        t.entry_time,
                        t.exit_time,
                        t.fee,
                        p.payment_status
                 FROM parking_tickets t
                 LEFT JOIN payments p ON p.ticket_id = t.id
                 WHERE t.id = $1`,
                [ticketId]
            );

            const ticket = result.rows[0];

            if (!ticket) {
                res.status(404).json({ error: 'Ticket not found after closing' });
                return;
            }

            res.status(200).json({
                message: 'Vehicle exited successfully',
                ticketId: ticket.ticket_id,
                vehicleNumber: ticket.vehicle_number,
                entryTime: ticket.entry_time,
                exitTime: ticket.exit_time,
                fee: ticket.fee,
                paymentStatus: ticket.payment_status,
            });
        } catch (error) {
            throw error;
        }
    });

    app.get('/api/fees/preview', async (req, res) => {
        const vehicleType = String(req.query.vehicleType ?? '').trim().toLowerCase();
        const entryTime = String(req.query.entryTime ?? '').trim();
        const exitTime = String(req.query.exitTime ?? '').trim();

        if (vehicleType !== 'bike' && vehicleType !== 'car') {
            res.status(400).json({ error: "vehicleType must be 'bike' or 'car'" });
            return;
        }

        if (!entryTime || !exitTime) {
            res.status(400).json({ error: 'entryTime and exitTime are required' });
            return;
        }

        const result = await pool.query<{ fee: string }>(
            `SELECT calculate_parking_fee($1, $2::timestamptz, $3::timestamptz) AS fee`,
            [vehicleType, entryTime, exitTime]
        );

        res.status(200).json({ fee: result.rows[0]?.fee ?? '0.00' });
    });

    app.get('/api/reports/recent', async (req, res) => {
        const limit = Number(req.query.limit ?? 10);

        if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
            res.status(400).json({ error: 'limit must be an integer between 1 and 100' });
            return;
        }

        const result = await pool.query(
            `SELECT *
             FROM get_recent_ticket_summary($1)` ,
            [limit]
        );

        res.status(200).json(result.rows);
    });

    app.get('/api/payments', async (_req, res) => {
        const result = await pool.query(
            `SELECT p.id,
                    p.ticket_id,
                    p.amount,
                    p.payment_method,
                    p.payment_status,
                    p.paid_at,
                    t.vehicle_number,
                    t.entry_time,
                    t.exit_time
             FROM payments p
             INNER JOIN parking_tickets t ON t.id = p.ticket_id
             ORDER BY p.paid_at DESC`
        );

        res.status(200).json(result.rows);
    });

    app.get('/api/logs', async (_req, res) => {
        const result = await pool.query(
            `SELECT id, ticket_id, action, details, created_at
             FROM parking_activity_logs
             ORDER BY created_at DESC
             LIMIT 100`
        );

        res.status(200).json(result.rows);
    });
}
