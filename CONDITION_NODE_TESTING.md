# Condition Node Testing Guide

## Overview
This document describes how to test the newly implemented condition node functionality for email-based flow routing.

## What Was Implemented

### 1. **Condition Node Display** ✅
- Condition nodes now show active member count in the UI
- Located in [components/nodes/ConditionNode.js](components/nodes/ConditionNode.js)
- Displays: `Waiting: [N]` with yellow highlighting

### 2. **SendGrid Event Integration** ✅
- `/pages/api/webhooks/sendgrid-events.js` updated to track opens/clicks
- Updates `automation_email_queue` table with:
  - `open_count`: Number of times email was opened
  - `click_count`: Number of times links were clicked
- Custom args in emails enable proper tracking:
  - `automation_queue_id`, `automation_flow_id`, `automation_node_id`, `automation_lead_id`, `automation_user_id`

### 3. **Condition Evaluation Engine** ✅
- Enhanced `/pages/api/automation/engine/tick.js` with condition logic
- Supports two condition types:
  - **email_opened**: Routes "yes" if email has at least 1 open, "no" otherwise
  - **email_not_opened**: Routes "no" if email not opened AND wait period expired, "yes" if email was opened
- Properly routes members to "yes" or "no" handles based on condition result

### 4. **Node Statistics** ✅
- `/pages/api/automation/engine/node-stats.js` calculates active member count per node
- Condition nodes receive `activeMembers` in their data.stats
- UI displays this in the condition node itself

## Testing Workflow

### Step 1: Create a Test Flow
```
Trigger → Email Node 1 → Condition Node → Email Node 2A (yes) / Email Node 2B (no)
```

**Configuration:**
- Trigger: List-based or import lead trigger
- Email Node 1: Send initial email (e.g., "Welcome Email")
- Condition Node: 
  - Type: "Email not opened"
  - Wait Duration: 1 day (or 0.04 days = ~1 hour for quick testing)
- Email Node 2A: Send follow-up email (routed if email WAS opened)
- Email Node 2B: Send alternative email (routed if email NOT opened after wait)

### Step 2: Prepare Test Data
```sql
-- Add a test lead
INSERT INTO leads (user_id, email, first_name, created_at, updated_at)
VALUES ('YOUR_USER_ID', 'test@example.com', 'Test User', NOW(), NOW());

-- Add to flow's automation_flow_members
INSERT INTO automation_flow_members (flow_id, lead_id, user_id, status, created_at)
VALUES ('YOUR_FLOW_ID', 'LEAD_ID', 'YOUR_USER_ID', 'active', NOW());
```

### Step 3: Trigger First Email
```bash
# Call tick endpoint to queue the first email
curl -X POST http://localhost:3000/api/automation/engine/tick \
  -H "Content-Type: application/json" \
  -H "x-cron-key: YOUR_CRON_SECRET" \
  -d '{"flow_id": "YOUR_FLOW_ID"}'
```

**Expected Response:**
```json
{
  "ok": true,
  "flows": 1,
  "touched_runs": 1,
  "queued_emails": 1,
  "processed_flows": [...]
}
```

### Step 4: Send Queued Email
```bash
curl -X POST http://localhost:3000/api/automation/email/flush-queue \
  -H "Content-Type: application/json" \
  -H "x-cron-key: YOUR_CRON_SECRET"
```

**Expected:**
- Email sent via SendGrid to `test@example.com`
- `automation_email_queue` row updated with `status: 'sent'` and `sendgrid_message_id`
- Email includes custom args for webhook tracking

### Step 5: Test Condition Routing (Email Opened)

**Option A: Simulate Open Event**
```bash
curl -X POST http://localhost:3000/api/webhooks/sendgrid-events \
  -H "Content-Type: application/json" \
  -d '{
    "deliveries": [{
      "event": "open",
      "sg_message_id": "SENDGRID_MESSAGE_ID_FROM_ABOVE",
      "timestamp": '$(date +%s)'
    }],
    "uuid": "test-uuid"
  }'
```

**Option B: Wait for Real SendGrid Webhook**
- If SendGrid webhook is configured, just open the email in your email client
- SendGrid will send webhook event to `/api/webhooks/sendgrid-events`

### Step 6: Advance Flow to Condition Node
```bash
curl -X POST http://localhost:3000/api/automation/engine/tick \
  -H "Content-Type: application/json" \
  -H "x-cron-key: YOUR_CRON_SECRET" \
  -d '{"flow_id": "YOUR_FLOW_ID"}'
```

**Expected Behavior:**
- If email was opened (open_count > 0):
  - Member routed to "yes" path → Email Node 2A queued
  - Check `automation_flow_runs.current_node_id` = Email Node 2A's ID
- If email NOT opened AND wait period expired:
  - Member routed to "no" path → Email Node 2B queued
  - Check `automation_flow_runs.current_node_id` = Email Node 2B's ID
