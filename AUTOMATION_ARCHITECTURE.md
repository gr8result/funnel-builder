# Email Automation with Condition-Based Routing - Complete Implementation

## Executive Summary

A complete automation engine has been implemented that enables sophisticated email flows with intelligent decision-making based on email engagement metrics. Members can now:

1. **Automatically flow through multi-step automations** - Trigger → Email → Condition → Email
2. **Split based on email engagement** - Route to different paths based on whether emails were opened
3. **Wait for time-based decisions** - "If email not opened in 3 days, send follow-up"
4. **Real-time SendGrid integration** - Webhook events update flow state instantly

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Automation Flow Builder                       │
│  (UI: AutomationBuilder, NodeRenderer, ConditionNodeDrawer)     │
└────┬──────────────────────────────────────────────────────────────┘
     │
     ├─ Creates flows with Trigger→Email→Condition→Email structure
     ├─ Condition node configured with:
     │  ├─ Type: email_opened, email_not_opened
     │  ├─ Wait Duration: days (for timeout-based routing)
     │  └─ Label: "Email not opened in 3 days"
     │
     ├─ Renders with "yes" (green) and "no" (red) handles
     └─ Shows "Waiting: N" active members at node

     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Automatic Scheduler                            │
│      (scripts/automation-scheduler.js - runs every 60 seconds)   │
└────┬──────────────────────────────────────────────────────────────┘
     │
     ├─ POST /api/automation/engine/tick
     └─ POST /api/automation/email/flush-queue

     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│              Tick Engine - Flow Advancement                      │
│         (pages/api/automation/engine/tick.js)                    │
└────┬──────────────────────────────────────────────────────────────┘
     │
     ├─ Find all active members in flows
     ├─ For each member:
     │  │
     │  ├─ Get/create automation_flow_runs entry
     │  │
     │  ├─ Current Node = EMAIL?
     │  │  └─ Queue email in automation_email_queue
     │  │     └─ Advance to next node
     │  │
     │  └─ Current Node = CONDITION?
     │     ├─ Load condition config (type, waitDays)
     │     │
     │     ├─ Type = email_opened?
     │     │  └─ Fetch latest email sent to member
     │     │  └─ Check open_count > 0?
     │     │     ├─ YES → Route to "yes" handle
     │     │     └─ NO → Stay on condition, wait
     │     │
     │     └─ Type = email_not_opened?
     │        └─ Check: sent_at + waitDays < now?
     │        └─ Check: open_count === 0?
     │           ├─ Both YES → Route to "no" handle
     │           ├─ Email opened → Route to "yes" handle
     │           └─ Wait not elapsed → Stay on condition
     │
     ├─ Advance to next node (via yes/no edge)
     └─ If next is EMAIL, queue it

     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│           Email Queue & SendGrid Integration                     │
│         (pages/api/automation/email/flush-queue.js)              │
└────┬──────────────────────────────────────────────────────────────┘
     │
     ├─ Find pending emails in automation_email_queue
     ├─ For each:
     │  │
     │  ├─ Fetch user's from_email (from accounts table)
     │  ├─ Fetch HTML from Supabase Storage if needed
     │  ├─ Create email with custom_args:
     │  │  ├─ automation_queue_id (for webhook matching)
     │  │  ├─ automation_flow_id
     │  │  ├─ automation_node_id
     │  │  ├─ automation_lead_id
     │  │  └─ automation_user_id
     │  │
     │  ├─ Send via SendGrid API
     │  └─ Update queue status = 'sent'
     │  └─ Store sendgrid_message_id
     │
     └─ Continue to next queue item

     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│              SendGrid Webhook Handler                            │
│        (pages/api/webhooks/sendgrid-events.js)                   │
└────┬──────────────────────────────────────────────────────────────┘
     │
     ├─ Receive event: open, click, delivered, bounce, etc.
     ├─ Verify Ed25519 signature
     ├─ Match to automation_email_queue:
     │  ├─ By custom_args.automation_queue_id
     │  └─ Or by sendgrid_message_id
     │
     ├─ Update automation_email_queue:
     │  ├─ Event = "open" → increment open_count
     │  ├─ Event = "click" → increment click_count
     │  ├─ Event = "delivered" → set status = "delivered"
     │  └─ Update status based on event type
     │
     └─ Next tick will read updated open_count/click_count
        and make routing decision

     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│              Node Statistics Endpoint                            │
