# Specification: Configurable Terminal Logging

## Overview
This track introduces a new configuration section in the Settings menu that allows users to toggle terminal logging for different parts of the application. The goal is to provide a cleaner terminal environment or a detailed debug view as needed, without requiring application restarts.

## Functional Requirements
- **Database Storage:** A new `settings` table (or similar) will be used to store these preferences.
- **Granular Toggles:** Provide individual switches in the UI for:
    - General Server Logging (Express, startup)
    - Recorder Engine Logging (RTSP, segments)
    - Storage Management Logging (Cleanup, sync)
- **Default State:** All terminal logging should be disabled by default for new installations.
- **Real-time Application:** The application should respect these settings immediately upon update, where feasible, or upon the next relevant event.

## Non-Functional Requirements
- **Persistence:** Settings must persist across application restarts.
- **Performance:** Checking the logging preference should have negligible impact on system performance.

## Acceptance Criteria
- User can toggle each logging category from the Settings UI.
- Terminal output for each category correctly reflects the toggled state.
- Settings are correctly saved to and retrieved from the database.

## Out of Scope
- Controlling log levels (e.g., Error vs. Info).
- External log file management (this only affects terminal output).
