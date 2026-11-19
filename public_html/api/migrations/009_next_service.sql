-- "Next servicing due" on the job card (date and / or km, whichever comes first), copied to the bike on delivery
-- and used by the service reminders. Empty = job date + service_reminder_days, job km + service_reminder_km.
ALTER TABLE job_cards ADD COLUMN next_service_on DATE NULL AFTER promised_at, ADD COLUMN next_service_km INT NULL AFTER next_service_on;
ALTER TABLE vehicles ADD COLUMN next_service_on DATE NULL AFTER last_service_odometer, ADD COLUMN next_service_km INT NULL AFTER next_service_on;
