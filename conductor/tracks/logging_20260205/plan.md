# Implementation Plan: Configurable Terminal Logging

## Phase 1: Database and Backend Support [checkpoint: completed]
- [x] Task: Create `settings` table in `lib/database.js`. [completed]
    - [x] Write Tests: Create `test/database_settings.test.js` to verify table creation and CRUD for settings.
    - [x] Implement: Update `lib/database.js` with `settings` table and helper functions (`getSetting`, `setSetting`).
- [x] Task: Implement a centralized logging utility in `lib/logger.js`. [completed]
    - [x] Write Tests: Create `test/logger.test.js` to verify conditional logging based on settings.
    - [x] Implement: Create `lib/logger.js` that checks database settings before printing to terminal.
- [x] Task: Conductor - User Manual Verification 'Database and Backend Support' (Protocol in workflow.md) [completed]

## Phase 2: Integration [checkpoint: completed]
- [x] Task: Refactor existing logs to use the new logging utility. [completed]
    - [x] Write Tests: Update relevant tests to ensure logs can be suppressed. [completed]
    - [x] Implement: Replace `console.log` in `server.js`, `recorder.js`, `lib/storage.js`, etc., with `logger.log(category, message)`. [completed]
- [x] Task: Create API endpoints for settings management. [completed]
    - [x] Write Tests: Create `test/api_settings.test.js` for GET/POST `/api/settings`. [completed]
    - [x] Implement: Create `routes/api/settings.js` and register in `routes/api/index.js`. [completed] (Note: added to system.js)
- [x] Task: Conductor - User Manual Verification 'Integration' (Protocol in workflow.md) [completed]

## Phase 3: Frontend Implementation [checkpoint: completed]
- [x] Task: Add logging toggles to the Settings UI. [completed]
    - [x] Implement: Update `public/settings.html` (or relevant frontend file) to include switches for General, Recorder, and Storage logs. [completed]
    - [x] Implement: Add JavaScript logic to fetch and update these settings via the API. [completed]
- [x] Task: Conductor - User Manual Verification 'Frontend Implementation' (Protocol in workflow.md) [completed]
