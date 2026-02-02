# Condition Node Implementation Summary

## Changes Made

### 1. **Enhanced Tick Engine** - `/pages/api/automation/engine/tick.js`
**What Changed:**
- Added full condition node evaluation logic
- Now processes current node instead of just first node after trigger
- Implements email engagement-based routing

**Key Features:**
```javascript
// For condition nodes:
if (currentNodeType === "condition") {
  const condition = currentNode?.data?.condition || {};
  
  // Support: email_not_opened (with wait time)
  // Support: email_opened (immediate check)
  
  // Routes to "yes" or "no" handles based on:
  // - Email open count from SendGrid webhooks
  // - Wait duration for timeout-based routing
  // - Advances members to appropriate next node
}
```

**Email Open Logic:**
- Fetches most recent email sent to member in flow
- Checks if `open_count > 0` → email was opened
- Supports time-based conditions: `waitDays` parameter
- If `timePassed >= waitDays AND open_count === 0` → route to "no"
- If `open_count > 0` → route to "yes"
- Otherwise stay on condition node and wait

**Backward Compatibility:**
- Still supports first-node-after-trigger being email
- Maintains all existing flow logic
- Gracefully handles missing conditions

### 2. **Condition Node UI** - `/components/nodes/ConditionNode.js`
**What Changed:**
- Already displays active member count: `Waiting: [N]`
- Shows condition type summary
- Green handle for "yes" path, red handle for "no" path
- Larger width (260px) to accommodate stats display

**Display Format:**
```
🔀 Condition
Condition Name
Email not opened in 3 days
Waiting: 5  ← Active members on this node
```

### 3. **SendGrid Integration** - `/pages/api/webhooks/sendgrid-events.js`
**What Changed (from previous implementation):**
- Updates `automation_email_queue` with engagement metrics
- Tracks `open_count` and `click_count` per email sent

**New Logic:**
```javascript
// Match queue row by custom_args.automation_queue_id
// Update automation_email_queue with:
//   - open_count (incremented on "open" event)
//   - click_count (incremented on "click" event)  
//   - status (updated based on event type)
```

### 4. **Node Statistics** - `/pages/api/automation/engine/node-stats.js`
**What Changed (from previous implementation):**
- Loads flow.nodes to identify condition nodes
- For condition nodes, adds `activeMembers` count
- Queries `automation_flow_runs` grouped by `current_node_id`

**Statistics Provided:**
```javascript
stats[nodeId] = {
  processed: total_rows_in_queue,
  delivered: rows_with_status_sent,
  opened: sum(open_count),
  clicked: sum(click_count),
  activeMembers: member_count_at_node  // For condition nodes
}
```

## Data Flow

```
1. Tick Endpoint (/api/automation/engine/tick)
   ├─ Find active members in flow
   ├─ Get/create automation_flow_runs for each
   ├─ Check current_node_id (where member currently is)
   │
   ├─ If at EMAIL node:
   │  └─ Queue email in automation_email_queue
   │
   └─ If at CONDITION node:
      ├─ Load condition configuration
      ├─ Fetch most recent email sent to this member
      ├─ Evaluate: email_opened? or email_not_opened?
      │  ├─ Check open_count from SendGrid webhook
      │  ├─ Check wait duration if applicable
      │  └─ Determine "yes" or "no" result
      ├─ Find edge from condition using sourceHandle (yes/no)
      ├─ Advance current_node_id to next node
      └─ If next is EMAIL, queue it (otherwise just advance)

2. Flush Queue (/api/automation/email/flush-queue)
   ├─ Find pending emails in automation_email_queue
   ├─ Fetch HTML from Supabase Storage if needed
   ├─ Get user's from_email from accounts table
   ├─ Send via SendGrid with custom_args
   ├─ Update status to 'sent'
   └─ Store sendgrid_message_id for webhook matching

3. SendGrid Webhook (/api/webhooks/sendgrid-events)
   ├─ Receive event (open, click, delivered, bounce)
   ├─ Match automation_email_queue by custom_args.automation_queue_id
   ├─ Increment open_count or click_count
   └─ Update status based on event type

4. Node Stats (/api/automation/engine/node-stats)
   ├─ Count emails per node
   ├─ Count active members per node (from automation_flow_runs.current_node_id)
   └─ Add activeMembers to condition nodes for UI display

5. Scheduler (scripts/automation-scheduler.js)
   └─ Runs every 60 seconds:
      ├─ POST /api/automation/engine/tick
      └─ POST /api/automation/email/flush-queue
```

## Database Tables Used

### automation_flow_runs
- **Key Field:** `current_node_id` - tracks which node member is currently on
- Used by: tick.js (update), node-stats.js (query for counts)
- Updated when: member advances to next node

### automation_email_queue
- **Key Fields:** 
  - `status` (pending, sent, failed, bounced)
  - `open_count` (incremented by webhook)
  - `click_count` (incremented by webhook)
  - `sendgrid_message_id` (for webhook matching)
- Used by: tick.js (query for condition eval), flush-queue.js (send), webhook (update)

