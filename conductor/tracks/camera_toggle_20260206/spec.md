# Specification: Camera Enable/Disable Toggle

## Overview
This track introduces the ability to "Disable" specific cameras within the NVR system. A disabled camera will stop all background processes (Recording and Live Streaming) and will not automatically restart them until it is re-enabled. This provides users with direct control over camera activity and resource usage.

## Functional Requirements
1.  **Database Persistence:**
    -   Add an `enabled` field (BOOLEAN, default: true) to the `cameras` table.
    -   The state must persist across server restarts.
2.  **User Interface:**
    -   Add an "Enabled" toggle switch inside the "Edit Camera" modal in the "Manage Cameras" view (`public/manage-cameras.html`).
    -   The toggle should clearly indicate the current state (On/Off).
3.  **Process Management:**
    -   When a camera is **Disabled**:
        -   Stop the FFmpeg recording process for that camera.
        -   Stop any active live stream processes (DASH/HLS/JSMPEG).
        -   Update the camera's `status` in the database to reflect it is disabled/offline.
    -   When a camera is **Enabled**:
        -   Start the FFmpeg recording process using existing configurations.
        -   Allow live stream processes to be initiated as usual.
4.  **System Startup:**
    -   During the boot sequence (`recorder.js` or `server.js`), only cameras with `enabled: true` should have their recording processes started.

## Non-Functional Requirements
-   **Responsiveness:** The UI should update immediately after the toggle is saved.
-   **Reliability:** Ensure that disabling a camera cleanly terminates FFmpeg processes without leaving zombie processes.

## Acceptance Criteria
-   [ ] A camera can be toggled "Disabled" in the Edit Modal.
-   [ ] A disabled camera stops recording immediately.
-   [ ] A disabled camera stops streaming immediately.
-   [ ] A disabled camera remains disabled after a server restart.
-   [ ] Re-enabling a camera restores recording and streaming functionality.

## Out of Scope
-   Granular control (e.g., "Pause Recording only").
-   Scheduling (e.g., "Disable at Night").
