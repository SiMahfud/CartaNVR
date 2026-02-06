# Database Schema

This project uses SQLite by default (`nvr.db`) and supports MySQL/MariaDB.

## Tables

### `users`
Stores user credentials for authentication.
- `id`: (INT) Primary Key, Auto-increment.
- `username`: (TEXT/VARCHAR) Unique username.
- `password`: (TEXT/VARCHAR) BCrypt hashed password.

### `storages`
Defines storage locations for camera recordings.
- `id`: (INT) Primary Key, Auto-increment.
- `name`: (TEXT/VARCHAR) Human-readable name for the storage.
- `path`: (TEXT/VARCHAR) Absolute path to the storage directory.
- `max_gb`: (INT) Maximum storage capacity in Gigabytes.

### `cameras`
Stores configuration for connected IP cameras.
- `id`: (INT) Primary Key, Auto-increment.
- `name`: (TEXT/VARCHAR) Human-readable name for the camera.
- `ip_address`: (TEXT/VARCHAR) IP address of the camera.
- `rtsp_url`: (TEXT/VARCHAR) The RTSP stream URL.
- `storage_id`: (INT) Foreign Key to `storages.id`.
- `status`: (TEXT/VARCHAR) Current status (e.g., 'online', 'offline'). Default: 'offline'.
- `is_hevc`: (BOOLEAN/TINYINT) Flag indicating if the stream uses HEVC (H.265) encoding.

### `recordings`
Stores metadata for recorded video segments.
- `id`: (INT) Primary Key, Auto-increment.
- `camera_id`: (INT) Foreign Key to `cameras.id`.
- `file_path`: (TEXT/VARCHAR) Unique path to the recorded video file.
- `timestamp`: (BIGINT) Unix timestamp of the recording start.
- `duration`: (FLOAT) Duration of the segment in seconds.

### `sessions`
Used by `express-session` and `connect-sqlite3` to store user sessions.
- `sid`: (TEXT) Session ID, Primary Key.
- `expired`: (DATETIME) Expiration date.
- `sess`: (JSON/TEXT) Serialized session data.

## Indexes
- `idx_recordings_timestamp` on `recordings(timestamp)`
- `idx_recordings_camera_id` on `recordings(camera_id)`