### automation_flows
- **Key Fields:** `nodes`, `edges` (JSON with flow structure)
- Used by: tick.js (find current node, check node type, traverse edges)

### automation_flow_members
- **Key Fields:** `status` (active/inactive)
- Used by: tick.js (find active members to process)

### accounts
- **Key Fields:** `sendgrid_from_email`, `business_email`
- Used by: flush-queue.js (fetch user's from address)

## New Capabilities

### ✅ Email Open Detection
- Condition node can check if email was opened
- Real-time updates from SendGrid webhooks
- Enables split testing based on engagement

### ✅ Time-Based Routing
- Condition node can wait X days for email open
- Automatically routes to "no" path if timeout expires
- Enables "follow-up" email flows for non-openers

### ✅ Active Member Visibility
- Dashboard/UI shows how many members are waiting at each condition
- Helps debug flow performance
- Identifies bottlenecks in automation

### ✅ Multi-Condition Flows
- Can chain multiple condition nodes
- Each makes independent routing decision
- Enables complex decision trees

## Configuration in Node Editor

To set up a condition node in the AutomationBuilder:

```javascript
{
  type: "condition",
  label: "Email Opened?",
  data: {
    condition: {
      type: "email_opened",              // or "email_not_opened"
      waitDays: 3,                       // only for email_not_opened
    }
  }
}
```

## Testing Checklist

- [ ] Create flow: Trigger → Email 1 → Condition → Email 2A / Email 2B
- [ ] Add test member to flow
- [ ] Verify Email 1 sends automatically
- [ ] Simulate SendGrid open event OR actually open email
- [ ] Verify tick advances member past condition
- [ ] Verify correct email (2A or 2B) queues based on open status
- [ ] Check node-stats shows activeMembers for condition node
- [ ] Test time-based logic with short waitDays
- [ ] Test email_not_opened condition
- [ ] Test multiple members in same flow

## Performance Notes

### Query Optimization
- Tick endpoint queries per-flow-per-member, could be optimized with batching
- Condition evaluation fetches email queue row for each member
- Consider indexing: `automation_email_queue (flow_id, lead_id, created_at DESC)`

### Webhook Reliability
- SendGrid webhooks must complete within timeout
- Add retry logic if webhook updates fail
- Consider dead-letter queue for failed webhook processing

### Scalability for "Thousands of Users"
- Current implementation: O(n) members per tick run
- Bottleneck: per-member database queries
- Optimization needed: batch condition evaluation by node

## Integration Points

1. **UI (AutomationBuilder):**
   - ConditionNodeDrawer provides UI for config
   - ConditionNode renders with stats
   - NodeEditor handles edge creation

2. **Database:**
   - Supabase tables for all data
   - Ed25519 signature verification for webhooks
   - Custom args for email tracking

3. **External Services:**
   - SendGrid for email sending
   - SendGrid webhooks for event tracking
   - Supabase Storage for HTML templates

## Future Enhancements

1. **Additional Condition Types:**
   - `field_equals` - route based on lead data
   - `tag_exists` - route based on tag
   - `link_clicked` - route based on email clicks
   - `product_purchased` - route based on CRM integration

2. **Time-Based Nodes:**
   - Delay node for waiting X days before continuing
   - Skip node for conditional skipping of steps

3. **Advanced Features:**
   - Nested conditions (condition inside branch)
   - A/B testing nodes
   - Dynamic email selection based on conditions

4. **Monitoring:**
   - Condition statistics dashboard
   - Flow performance metrics
   - Member journey visualization

## Code Files Modified

1. **pages/api/automation/engine/tick.js**
   - Added condition node evaluation logic
   - Added current_node_id tracking and advancement
   - Added time-based condition logic

2. **components/nodes/ConditionNode.js**
   - Already displays activeMembers count
   - No changes needed

3. **pages/api/webhooks/sendgrid-events.js**
   - Already updates automation_email_queue
   - No changes needed (done in previous session)

4. **pages/api/automation/engine/node-stats.js**
   - Already calculates activeMembers per node
   - No changes needed (done in previous session)

## Backward Compatibility

✅ All changes are backward compatible:
- Non-condition flows work unchanged
- First node after trigger still supported
- Existing email nodes unaffected
- Existing webhook processing unaffected
- Database schema requires no migration (all fields already exist)

## Verification

Run these commands to verify implementation:

```bash
# Check tick logic - should include condition handling
grep -n "currentNodeType === \"condition\"" pages/api/automation/engine/tick.js

# Check email routing in conditions
grep -n "sourceHandle" pages/api/automation/engine/tick.js

# Check wait time logic
grep -n "timePassed >= waitMs" pages/api/automation/engine/tick.js

# Verify node stats (already done)
grep -n "activeMembers" pages/api/automation/engine/node-stats.js
```

## Support & Troubleshooting

For issues, check:
1. Browser console (F12) for client-side errors
2. Server logs for API errors
3. Supabase SQL editor for data state
4. SendGrid event history for webhook delivery
5. CONDITION_NODE_TESTING.md for detailed test procedure
