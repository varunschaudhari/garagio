# Database migrations

Changes to the database after the first release go here as numbered files, applied in name order by
`api/cron/migrate.php` (the deploy script runs it after copying the code; it can also be run by hand):

    001_short_description.sql
    002_...

Rules:

- One file per change, never edited after it has been deployed. Statements end with `;` at the end of a line.
- Make the same change in `database/schema.sql` (fresh installs) and add
  `INSERT INTO schema_migrations (name, applied_at) VALUES ('001_short_description.sql', NOW());` there,
  so a new install does not run it again.
- Applied files are listed in the `schema_migrations` table. Settings → System shows any that are pending.

There are no migrations yet.
