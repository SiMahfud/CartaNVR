# Implementation Plan: Fix Settings Save and Database Sync

## Phase 1: Backend API Enhancement [checkpoint: completed]
- [x] Task: Consolidate Settings API in `routes/api/system.js`.
    - [x] Write Tests: Update `test/api_settings.test.js` to include general settings (port, paths) alongside logging toggles.
    - [x] Implement: Modify the POST `/api/system/settings` handler to accept and store general configuration keys in the `settings` table.
- [x] Task: Implement a "Reload Settings" hook.
    - [x] Write Tests: Verify that updating a setting in the DB triggers a refresh in a mockable component (e.g., the Logger).
    - [x] Implement: Add logic to `lib/database.js` or `lib/database.js` to notify active modules when the `settings` table is updated.
- [x] Task: Conductor - User Manual Verification 'Phase 1: Backend API Enhancement' (Protocol in workflow.md)

## Phase 2: Frontend Redirection [checkpoint: completed]
- [x] Task: Refactor "Save All Settings" logic in `public/settings.html`.
    - [x] Implement: Identify the "Save" button click handler in the frontend JS.
    - [x] Implement: Update the handler to gather all form data (General and Logging) and send it via a `POST` request to `/api/system/settings`.
- [x] Task: Improve UI Feedback.
    - [x] Implement: Add a success/failure notification (alert or toast) to the settings save process.
- [x] Task: Conductor - User Manual Verification 'Phase 2: Frontend Redirection' (Protocol in workflow.md)

## Phase 3: Logic Synchronization & Cleanup [checkpoint: completed]
- [x] Task: Update App Components to prioritize Database Settings.
    - [x] Write Tests: Verify `lib/logger.js` and `lib/storage.js` read directly from the database or a synchronized cache.
    - [x] Implement: Ensure `lib/config.js` (if used) acts as a proxy to the database rather than reading from `config.json`.
- [x] Task: Deprecate `config.json` reliance.
    - [x] Implement: Remove or comment out file-writing logic that targets `config.json` in favor of database updates.
- [x] Task: Conductor - User Manual Verification 'Phase 3: Logic Synchronization & Cleanup' (Protocol in workflow.md)

## Phase 4: Final Verification
- [x] Task: End-to-end verification of settings persistence. 39eb5b3
- [x] Task: Verify settings survive application restart. 39eb5b3
- [~] Task: Conductor - User Manual Verification 'Phase 4: Final Verification' (Protocol in workflow.md)
