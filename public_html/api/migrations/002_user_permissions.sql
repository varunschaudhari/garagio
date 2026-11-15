-- Per-person permissions: the owner ticks / unticks abilities on top of each user's role defaults.
-- JSON object {"make_bills": false, ...}; NULL = role defaults only.
ALTER TABLE users ADD COLUMN permissions TEXT NULL AFTER role;
