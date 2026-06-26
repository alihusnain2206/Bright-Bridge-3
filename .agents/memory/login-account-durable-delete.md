---
name: Durable delete must cascade to the login layer
description: Why deleting an employee or company must also remove its login (in-memory staff user + user_accounts DB row), not just the domain row.
---

# Durable delete must cascade to the login layer

When deleting any auth-bearing entity (an employee, or a company and its employees),
you MUST also delete the associated login: remove the in-memory staff user
(`store.deleteStaffUser`) AND the persisted `user_accounts` DB row
(`deleteUserAccount`). Deleting only the domain row (e.g. `employees`) is not enough.

**Why:** On boot the server *reconciles missing employee login accounts* and restores
user accounts from the DB ("Reconciled missing employee login accounts" / "User accounts
restored from DB" log lines). So a login left behind after a domain-row delete will (a)
let the "deleted" person still log in immediately, and (b) be re-seeded on the next
restart, resurrecting the entity. This bit both the employee-delete and company-delete
paths.

**How to apply:** In any DELETE handler for staff/companies, after removing the domain
row(s), look up the login by the employee's email (`store.getUserByEmail`) and delete it
from both the store and `user_accounts`. For company delete, iterate the company's
employees and cascade each login. Leave `client_employee_records` intact (data-retention
requirement) — cascade only `employees` + logins.
