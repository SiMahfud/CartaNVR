# Specification: Easy Database Configuration and Setup

## Overview
This track aims to simplify the process of configuring the NVR application for its two supported database types: SQLite and MySQL/MariaDB. The goal is to provide a seamless "Auto-Setup" experience that guides the user through the configuration via an interactive terminal prompt when necessary information is missing.

## Functional Requirements
- **Auto-Setup on Start:** If the application starts and detects missing or incomplete database configuration in environment variables, it must launch an interactive CLI prompt.
- **Interactive Configuration:**
    - Prompt the user to choose between `sqlite` and `mysql`.
    - If `mysql` is selected, prompt for host, user, password, and database name.
- **Input Validation:** Validate inputs during the CLI prompt (e.g., non-empty fields, valid hostnames).
- **Mandatory Connection Verification:** For MySQL/MariaDB, the setup must successfully verify the connection and credentials before saving the configuration.
- **Persistent Configuration:** Save verified configuration details to a `.env` file.
- **Automated Table Creation:** Ensure the application automatically initializes the correct schema for the selected database type upon startup.
- **Smart Defaults:** Use the default MySQL port (3306) if the user does not provide one.

## Non-Functional Requirements
- **User Experience:** The CLI prompts should be clear and helpful for non-technical users.
- **Reliability:** Prevent the application from starting in an inconsistent database state.

## Acceptance Criteria
- [ ] Application detects missing `.env` or missing required DB variables on startup.
- [ ] Interactive CLI prompt correctly gathers database selection and credentials.
- [ ] MySQL connection is verified before the setup completes.
- [ ] `.env` file is created or updated with the verified settings.
- [ ] Database tables are automatically created on the first successful run after setup.
- [ ] README.md is updated with visual/step-by-step documentation for the dual-database support.

## Out of Scope
- Migrating data between SQLite and MySQL.
- Advanced database performance tuning.
