# Specification: Multi-Server Federation

## Overview
This track implements "Federation" capabilities, allowing multiple independent NVR instances to connect and share resources. This enables a "Single Pane of Glass" experience where a user logged into one server can view cameras, recordings, and health status from all other linked servers.

## Functional Requirements
- **Remote Node Management:**
    - UI to manually add/edit/delete remote NVR nodes (URL, Label, API Key).
    - Automatic discovery of other NVR instances on the local network (mDNS/Bonjour).
- **Security & Authentication:**
    - Generation of unique API Keys for inter-server authorization.
    - Secure middleware to verify incoming requests from federated nodes using these keys.
- **Resource Aggregation:**
    - **Global Camera List:** An API endpoint that aggregates local cameras and cameras from all active remote nodes.
    - **Remote Health Monitor:** Dashboard widgets to display disk usage and system health of remote nodes.
    - **Integrated Search:** Search for recordings across the local instance and all connected remote nodes.
- **Efficient Streaming:**
    - **Direct-Link Architecture:** The UI will request stream metadata from the local server, but the video player will connect directly to the remote server's streaming URL to minimize proxy overhead.
- **CORS Handling:** Automatically configure necessary CORS headers to allow browser-direct streaming from different server IPs.

## Non-Functional Requirements
- **Efficiency:** Metadata exchange should be cached or periodic to avoid high inter-server traffic.
- **Ease of Use:** Adding a server should be as simple as "Discover -> Click -> Enter Key".

## Acceptance Criteria
- [ ] A "Remote Nodes" settings page exists for managing connections.
- [ ] Local dashboard shows cameras from remote servers with their respective node labels.
- [ ] Remote live streams play correctly (Direct Link) when selected.
- [ ] Recording search returns results from both local and remote nodes.
- [ ] Storage usage for remote nodes is visible in the system status area.
- [ ] Auto-discovery correctly identifies other NVR instances on the same subnet.

## Out of Scope
- Centralized user management (users must still exist on their respective nodes or the Master Node).
- Remote server configuration (changing remote camera settings from the local instance).
- Cloud-based relay (only direct IP/URL connectivity is supported).
