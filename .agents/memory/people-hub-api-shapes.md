---
name: People Hub API shapes
description: Critical API response shapes for People Hub pages — avoids re-introducing the wrapped vs flat array bug
---

## Rule
When fetching from these endpoints, always unwrap from the object key — they do NOT return raw arrays:

- `GET /api/employees?companyId=xxx` → `{ employees: Employee[] }` — use `.employees`
- `GET /api/companies` → `{ companies: Company[] }` — use `.companies`
- `GET /api/documents?employeeId=xxx` → `{ documents: Document[] }` — use `.documents`
- `GET /api/onboarding-tasks?employeeId=xxx` → `{ tasks: Task[], byStage, completionPercentage, total, completed }` — use `.tasks`
- `GET /api/onboarding-tasks?companyId=xxx` → `{ tasks: Task[], count }` — use `.tasks`
- `GET /api/onboarding-tasks/pipeline?companyId=xxx` → `{ pipeline: Stage[], totalTasks, completedTasks }` — use `.pipeline`
- `GET /api/compliance/company-overview?companyId=xxx` → `{ overview: Cat[], overallScore, totalItems, completedItems }` — use `.overview`
- `GET /api/compliance?employeeId=xxx` → `{ items: Item[], score }` — use `.items`
- `GET /api/activity-log?companyId=xxx` → `{ entries: Entry[] }` — use `.entries`

## Documents endpoint path
`/api/documents?employeeId=xxx` — NOT `/api/employees/:id/documents` (that path does not exist)

**Why:** Multiple new pages (people-onboarding, people-compliance-hub, people-documents-hub) introduced this bug during the People Hub build. Always double-check wrapping before using `as Promise<T[]>`.
