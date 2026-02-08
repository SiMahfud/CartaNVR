# Initial Concept
A simple Network Video Recorder (NVR) application designed to manage IP cameras, record RTSP streams, provide live views via a web interface, and manage video playback and storage.

## Target Audience
- Home users looking for a DIY security solution.
- Small to medium-sized businesses needing simple surveillance.
- Tech enthusiasts or hobbyists building custom monitoring systems.

## Primary Goals
- High reliability and continuous 24/7 recording to ensure no critical events are missed.
- Ease of use and simple setup to make surveillance accessible to non-technical users.
- Scalability to support a growing number of cameras and high-capacity storage requirements.

## Key Features
- **Automated Discovery:** Seamless identification and management of cameras using the ONVIF protocol.
- **Interactive Setup Wizard:** A user-friendly CLI guide that automates initial database configuration and connection verification.
- **Individual Camera Control:** Ability to enable or disable specific cameras to manage resources and recording activity.
- **Multi-format Streaming:** Support for various live streaming formats (DASH, HLS, JSMPEG) to ensure compatibility across different browsers and devices.
- **Storage Management:** Efficient circular recording that automatically cleans up old footage to prevent disk space exhaustion.
- **Configurable Logging:** Granular control over terminal output via the web interface, allowing users to toggle logs for different system components (General, Recorder, Storage).

## User Interface & Experience
- **Centralized Dashboard:** A comprehensive web interface for real-time monitoring of all connected cameras.
- **Mobile Responsiveness:** A design that adapts to various screen sizes, allowing users to check their feeds from anywhere.
- **Intuitive Playback:** Simplified controls for searching and reviewing recorded video files.

## Security & Administration
- **User Authentication:** Secure login and role-based access control to protect sensitive surveillance data.
- **System Health Monitoring:** Robust logging and health checks to facilitate system maintenance and proactive troubleshooting.