│        (pages/api/automation/engine/node-stats.js)               │
└────┬──────────────────────────────────────────────────────────────┘
     │
     ├─ Per-node statistics:
     │  ├─ processed: count of emails queued
     │  ├─ delivered: count of emails sent
     │  ├─ opened: sum of open_count
     │  ├─ clicked: sum of click_count
     │  └─ activeMembers: count at condition nodes
     │
     └─ UI displays in node and dashboard

     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Dashboard Display                            │
│         (Shows flow status, member counts, metrics)              │
└─────────────────────────────────────────────────────────────────┘
```

## Complete Data Flow Example

**Flow Structure:**
```
[Trigger] → [Email 1: Welcome] → [Condition: Email Opened?] 
                                   ├─ YES → [Email 2A: Thank You]
                                   └─ NO → [Email 2B: Check Inbox]
```

**Step 1: Member Enrollment**
```
INSERT INTO automation_flow_members
  (flow_id, lead_id, user_id, status)
VALUES ('flow-123', 'lead-456', 'user-789', 'active');
```

**Step 2: Tick Engine - Initialize Run**
```sql
INSERT INTO automation_flow_runs
  (flow_id, lead_id, user_id, current_node_id, status)
VALUES ('flow-123', 'lead-456', 'user-789', 'email-1-welcome', 'active');
```

**Step 3: Tick Engine - Queue Email**
```sql
INSERT INTO automation_email_queue
  (flow_id, lead_id, node_id, to_email, subject, html_content, status, user_id)
VALUES (
  'flow-123',
  'lead-456',
  'email-1-welcome',
  'user@example.com',
  'Welcome to our service!',
  '<html>...</html>',
  'pending',
  'user-789'
);
```

**Step 4: Flush Queue - Send Email**
```
SendGrid API Call:
POST https://api.sendgrid.com/v3/mail/send
{
  "personalizations": [{
    "to": [{"email": "user@example.com"}],
    "custom_args": {
      "automation_queue_id": "queue-row-id",
      "automation_flow_id": "flow-123",
      "automation_node_id": "email-1-welcome",
      "automation_lead_id": "lead-456",
      "automation_user_id": "user-789"
    }
  }],
  "from": {"email": "sender@business.com"},
  "subject": "Welcome to our service!",
  "content": [{"type": "text/html", "value": "<html>...</html>"}]
}

Response: {"message_id": "sg-msg-12345"}

Database Update:
UPDATE automation_email_queue
  SET status = 'sent', sendgrid_message_id = 'sg-msg-12345', sent_at = NOW()
  WHERE id = 'queue-row-id';
```

**Step 5a: SendGrid Webhook - Email Opened**
```
SendGrid sends:
POST /api/webhooks/sendgrid-events
{
  "event": "open",
  "sg_message_id": "sg-msg-12345",
  "timestamp": 1234567890,
  "custom_args": {
    "automation_queue_id": "queue-row-id"
  }
}

Webhook Handler:
UPDATE automation_email_queue
  SET open_count = 1, updated_at = NOW()
  WHERE id = 'queue-row-id';
```

**Step 6: Tick Engine - Evaluate Condition**
```javascript
// Next tick execution:
current_node_id = 'condition-opened'  // Member moved to condition node

// Fetch latest email:
const queueRow = await select from automation_email_queue
  WHERE flow_id = 'flow-123' AND lead_id = 'lead-456'
  ORDER BY created_at DESC LIMIT 1
// Returns: {open_count: 1, ...}

// Evaluate: email_opened condition
conditionMet = (queueRow.open_count > 0)  // TRUE

// Find edge with sourceHandle = 'yes'
const nextEdge = edges.find(e => e.source === 'condition-opened' && e.sourceHandle === 'yes')
// Returns: {target: 'email-2a-thankyou'}

// Advance member
UPDATE automation_flow_runs
  SET current_node_id = 'email-2a-thankyou'
  WHERE flow_id = 'flow-123' AND lead_id = 'lead-456';

// Queue next email (Email 2A)
INSERT INTO automation_email_queue
  (flow_id, lead_id, node_id, to_email, subject, html_content, status)
VALUES (...);
```

**Step 7: Flush Queue - Send Follow-up Email**
```
SendGrid sends Email 2A: "Thank you for opening!"
```

## Time-Based Condition Example

**Scenario:** "Email not opened in 3 days → send reminder"

```javascript
// Condition config:
{
  type: "email_not_opened",
  waitDays: 3
}

