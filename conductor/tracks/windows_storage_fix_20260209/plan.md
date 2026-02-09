# Implementation Plan: Fix Windows Drive Listing and Enhance Storage Browsing

This plan details the steps to replace the deprecated `wmic` command with `systeminformation` for robust Windows drive listing and to enhance the `/api/system/browse` endpoint.

## Phase 1: Dependency and Environment Setup [checkpoint: 265d5d3]
- [x] Task: Install `systeminformation` dependency. [ba48ab7]
- [x] Task: Conductor - User Manual Verification 'Phase 1' (Protocol in workflow.md)

## Phase 2: Refactor Drive Listing and Enhance API [checkpoint: 8c274f8]
- [x] Task: Create a unit test in `test/browse_api.test.js` to verify the `/api/system/browse` endpoint, specifically mocking Windows drive listing. [524119d]
- [x] Task: Implement a utility function in `lib/utils.js` (or similar) to abstract drive listing using `systeminformation`. [e3db536]
- [x] Task: Update `routes/api/system.js` to use the new utility for listing drives on Windows. [dea8169]
- [x] Task: Enhance the `/api/system/browse` response to include `label`, `totalSpace`, and `availableSpace` for drives. [dea8169]
- [x] Task: Verify that all tests pass, including the new unit tests and existing system tests. [8c274f8]
- [x] Task: Conductor - User Manual Verification 'Phase 2' (Protocol in workflow.md)

## Phase 3: Final Verification [checkpoint: c07f300]
- [x] Task: Perform a final end-to-end check of the storage browsing feature in the UI (if possible) or via manual API calls. [c07f300]
- [x] Task: Conductor - User Manual Verification 'Phase 3' (Protocol in workflow.md)
