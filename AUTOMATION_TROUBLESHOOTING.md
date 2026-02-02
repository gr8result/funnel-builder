# Automation Flow Troubleshooting Guide

## Quick Diagnosis (Do This First!)

1. Go to your Automation Builder and load "WAS FLOW 1"
2. Copy the flow ID from the URL or browser network tab
3. Call this endpoint in your browser or with curl:

```
GET /api/automation/diagnose?flow_id=<PASTE_FLOW_ID_HERE>
```

This will give you a detailed report of what's wrong.

---

## Common Issues & Solutions

### Issue: "Trigger has no outgoing connection"
**Problem**: The trigger node is not connected to the email node with an edge/line.

**Solution**:
Option A (Easiest): Auto-repair
```
POST /api/automation/engine/repair-flow
{
  "flow_id": "<flow_id>",
  "auto_connect": true
}
```

Option B: Manually fix in UI
1. Open flow in Automation Builder
2. Click and drag from the bottom of the trigger node
3. Connect the line to the email node  
4. Click "Save"

---

### Issue: "Members enrolled but no emails being sent"
**Problem**: Members are in the flow, but email queue is empty.

**Solution**:
1. Check that trigger → email node is connected (see above)
2. Call the tick endpoint to queue emails:
   ```
   POST /api/automation/engine/tick
   { "flow_id": "<flow_id>", "max": 100 }
   ```
3. Then flush the queue to send emails:
   ```
   POST /api/automation/email/flush-queue
   { "limit": 100 }
   ```

---

### Issue: "Emails queued but not being sent"
**Solution**:
1. Make sure SendGrid API key is configured in .env.local
2. Call the flush endpoint:
   ```
   POST /api/automation/email/flush-queue
   { "limit": 25 }
   ```
3. Check email activity stats in the flow

---

## Available Diagnostic Endpoints

### 1. Quick Diagnose
```
GET /api/automation/diagnose?flow_id=<uuid>
```
Returns: Full health check of the flow

### 2. Debug Detailed
```
POST /api/automation/engine/debug-tick
{ "flow_id": "<uuid>" }
```
Returns: Deep dive into nodes/edges/members structure

### 3. Auto-Repair
```
POST /api/automation/engine/repair-flow
{
  "flow_id": "<uuid>",
  "auto_connect": true
}
```
Returns: Fixes missing edges automatically

---

## Manual Testing Steps

1. **Check flow structure**:
   ```bash
   curl "http://localhost:3000/api/automation/diagnose?flow_id=<flow_id>"
   ```

2. **If needed, repair**:
   ```bash
   curl -X POST "http://localhost:3000/api/automation/engine/repair-flow" \
     -H "Content-Type: application/json" \
     -d '{"flow_id":"<flow_id>","auto_connect":true}'
   ```

3. **Queue emails**:
   ```bash
   curl -X POST "http://localhost:3000/api/automation/engine/tick" \
     -H "Content-Type: application/json" \
     -d '{"flow_id":"<flow_id>","max":50}'
   ```

4. **Send emails**:
   ```bash
   curl -X POST "http://localhost:3000/api/automation/email/flush-queue" \
     -H "Content-Type: application/json" \
     -d '{"limit":25}'
   ```

---

## Understanding the Flow

```
Trigger Node → Edge → Email Node
     ↓                    ↓
Members               Queued for
Enrolled              Sending
     ↓                    ↓
Tick Endpoint        Flush Endpoint
Creates Runs         Sends via
Queues Emails        SendGrid
```

If any link breaks, the flow stops.

---

## Files to Review

- **Automation Builder**: `/pages/modules/email/automation/index.js`
- **Tick Engine**: `/pages/api/automation/engine/tick.js`
- **Email Queue**: `/pages/api/automation/email/flush-queue.js`
- **Member Management**: `/pages/api/automation/members/add-list.js`
- **Flow Repair Tool**: `/pages/api/automation/engine/repair-flow.js` (NEW)
- **Diagnostic Tool**: `/pages/api/automation/diagnose.js` (NEW)

---

## Questions?

Check the detailed analysis in: `AUTOMATION_BUG_ANALYSIS.md`
