-- Parts from an approved estimate sit on the job as "planned" lines (issued = 0): they are billed at the
-- estimate price and leave stock when the bill is finalised. Parts issued by the store have issued = 1.
ALTER TABLE job_parts ADD COLUMN issued TINYINT(1) NOT NULL DEFAULT 1 AFTER returned_qty;
