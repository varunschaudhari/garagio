-- Parts typed on an estimate (not from the catalogue) reach the bill as job lines of kind 'part':
-- billed at the estimate price with the parts GST rate; no stock movement. Labour lines keep kind 'labour'.
ALTER TABLE job_labour ADD COLUMN item_kind VARCHAR(10) NOT NULL DEFAULT 'labour' AFTER labour_rate_id;
ALTER TABLE job_labour ADD COLUMN qty DECIMAL(10,2) NOT NULL DEFAULT 1 AFTER item_kind;
