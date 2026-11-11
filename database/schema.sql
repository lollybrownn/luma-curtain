CREATE DATABASE IF NOT EXISTS lumacurtain CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE lumacurtain;
CREATE TABLE IF NOT EXISTS app_users (
 id CHAR(36) PRIMARY KEY, name VARCHAR(80) NOT NULL, email VARCHAR(191) NOT NULL, password_hash VARCHAR(255) NOT NULL,
 role ENUM('member','admin') NOT NULL DEFAULT 'member', status ENUM('active','disabled') NOT NULL DEFAULT 'active', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), UNIQUE KEY uq_users_email(email)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS devices (
 id CHAR(36) PRIMARY KEY, device_id VARCHAR(64) NOT NULL, name VARCHAR(80) NOT NULL, owner_id CHAR(36) NULL,
 pairing_code_hash VARCHAR(255) NOT NULL, mqtt_password_hash VARCHAR(255) NOT NULL, last_seen_at DATETIME(3) NULL, firmware_version VARCHAR(40) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_devices_device_id(device_id), KEY idx_devices_owner(owner_id), KEY idx_devices_seen(last_seen_at), CONSTRAINT fk_devices_owner FOREIGN KEY(owner_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS curtain_settings (
 id CHAR(36) PRIMARY KEY, owner_id CHAR(36) NULL, device_id CHAR(36) NULL, device_name VARCHAR(80) NOT NULL DEFAULT 'Tirai Kamar Utama',
 mode ENUM('auto','manual') NOT NULL DEFAULT 'manual', open_time TIME NOT NULL DEFAULT '06:00:00', close_time TIME NOT NULL DEFAULT '18:00:00',
 light_threshold SMALLINT UNSIGNED NOT NULL DEFAULT 1500, manual_target TINYINT UNSIGNED NOT NULL DEFAULT 0, telegram_notifications BOOLEAN NOT NULL DEFAULT FALSE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_settings_owner(owner_id), KEY idx_settings_device(device_id),
 CONSTRAINT chk_settings_light CHECK(light_threshold BETWEEN 0 AND 4095), CONSTRAINT chk_settings_target CHECK(manual_target BETWEEN 0 AND 100),

 CONSTRAINT fk_settings_owner FOREIGN KEY(owner_id) REFERENCES app_users(id) ON DELETE SET NULL, CONSTRAINT fk_settings_device FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS sensor_readings (
 id CHAR(36) PRIMARY KEY, owner_id CHAR(36) NULL, device_id CHAR(36) NULL, reading_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 light SMALLINT UNSIGNED NULL, distance_cm DECIMAL(8,2) NULL, position ENUM('open','closed','between','unknown') NOT NULL DEFAULT 'unknown',
 moving BOOLEAN NOT NULL DEFAULT FALSE, limit_open BOOLEAN NOT NULL DEFAULT FALSE, limit_closed BOOLEAN NOT NULL DEFAULT FALSE, source ENUM('esp32','simulator') NOT NULL DEFAULT 'esp32',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 KEY idx_readings_owner_time(owner_id,reading_at), KEY idx_readings_device_time(device_id,reading_at),
 CONSTRAINT chk_reading_light CHECK(light IS NULL OR light BETWEEN 0 AND 4095), CONSTRAINT chk_reading_distance CHECK(distance_cm IS NULL OR distance_cm >= 0),
 CONSTRAINT fk_readings_owner FOREIGN KEY(owner_id) REFERENCES app_users(id) ON DELETE SET NULL, CONSTRAINT fk_readings_device FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS curtain_events (
 id CHAR(36) PRIMARY KEY, owner_id CHAR(36) NULL, device_id CHAR(36) NULL, occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 event_type ENUM('settings_updated','open_command','close_command','position_command','movement_completed','device_online','device_offline') NOT NULL,
 mode ENUM('auto','manual') NULL, target_position TINYINT UNSIGNED NULL, message VARCHAR(240) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 KEY idx_events_owner_time(owner_id,occurred_at), KEY idx_events_device_time(device_id,occurred_at), CONSTRAINT chk_event_target CHECK(target_position IS NULL OR target_position BETWEEN 0 AND 100),
 CONSTRAINT fk_events_owner FOREIGN KEY(owner_id) REFERENCES app_users(id) ON DELETE SET NULL, CONSTRAINT fk_events_device FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_audit_logs (
 id CHAR(36) PRIMARY KEY, admin_id CHAR(36) NULL, action VARCHAR(80) NOT NULL, target_type VARCHAR(40) NOT NULL, target_id VARCHAR(64) NULL,
 details JSON NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), KEY idx_audit_created(created_at), KEY idx_audit_admin(admin_id),
 CONSTRAINT fk_audit_admin FOREIGN KEY(admin_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
