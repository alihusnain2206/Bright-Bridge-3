# Embedded Server to Server Webhooks

### **Webhook Auth**

EasyTeam uses [Convoy Webhook Delivery system](https://getconvoy.io/) to send webhooks. Each webhooks sent with the `X-Convoy-Signature` with `Advanced Signature` :

- [How to validate the signature](https://docs.getconvoy.io/product-manual/signatures)
- Shared secret will be shared privately

### Export

You will receive a payload with an identifier in the `event_type` , based on the on the screen where the export was requested). The export will include list of filters the user used and a URL to download the exported shifts.
The export data is provided in a detailed .json file, that needs to be formatted as a user-friendly export format like an email, CSV or an XLSX.

```json
{
  "event_type": 'export',
  "data": {
    "type": "employees-list" | "employee",
    "organizationId": "<MERCHANT-ID>",
    "requestedBy": "<Employee-ID>",
    "startDate": "2024-04-01T00:00:00Z",
    "endDate": "2024-05-30T00:00:00Z",
    "locations": [ "<MERCHANT-ID>", .. ],
    "employees": [ "<Employee-ID>", .. ],
    "roles": [ "role1", "role2", .. ],
    "url": "<url for a json-file>"
  }
}
```

The json file structure, each item in the array represent one shift (click-in to clock-out). One day may include multiple shifts for the same employee.

```json
[
  {
    "id": "<shift id>",
    "employeeId": "<Employee-ID>",
    "start": "<date-iso-string-with-timezone>",
    "end": "<date-iso-string-with-timezone>",
    "total_paid_hours_formatted": "HH:MM",
    "total_paid_hours_decimal": "0.00",
    "total_unpaid_hours_formatted": "HH:MM",
    "total_unpaid_hours_decimal": "0.00",
  },
  ...
]
```

The best practice would be to group the shifts by date and display each day in its own shift. If you plan on constructing a CSV file it’s best to have multiple rows per employee, where each row is a day or a shift. 

Here are some suggestions of export formats. The first two are highly simplified and were made for skimming through. These will work nicely with most external payroll software. It contains just a single shift per employee per day in the ‘start’ and ‘end’ columns but will have all hours in the ‘total hours’ column. 

[Export timerange (1).xlsx](Export_timerange_(1).xlsx)

[daterange timesheets - All employees with breaks.csv](daterange_timesheets_-_All_employees_with_breaks.csv)

The next option is much more detailed report and will have full details on the exact times of multiple shifts and multiple break start and end times in a single day. This provides all the information for the human user, but this might not work well with external payroll systems. If you construct a .xlsx file, we suggest allowing the option to have each employee in a separate sheet

[daterange timesheets All employees, full breakdown.csv](daterange_timesheets_All_employees_full_breakdown.csv)