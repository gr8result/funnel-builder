# SMS Queue Processor - Supabase Edge Function

This Edge Function automatically processes queued SMS messages every minute by calling the Next.js `/api/smsglobal/flush-queue` endpoint.

## Overview

- **Function**: `process-sms-queue`
- **Schedule**: Every 1 minute (via Supabase cron)
- **Purpose**: Automatically send queued SMS messages from the `sms_queue` table

## Prerequisites

1. Supabase CLI installed: `npm install -g supabase`
2. Supabase project created and linked
3. Environment variables configured in Supabase

## Required Environment Variables (Supabase Secrets)

Set these secrets in your Supabase project:

```bash
# Authentication secret (must match your Next.js CRON_SECRET)
CRON_SECRET=your-secure-random-secret-key

# Your Next.js application URL
NEXT_PUBLIC_SITE_URL=https://yourdomain.com

# Optional: Alternative names that also work
# AUTOMATION_CRON_KEY=your-secure-random-secret-key
# SITE_URL=https://yourdomain.com
# PUBLIC_SITE_URL=https://yourdomain.com
```

## Deployment Steps

### 1. Set Supabase Secrets

```bash
# Set the CRON_SECRET (must match the one in your Next.js .env.local)
supabase secrets set CRON_SECRET="your-secure-random-secret-key"

# Set your site URL
supabase secrets set NEXT_PUBLIC_SITE_URL="https://yourdomain.com"
```

### 2. Deploy the Edge Function

```bash
# From the root of your funnel-builder repository
supabase functions deploy process-sms-queue
```

### 3. Configure Cron Schedule

You have two options to configure the cron schedule:

#### Option A: Using Supabase Dashboard (Recommended)

1. Go to your Supabase Dashboard
2. Navigate to **Database** → **Extensions**
3. Enable the `pg_cron` extension if not already enabled
4. Navigate to **Database** → **Functions**
5. Find `process-sms-queue` in the list
6. Click on the function and go to the **Cron** tab
7. Add a new cron job:
   - **Schedule**: `* * * * *` (every minute)
   - **Request Method**: POST
   - **Headers**: 
     ```json
     {
       "Content-Type": "application/json",
       "x-cron-secret": "your-secure-random-secret-key"
     }
     ```

#### Option B: Using SQL (Alternative)

Run this SQL in your Supabase SQL Editor:

```sql
-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create cron job to run every minute
SELECT cron.schedule(
  'process-sms-queue-every-minute',
  '* * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/process-sms-queue',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', 'your-secure-random-secret-key',
        'Authorization', 'Bearer YOUR_ANON_KEY'
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);
```

Replace:
- `YOUR_PROJECT_REF` with your Supabase project reference
- `your-secure-random-secret-key` with your actual CRON_SECRET
- `YOUR_ANON_KEY` with your Supabase anon key

### 4. Verify Deployment

Test the function manually:

```bash
# Test using curl
curl -X POST \
  'https://YOUR_PROJECT_REF.supabase.co/functions/v1/process-sms-queue' \
  -H 'Content-Type: application/json' \
  -H 'x-cron-secret: your-secure-random-secret-key' \
  -H 'Authorization: Bearer YOUR_ANON_KEY'
```

Expected response:
```json
{
  "ok": true,
  "timestamp": "2024-01-29T20:00:00.000Z",
  "processed": 5,
  "sent": 5,
  "failed": 0,
  "results": [...]
}
```

## Monitoring

### View Edge Function Logs

```bash
# Stream logs in real-time
supabase functions logs process-sms-queue --follow

# View recent logs
supabase functions logs process-sms-queue
```

### Check SMS Queue Status

Query your database to see pending messages:

```sql
SELECT 
  id,
  to_phone,
  status,
  scheduled_for,
  sent_at,
  last_error,
  created_at
FROM sms_queue
WHERE status IN ('queued', 'pending', 'sending')
ORDER BY created_at ASC;
```

### Check Recent Sent Messages

```sql
SELECT 
  id,
  to_phone,
  status,
  sent_at,
  provider_message_id,
  created_at
FROM sms_queue
WHERE status = 'sent'
ORDER BY sent_at DESC
LIMIT 20;
```

## Troubleshooting

### Function not running automatically

1. Verify `pg_cron` extension is enabled:
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'pg_cron';
   ```

2. Check if cron job exists:
   ```sql
   SELECT * FROM cron.job WHERE jobname LIKE '%sms%';
   ```

3. Check cron job execution history:
   ```sql
   SELECT * FROM cron.job_run_details 
   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'process-sms-queue-every-minute')
   ORDER BY start_time DESC 
   LIMIT 10;
   ```

### Function returning errors

1. Check Edge Function logs:
   ```bash
   supabase functions logs process-sms-queue
   ```

2. Verify secrets are set correctly:
   ```bash
   supabase secrets list
   ```

3. Test the Next.js endpoint directly:
   ```bash
   curl 'https://yourdomain.com/api/smsglobal/flush-queue?key=your-secret&limit=5'
   ```

### Messages not sending

1. Check `sms_queue` table for error messages:
   ```sql
   SELECT id, to_phone, status, last_error, error 
   FROM sms_queue 
   WHERE status = 'failed' 
   ORDER BY created_at DESC 
   LIMIT 10;
   ```

2. Verify SMSGlobal credentials in Next.js environment:
   - `SMSGLOBAL_API_KEY`
   - `SMSGLOBAL_API_SECRET`
   - `DEFAULT_SMS_ORIGIN`

3. Check if scheduled_for/available_at is in the future

## Alternative: External Cron Service (Backup Option)

If Supabase cron is not available, you can use an external service like [cron-job.org](https://cron-job.org):

1. Create a free account at cron-job.org
2. Create a new cron job:
   - **URL**: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/process-sms-queue`
   - **Schedule**: Every 1 minute
   - **HTTP Method**: POST
   - **Headers**:
     ```
     Content-Type: application/json
     x-cron-secret: your-secure-random-secret-key
     Authorization: Bearer YOUR_ANON_KEY
     ```
3. Enable the cron job

## Security Notes

- The `CRON_SECRET` acts as an authentication key - keep it secure
- Only the Edge Function needs to know the secret
- The Next.js `/api/smsglobal/flush-queue` endpoint validates the secret
- Multi-tenant security is maintained (users can only access their own leads)

## Performance

- Batch size: 50 messages per run (configurable)
- Timeout: 25 seconds
- Frequency: Every 1 minute
- Expected latency: Messages send within 1-2 minutes of being queued

## Support

For issues or questions:
1. Check the Edge Function logs
2. Check the Next.js application logs
3. Verify all environment variables are set correctly
4. Ensure SMSGlobal credentials are valid
