# Specification: Project Foundation and Maintenance

## Overview
This track focuses on stabilizing the existing NVR codebase, validating the multi-database support (SQLite/MySQL), and ensuring the system is ready for future feature development.

## Scope
- **Health Check:** Verify that the core components (recorder, server, scanner) can start without errors.
- **Database Compatibility:** Validate that the application can switch between SQLite and MySQL/MariaDB as specified.
- **Documentation:** Document the current database schema and key API endpoints for future reference.

## Acceptance Criteria
- Application starts successfully in both SQLite and MySQL modes.
- Database schema is fully documented in `DOCUMENTATION.md` or a new `SCHEMA.md`.
- All core dependencies are verified and redundant files are identified.
