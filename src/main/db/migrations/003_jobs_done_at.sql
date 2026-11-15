ALTER TABLE jobs ADD COLUMN done_at INTEGER;
UPDATE jobs SET done_at = run_at WHERE done = 1;
