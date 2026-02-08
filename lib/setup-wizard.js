// lib/setup-wizard.js

const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');

function validateNonEmpty(input) {
    return input.trim().length > 0 ? true : 'This field cannot be empty.';
}

function validateHost(input) {
    if (!input) return 'Host cannot be empty.';
    // Simple hostname/IP regex
    const hostRegex = /^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/;
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return (hostRegex.test(input) || ipRegex.test(input)) ? true : 'Please enter a valid hostname or IP address.';
}

async function runWizard() {
    console.log('--- NVR Database Setup Wizard ---');
    
    const { dbType } = await inquirer.prompt([
        {
            type: 'list',
            name: 'dbType',
            message: 'Choose database type:',
            choices: ['sqlite', 'mysql']
        }
    ]);

    let config = { DB_TYPE: dbType };

    if (dbType === 'mysql') {
        const mysqlConfig = await inquirer.prompt([
            {
                type: 'input',
                name: 'MYSQL_HOST',
                message: 'MySQL Host:',
                default: 'localhost',
                validate: validateHost
            },
            {
                type: 'input',
                name: 'MYSQL_USER',
                message: 'MySQL User:',
                validate: validateNonEmpty
            },
            {
                type: 'password',
                name: 'MYSQL_PASSWORD',
                message: 'MySQL Password:',
                mask: '*'
            },
            {
                type: 'input',
                name: 'MYSQL_DATABASE',
                message: 'MySQL Database Name:',
                default: 'nvr',
                validate: validateNonEmpty
            }
        ]);
        config = { ...config, ...mysqlConfig };
    }

    return config;
}

module.exports = {
    runWizard,
    validateNonEmpty,
    validateHost
};
