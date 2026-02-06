# Implementation Plan: Camera Enable/Disable Toggle

## Phase 1: Database Schema Update [checkpoint: 7ccc7a1]
- [x] Task: Create a migration script or update the database initialization to add the `enabled` column to the `cameras` table. 097d6b4
    - [x] Add `enabled` (TINYINT/BOOLEAN) column to `cameras` table with default value `1` (true).
    - [x] Update `lib/database.js` initialization logic to ensure the column exists.
- [x] Task: Conductor - User Manual Verification 'Phase 1: Database Schema Update' (Protocol in workflow.md)

## Phase 2: API & Backend Logic [checkpoint: 56dd2ad]
- [x] Task: Update the Camera API to handle the `enabled` field. 74f879f
    - [x] Modify `routes/api/cameras.js` to include the `enabled` field in GET requests.
    - [x] Update the PUT/POST routes in `routes/api/cameras.js` to accept and save the `enabled` state.
- [x] Task: Update Recorder logic to respect the `enabled` flag. 74f879f
    - [x] Modify `recorder.js` to only start recordings for cameras where `enabled` is true.
    - [x] Update `lib/ffmpeg-manager.js` (or wherever processes are managed) to provide a clean way to stop all processes for a specific camera ID.
- [x] Task: Implement dynamic process control. 74f879f
    - [x] In the API route for updating a camera, if the `enabled` state changes:
        - [x] If changed to `false`, trigger the shutdown of recording and streaming for that camera.
        - [x] If changed to `true`, trigger the startup of recording for that camera.
- [x] Task: Conductor - User Manual Verification 'Phase 2: API & Backend Logic' (Protocol in workflow.md)

## Phase 3: Frontend Implementation [checkpoint: d33d579]
- [x] Task: Update "Manage Cameras" UI. 53da899
    - [x] Modify `public/manage-cameras.html` and its associated JS to add the "Enabled" toggle to the Edit Modal.
    - [x] Ensure the toggle state is correctly loaded when opening the modal and sent back to the server on save.
- [x] Task: Visual Feedback in Dashboard. 53da899
    - [x] Update `public/dashboard.html` to visually indicate if a camera is disabled (e.g., greyed out or a "Disabled" badge).
- [x] Task: Conductor - User Manual Verification 'Phase 3: Frontend Implementation' (Protocol in workflow.md)

## Phase 4: Final Verification
- [ ] Task: Perform end-to-end testing of the enable/disable flow.
- [ ] Task: Verify persistence across server restarts.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Final Verification' (Protocol in workflow.md)
