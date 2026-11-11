USE lumacurtain;
ALTER TABLE app_users MODIFY COLUMN role ENUM('member','admin') NOT NULL DEFAULT 'member';
ALTER TABLE app_users ADD COLUMN status ENUM('active','disabled') NOT NULL DEFAULT 'active' AFTER role;
CREATE TABLE admin_audit_logs (
 id CHAR(36) PRIMARY KEY, admin_id CHAR(36) NULL, action VARCHAR(80) NOT NULL, target_type VARCHAR(40) NOT NULL, target_id VARCHAR(64) NULL,
 details JSON NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), KEY idx_audit_created(created_at), KEY idx_audit_admin(admin_id),
 CONSTRAINT fk_audit_admin FOREIGN KEY(admin_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
