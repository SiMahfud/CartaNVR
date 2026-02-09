# Specification: Fix Windows Drive Listing and Enhance Storage Browsing

## Overview
The current implementation for listing drives on Windows relies on the `wmic` command, which is deprecated and missing in newer Windows versions (e.g., Windows 11 24H2). This causes an error when users try to add storage. This track will replace `wmic` with a robust Node.js library to list drives and will enhance the `/browse` API to include disk space and volume labels.

## Functional Requirements
1.  **Remove `wmic` Dependency:** Replace the shell execution of `wmic logicaldisk get name` in `routes/api/system.js`.
2.  **Robust Drive Listing (Windows):** Use a Node.js library (e.g., `systeminformation`) to retrieve the list of available logical drives on Windows.
3.  **Enhanced Drive Information:**
    *   **Name & Path:** Drive letter and root path (e.g., `C:`).
    *   **Volume Labels:** The friendly name of the drive (e.g., "System", "Data").
    *   **Disk Space info:** Total and available space for each drive.
4.  **API Consistency:** Ensure the `/browse` endpoint still works correctly on Linux/macOS.
5.  **Error Handling:** Gracefully handle cases where drive information cannot be retrieved.

## Non-Functional Requirements
- **Compatibility:** Must work on Windows 10, Windows 11 (including 24H2+), and Linux.
- **Performance:** Retrieving drive information should not significantly delay the API response.

## Acceptance Criteria
- [ ] Navigating to "Add Storage" on Windows successfully lists available drives without errors.
- [ ] Each drive entry in the UI/API response shows its label (if available) and disk space usage.
- [ ] Selecting a drive allows further browsing into its subdirectories.
- [ ] Existing functionality on Ubuntu/Linux remains unaffected.

## Out of Scope
- Re-designing the entire storage management UI (beyond adding the new info).
- Network drive (NAS) discovery (focus is on local logical disks).
