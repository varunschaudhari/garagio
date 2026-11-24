-- Mechanics who never open the app: no login ID and no password (they are given jobs and paid).
ALTER TABLE users MODIFY username VARCHAR(50) NULL, MODIFY password_hash VARCHAR(255) NULL;
