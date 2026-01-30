// /lib/automation-enrollments.js
// Helper to trigger automation flows when leads are enrolled into flows

export async function triggerListSubscriptionFlows(lead_id, list_id, baseUrl = "") {
  // Call the enroll endpoint with list_subscribed event
  // This will match and enroll the lead in any flows listening for that list
  try {
    const url = baseUrl ? `${baseUrl}/api/automation/engine/enroll` : '/api/automation/engine/enroll';
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_id,
        list_id,
        event: 'list_subscribed'
      })
    });

    const result = await response.json();
    return result;
  } catch (err) {
    console.error('triggerListSubscriptionFlows error:', err);
    // Don't fail - enrollment is fire-and-forget
    return { ok: false, error: err.message };
  }
}

export async function triggerLeadCreatedFlows(lead_id, baseUrl = "") {
  // Call the enroll endpoint with lead_created event
  try {
    const url = baseUrl ? `${baseUrl}/api/automation/engine/enroll` : '/api/automation/engine/enroll';
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_id,
        event: 'lead_created'
      })
    });

    const result = await response.json();
    return result;
  } catch (err) {
    console.error('triggerLeadCreatedFlows error:', err);
    return { ok: false, error: err.message };
  }
}
