# Implementation Plan: Easy Database Configuration and Setup

## Phase 1: Interactive Setup Utility [checkpoint: pending]
- [x] Task: Create a standalone setup utility in `lib/setup-wizard.js`. b7ebbe8
    - [ ] Write Tests: Create `test/setup_wizard.test.js` to verify prompt logic and input validation.
    - [ ] Implement: Use a library like `inquirer` or `enquirer` (check existing usage first) to create the interactive CLI.
    - [ ] Implement: Add validation for MySQL host, user, and password.
- [x] Task: Implement connection verification logic. 6c952c3
    - [ ] Write Tests: Mock database connections to test success and failure scenarios in the wizard.
    - [ ] Implement: Add a function to test MySQL/MariaDB connectivity using `mysql2`.
- [x] Task: Implement `.env` persistence logic. 250938a
    - [ ] Write Tests: Verify that valid inputs are correctly written to the `.env` file.
    - [ ] Implement: Use `fs` to write/update environment variables.
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Interactive Setup Utility' (Protocol in workflow.md)

## Phase 2: Integration with Startup Flow [checkpoint: pending]
- [ ] Task: Modify application entry points to trigger the wizard.
    - [ ] Write Tests: Create `test/startup_check.test.js` to ensure the wizard is called when config is missing.
    - [ ] Implement: Update `server.js` or `start.js` to check for required `DB_TYPE` and credentials before initializing the database.
- [ ] Task: Refactor database initialization for automation.
    - [ ] Write Tests: Update `test/sqlite_init.test.js` and `test/mysql_init.test.js` to ensure they handle "fresh" installs correctly.
    - [ ] Implement: Ensure `lib/database.js` or equivalent automatically runs schema creation scripts on startup.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Integration with Startup Flow' (Protocol in workflow.md)

## Phase 3: Documentation and Polishing [checkpoint: pending]
- [ ] Task: Update `README.md` with database setup instructions.
    - [ ] Implement: Add a "Getting Started" section explaining the auto-setup feature and manual configuration options.
    - [ ] Implement: Add a visual/step-by-step guide for SQLite vs. MySQL choice.
- [ ] Task: Final end-to-end verification.
    - [ ] Task: Verify that a fresh clone correctly triggers the setup.
    - [ ] Task: Verify that an existing `.env` bypasses the setup.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Documentation and Polishing' (Protocol in workflow.md)
