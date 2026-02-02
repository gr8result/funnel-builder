# Quick Diagnostic Steps for WAS FLOW 1

## Step 1: Get Your Flow ID
1. Open the Automation Builder with WAS FLOW 1 loaded
2. Open browser DevTools (F12)
3. Look at the Network tab for calls to `/api/automation`
4. Copy the `flow_id` parameter

## Step 2: Run Diagnose Endpoint
Open this URL in your browser (replace <FLOW_ID>):
```
http://localhost:3000/api/automation/diagnose?flow_id=<FLOW_ID>
```

This will show you:
- ✅ If trigger/email nodes exist
- ✅ If edges connect them
- ✅ Member count
- ✅ Queue status

## Step 3: Call Tick Endpoint with Logging
Open PowerShell and run (replace <FLOW_ID>):

```powershell
$body = @{
    flow_id = "<FLOW_ID>"
    max = 10
} | ConvertTo-Json

Invoke-RestMethod -Method POST `
    -Uri "http://localhost:3000/api/automation/engine/tick" `
    -ContentType "application/json" `
    -Body $body
```

## Step 4: Check Server Console
After running the tick endpoint, check your `npm run dev` terminal output.

You should see logs like:
```
Flow <id>: trigger=<id>, firstAfter=<id>, firstType=email, members=5
ensureEmailQueueRow called: flow=<id>, lead=<id>, node=<id>, user=<id>
Minimal insert succeeded for lead <id>
```

## Step 5: What Each Log Means

### If you see:
- `firstType=email` ✅ Good - node type detected correctly
- `firstType=` or `firstType=undefined` ❌ Problem - node type not detected
- `ensureEmailQueueRow called:` ✅ Good - queuing is being attempted
- `Minimal insert failed:` ❌ Problem - database schema issue
- `Minimal insert succeeded:` ✅ Good - emails are being queued

## Step 6: Test Direct Queue Insert
If you see errors, test direct insertion:

```powershell
# Get a lead_id from automation_flow_members table first
# Get a node_id from your flow (the email node ID)

$testBody = @{
    flow_id = "<FLOW_ID>"
    lead_id = "<LEAD_ID>"
    node_id = "<EMAIL_NODE_ID>"
} | ConvertTo-Json

Invoke-RestMethod -Method POST `
    -Uri "http://localhost:3000/api/automation/engine/test-queue" `
    -ContentType "application/json" `
    -Body $testBody
```

This will tell you EXACTLY why the insert is failing.

## Common Issues & Fixes

### Issue 1: "firstType is not email"
**Cause**: Node type detection failing
**Fix**: The email node might have wrong structure. Check with:
```
POST /api/automation/engine/debug-tick
{ "flow_id": "<FLOW_ID>" }
```

### Issue 2: "Column 'X' does not exist"
**Cause**: Database schema mismatch
**Fix**: The automation_email_queue table is missing a column. Check the error message for which column.

### Issue 3: "ensureEmailQueueRow never called"
**Cause**: firstType !== "email" check is failing
**Fix**: Use repair endpoint to verify flow structure

## Quick Fix Command
If structure looks good but emails still not queuing, try manual trigger:

```powershell
# This forces processing of all members in the flow
$body = @{
    flow_id = "<FLOW_ID>"
    max = 100
} | ConvertTo-Json

Invoke-RestMethod -Method POST `
    -Uri "http://localhost:3000/api/automation/engine/tick" `
    -ContentType "application/json" `
    -Body $body
```

Then check automation_email_queue table:
```sql
SELECT * FROM automation_email_queue WHERE flow_id = '<FLOW_ID>';
```

## Expected Flow
```
1. automation_flow_members (has 5 members) ✅
2. automation_flow_runs (has 5 runs) ✅  
3. tick endpoint processes members
4. Detects first node is email
5. Calls ensureEmailQueueRow for each member
6. automation_email_queue (should have 5 rows) ❌ ← THIS IS FAILING
```

The issue is in step 5 or 6 - check the server logs to see which.
