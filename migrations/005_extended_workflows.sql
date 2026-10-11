BEGIN;
ALTER TABLE leave_request_days ADD COLUMN start_work_minute INTEGER NOT NULL DEFAULT 0 CHECK(start_work_minute>=0);
ALTER TABLE leave_request_days ADD COLUMN end_work_minute INTEGER NOT NULL DEFAULT 480 CHECK(end_work_minute>start_work_minute);
CREATE TABLE announcement_company_activity (
 announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 view_count INTEGER NOT NULL DEFAULT 0 CHECK(view_count>=0),
 last_viewed_at TEXT,
 PRIMARY KEY(announcement_id,organization_id,user_id)
);
INSERT INTO announcement_company_activity(announcement_id,organization_id,user_id,view_count,last_viewed_at)
 SELECT a.id,a.organization_id,ac.user_id,ac.view_count,ac.last_viewed_at FROM announcements a JOIN announcement_user_activity ac ON ac.announcement_id=a.id WHERE a.organization_id IS NOT NULL;
INSERT INTO schema_migrations(version) VALUES('005_extended_workflows');
COMMIT;
