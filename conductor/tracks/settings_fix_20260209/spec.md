# Specification: Fix Settings Save and Database Sync

## Overview
The "Save All Settings" button in the Settings UI currently fails to update the MySQL/SQLite database. While it may update a legacy `config.json` file, these changes do not take effect in the application because the system now relies on database-backed settings for its operations. This track will redirect the save logic to use the database and ensure the application state is updated accordingly.

## Functional Requirements
1.  **Consolidated Save Logic:** The "Save All Settings" button in `public/settings.html` must be updated to send a single request (or a series of coordinated requests) to the database-backed settings API.
2.  **Database Persistence:** All general settings (e.g., Server Port, Recording Paths) and logging toggles must be persisted to the `settings` table in the database.
3.  **App State Sync:** Ensure that once settings are saved to the database, the running application instances (e.g., the logger, the server port configuration, recorder logic) reflect these changes without requiring a manual restart where possible.
4.  **Legacy Cleanup:** Deprecate or remove the reliance on `config.json` for settings that are now managed via the database to prevent "split-brain" configuration issues.

## Non-Functional Requirements
- **Feedback UI:** Provide immediate visual feedback (e.g., a "Settings Saved" toast or alert) upon successful database update.
- **Error Handling:** If the database update fails (e.g., connection issue), the UI must display a clear error message.

## Acceptance Criteria
- [ ] Clicking "Save All Settings" updates the `settings` table in MySQL/SQLite.
- [ ] Values in the UI match the values in the database after a page refresh.
- [ ] Logging toggles updated via "Save All Settings" immediately affect terminal output.
- [ ] No errors are thrown in the browser console or server terminal during the save process.

## Out of Scope
- Migrating sensitive credentials (like DB passwords) if they are currently handled via `.env`.
- Significant UI redesign of the settings page.
