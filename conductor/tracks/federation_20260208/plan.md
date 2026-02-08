# Implementation Plan: Multi-Server Federation

## Phase 1: Authentication and Node Management [checkpoint: 1a4c461]
- [x] Task: Implement API Key generation and storage for federation. 24f747f
    - [x] Write Tests: Create `test/federation_auth.test.js` to verify API key generation and middleware validation.
    - [x] Implement: Add `federation_key` to the `settings` table and create a secure middleware to validate `X-NVR-Auth` headers.
- [x] Task: Create the Remote Nodes database schema and API. e16bbcb
    - [x] Write Tests: Create `test/remote_nodes_api.test.js` to verify CRUD operations for remote servers.
    - [x] Implement: Create `remote_nodes` table in `lib/database.js` and implement `/api/system/nodes` endpoints.
- [x] Task: Conductor - User Manual Verification 'Phase 1: Authentication and Node Management' (Protocol in workflow.md) 1a4c461

## Phase 2: Metadata Aggregation and Proxy Logic [checkpoint: pending]
- [x] Task: Implement the Federation Client utility. 37f3a5a
    - [x] Write Tests: Create `test/federation_client.test.js` using `msw` or `nock` to mock remote server responses.
    - [x] Implement: Create `lib/federation-client.js` to handle fetching camera lists and health status from remote nodes.
- [ ] Task: Update Camera and Health API for aggregation.
    - [ ] Write Tests: Update `test/api_cameras.test.js` to ensure remote cameras are included in the results.
    - [ ] Implement: Modify `routes/api/cameras.js` and `lib/healthcheck.js` to merge data from local and remote nodes.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Metadata Aggregation and Proxy Logic' (Protocol in workflow.md)

## Phase 3: Auto-Discovery and Frontend [checkpoint: pending]
- [ ] Task: Implement mDNS/Bonjour Auto-Discovery.
    - [ ] Write Tests: Create `test/discovery.test.js` to verify NVR service advertisement and detection.
    - [ ] Implement: Use `bonjour` or similar library to advertise the NVR service and scan for other instances.
- [ ] Task: Update Dashboard and Settings UI.
    - [ ] Implement: Add "Remote Nodes" tab to settings.
    - [ ] Implement: Update dashboard to display node labels on camera cards and health widgets.
    - [ ] Implement: Update video players to use absolute URLs for remote streams.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Auto-Discovery and Frontend' (Protocol in workflow.md)

## Phase 4: Recording Integration and Polishing [checkpoint: pending]
- [ ] Task: Implement Cross-Node Recording Search.
    - [ ] Write Tests: Verify that recording search results include remote files with correct playback URLs.
    - [ ] Implement: Update `routes/api/recordings.js` to query remote nodes for footage.
- [ ] Task: Final CORS and Security Audit.
    - [ ] Implement: Ensure dynamic CORS configuration allows direct browser access to remote nodes.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Recording Integration and Polishing' (Protocol in workflow.md)