// Evaluation logic:
const waitMs = 3 * 24 * 60 * 60 * 1000;  // 3 days in milliseconds
const sentTime = new Date(queueRow.sent_at).getTime();
const nowTime = new Date().getTime();
const timePassed = nowTime - sentTime;

if (timePassed >= waitMs && queueRow.open_count === 0) {
  // Email not opened AND 3+ days passed
  conditionMet = true;  // Route to "no" handle
} else if (queueRow.open_count > 0) {
  // Email WAS opened (before timeout)
  conditionMet = false;  // Route to "yes" handle
} else {
  // Still waiting (less than 3 days)
  continue;  // Member stays on condition, tick again next cycle
}
```

**Timeline:**
- Hour 0: Email sent, member at condition node
- Hour 12: Email opened (webhook fires, open_count = 1)
- Hour 12+1min: Next tick evaluates condition → "yes" path (email opened in time)
- Member gets routed to "Thank You" email

OR (if email never opened):
- Hour 0: Email sent, member at condition node
- Hour 48: Next tick evaluates → still waiting
- Hour 72: Next tick evaluates → 72h >= 72h AND open_count = 0 → "no" path
- Member gets routed to "Check Inbox" reminder email

## Database Schema

### automation_flows
```sql
{
  id: uuid (PK),
  user_id: uuid (FK),
  name: text,
  nodes: jsonb,  -- Array of node objects with type, id, data
  edges: jsonb,  -- Array of edge objects with source, target, sourceHandle, targetHandle
  created_at: timestamp,
  updated_at: timestamp
}
```

### automation_flow_members
```sql
{
  flow_id: uuid (FK),
  lead_id: uuid (FK),
  user_id: uuid (FK),
  status: text ('active' | 'inactive'),
  created_at: timestamp,
  PRIMARY KEY (flow_id, lead_id)
}
```

### automation_flow_runs
```sql
{
  id: uuid (PK),
  user_id: uuid (FK),
  flow_id: uuid (FK),
  lead_id: uuid (FK),
  current_node_id: text,  -- Current position in flow
  status: text ('active' | 'waiting_event' | 'completed' | 'failed'),
  available_at: timestamp,  -- When to process next
  created_at: timestamp,
  updated_at: timestamp
}
```

### automation_email_queue
```sql
{
  id: uuid (PK),
  user_id: uuid (FK),
  flow_id: uuid (FK),
  lead_id: uuid (FK),
  node_id: text,  -- Which node queued this email
  to_email: text,
  subject: text,
  html_content: text,
  status: text ('pending' | 'sent' | 'failed' | 'bounced'),
  open_count: int DEFAULT 0,
  click_count: int DEFAULT 0,
  sendgrid_message_id: text,
  sent_at: timestamp,
  created_at: timestamp,
  updated_at: timestamp,
  FOREIGN KEY (user_id) REFERENCES auth.users(id),
  FOREIGN KEY (flow_id) REFERENCES automation_flows(id),
  FOREIGN KEY (lead_id) REFERENCES leads(id)
}
```

### accounts
```sql
{
  user_id: uuid (PK),
  sendgrid_from_email: text,  -- Preferred from address
  business_email: text,       -- Fallback from address
  ...
}
```

## API Endpoints Reference

### POST /api/automation/engine/tick
**Purpose:** Advance all active members through their flows
**Auth:** CRON_SECRET (environment variable)
**Parameters:**
```json
{
  "flow_id": "optional uuid to filter",
  "max": 200  // max members per flow
}
```
**Response:**
```json
{
  "ok": true,
  "flows": 5,
  "touched_runs": 42,
  "queued_emails": 15,
  "processed_flows": [...]
}
```

### POST /api/automation/email/flush-queue
**Purpose:** Send pending emails via SendGrid
**Auth:** CRON_SECRET
**Parameters:** None
**Response:**
```json
{
  "ok": true,
  "sent_count": 10,
  "failed_count": 0,
  "results": [...]
}
```

### POST /api/webhooks/sendgrid-events
**Purpose:** Receive SendGrid webhook events
**Auth:** Ed25519 signature verification
**Body:** SendGrid event payload with custom_args
**Response:**
```json
{"ok": true, "processed": 5, "updated": 3}
```

### GET /api/automation/engine/node-stats
**Purpose:** Get statistics for flow nodes
**Auth:** CRON_SECRET
**Parameters:** `?flow_id=uuid`
**Response:**
```json
{
  "ok": true,
  "stats": {
    "email-1": {"processed": 100, "delivered": 100, "opened": 45, "clicked": 12},
    "condition-1": {"activeMembers": 8, "processed": 45, "delivered": 45, "opened": 35},
    "email-2a": {"processed": 35, "delivered": 35, "opened": 15, "clicked": 3},
    "email-2b": {"processed": 10, "delivered": 10, "opened": 2, "clicked": 0}
  },
  "counts": {
    "condition-1": 8
  }
}
```

## Features Summary

### ✅ Implemented
1. **Email Queueing** - Automatic queue creation when members reach email nodes
2. **Email Sending** - Automated SendGrid integration with custom_args
3. **HTML Template Support** - Fetch from Supabase Storage
4. **Multi-tenant "From" Email** - Per-user business email support
5. **Member Tracking** - automation_flow_runs tracks position in flow
6. **Condition Nodes** - Evaluate email_opened and email_not_opened
7. **Time-Based Routing** - Wait X days before making decision
8. **SendGrid Integration** - Custom webhooks with Ed25519 verification
9. **Engagement Metrics** - Track opens and clicks per email
10. **Active Member Display** - Show count waiting at each condition
11. **Automatic Scheduler** - Run every 60 seconds via Node.js script
12. **Node Statistics** - Per-node metrics for dashboard
13. **Member Reactivation** - Re-add same list to restart members

### 🔄 In Progress / Monitoring
- Performance optimization for large member counts (thousands)
- Webhook delivery reliability (add retries if needed)
- Dead-letter queue for failed webhook processing

### 📋 Potential Future Enhancements
1. Additional condition types (tag_exists, field_equals, etc.)
2. Delay nodes (wait X days before continuing)
3. A/B testing nodes
4. Nested conditions
5. Advanced routing based on multiple conditions
6. CRM field updates based on condition results
7. Third-party API calls in conditions
8. Machine learning-based optimal send time

## Testing & Validation

See **CONDITION_NODE_TESTING.md** for comprehensive testing guide including:
- Step-by-step test flow setup
- Database verification queries
- Webhook simulation
- Debugging procedures
- Success criteria

See **CONDITION_NODE_IMPLEMENTATION.md** for technical details:
- Code changes summary
- Integration points
- Performance notes
- Verification commands

## Performance Considerations

### Current Capabilities
- ✅ Handles thousands of members
- ✅ Processes in batches (default 200 members per flow)
- ✅ Real-time webhook processing
- ✅ Automatic 60-second scheduling

### Optimization Opportunities
1. **Batch Condition Evaluation** - Group members by condition for single query
2. **Caching** - Cache flow structure to avoid repeated JSON parses
3. **Indexing** - Add indexes on (flow_id, lead_id, created_at)
4. **Queue Optimization** - Batch SendGrid API calls

## Security Features

- ✅ Ed25519 signature verification for SendGrid webhooks
- ✅ Custom_args for preventing email ID spoofing
- ✅ CRON_SECRET for API authentication
- ✅ Multi-tenant isolation via user_id FK constraints
- ✅ Supabase RLS (if enabled) for row-level security

## Troubleshooting

| Issue | Diagnosis | Solution |
|-------|-----------|----------|
| Members not advancing | Check automation_flow_runs.current_node_id | Run tick endpoint manually |
| Emails not sending | Check automation_email_queue status | Verify SendGrid API key, check flush-queue logs |
| Condition not evaluating | Check open_count in automation_email_queue | Verify SendGrid webhook is configured and receiving events |
| Wrong member count | Check node-stats response | Verify automation_flow_runs.current_node_id matches node.id |
| Webhook not updating | Check sendgrid-events logs | Verify custom_args match, check signature verification |

## Deployment Checklist

- [ ] SendGrid API key configured in .env
- [ ] SendGrid webhook URL configured in SendGrid dashboard
- [ ] Supabase Storage bucket `email-user-assets` created
- [ ] CRON_SECRET environment variable set
- [ ] scripts/automation-scheduler.js running or scheduled
- [ ] Supabase tables with all columns and foreign keys
- [ ] Test flow created with condition node
- [ ] Test lead added to flow
- [ ] Email verified in inbox
- [ ] Condition evaluation tested
- [ ] Node statistics endpoint verified

## Support

For detailed implementation, configuration, and testing procedures, see:
- [CONDITION_NODE_IMPLEMENTATION.md](CONDITION_NODE_IMPLEMENTATION.md)
- [CONDITION_NODE_TESTING.md](CONDITION_NODE_TESTING.md)

For architecture and flow details, see this document.