- If wait period not expired:
  - Member stays on condition node
  - Check `automation_flow_runs.current_node_id` = Condition Node's ID

### Step 7: Verify Node Statistics
```bash
curl http://localhost:3000/api/automation/engine/node-stats?flow_id=YOUR_FLOW_ID \
  -H "x-cron-key: YOUR_CRON_SECRET"
```

**Expected Response:**
```json
{
  "ok": true,
  "stats": {
    "node_1_email": { "processed": 1, "delivered": 1, "opened": 1, "clicked": 0 },
    "node_2_condition": { "activeMembers": 0, "processed": 0, "delivered": 0, "opened": 0, "clicked": 0 },
    "node_3_email_yes": { "processed": 1, "delivered": 1, "opened": 0, "clicked": 0 },
    "node_4_email_no": { "processed": 0, "delivered": 0, "opened": 0, "clicked": 0 }
  },
  "counts": {
    "node_2_condition": 0  // 0 because member advanced out of condition
  }
}
```

## Database Schema Reference

### automation_email_queue
```sql
CREATE TABLE automation_email_queue (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  flow_id UUID NOT NULL REFERENCES automation_flows(id),
  lead_id UUID NOT NULL REFERENCES leads(id),
  node_id TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'bounced')),
  open_count INT DEFAULT 0,
  click_count INT DEFAULT 0,
  sendgrid_message_id TEXT,
  sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### automation_flow_runs
```sql
CREATE TABLE automation_flow_runs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  flow_id UUID NOT NULL REFERENCES automation_flows(id),
  lead_id UUID NOT NULL REFERENCES leads(id),
  current_node_id TEXT NOT NULL,  -- Current node member is on
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'waiting_event', 'completed', 'failed')),
  available_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### automation_flow_members
```sql
CREATE TABLE automation_flow_members (
  flow_id UUID NOT NULL REFERENCES automation_flows(id),
  lead_id UUID NOT NULL REFERENCES leads(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (flow_id, lead_id)
);
```

## Common Issues & Debugging

### Issue: "Condition not advancing members"
**Check:**
1. Verify `automation_email_queue` row exists with `status: 'sent'`
2. Verify `open_count` is being updated (check SendGrid webhook logs)
3. Verify `current_node_id` in `automation_flow_runs` changes to next node
4. Check browser console for errors in `/api/automation/engine/tick`

### Issue: "Email not sent from condition node"
**Check:**
1. Verify `automation_flow_runs.current_node_id` equals the email node ID
2. Verify next email node has valid `node_data.subject` and `node_data.htmlPath`
3. Check `/api/automation/email/flush-queue` logs for queueing errors

### Issue: "Members stuck on condition node"
**Check:**
1. For email_not_opened: Is wait period long enough? Try setting waitDays to 0
2. Check that email was actually sent (status = 'sent' in queue)
3. Check SendGrid webhook is receiving events and updating open_count
4. Try manually updating `automation_email_queue.open_count` to test routing logic

### Debug Logging
Add these to `/pages/api/automation/engine/tick.js` for detailed logging:
```javascript
console.log(`Condition eval for lead ${lead_id}: type=${condition.type}, met=${conditionMet}, routing to ${handleId}`);
console.log(`Email queue row:`, queueRow);
console.log(`Time passed: ${timePassed}ms, Wait time: ${waitMs}ms, Open count: ${queueRow.open_count}`);
```

## Automated Testing Flow

The system includes an automatic scheduler that runs every 60 seconds:
- `tick` endpoint: Queues emails and advances flows
- `flush-queue` endpoint: Sends pending emails via SendGrid

Once you create a flow and add members, the automation runs automatically. Monitor progress by:

```bash
# Watch tick endpoint
tail -f /tmp/automation-tick.log

# Watch flush-queue endpoint
tail -f /tmp/automation-flush.log

# Check database state
SELECT * FROM automation_flow_runs WHERE flow_id = 'YOUR_FLOW_ID';
SELECT * FROM automation_email_queue WHERE flow_id = 'YOUR_FLOW_ID';
```

## Success Criteria

✅ **Test passes when:**
1. First email sends automatically (tick queues, flush-queue sends)
2. Condition node shows correct activeMembers count
3. Open event updates `automation_email_queue.open_count`
4. Member routes to correct "yes" or "no" path
5. Next email (2A or 2B) queues automatically
6. Node statistics show accurate counts per node

## Next Steps

After successful testing:
1. Test with multiple members in same flow
2. Test with multiple condition types (email_opened, email_not_opened)
3. Test with longer chains (Email → Condition → Condition → Email)
4. Test time-based logic by setting waitDays and verifying timeout behavior
5. Monitor SendGrid webhook delivery and ensure no events are lost
