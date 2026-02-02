

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgsodium";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "http" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."apply_tenant_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- If caller didn't set tenant_id, default to the current user's id.
  if new.tenant_id is null then
    new.tenant_id := auth.uid();
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."apply_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_default_user_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- If no user_id is provided, assign Waite and Sea's account ID automatically
  if new.user_id is null then
    new.user_id := '3c921040-cd45-4a05-ba74-60db34591091'::uuid;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."assign_default_user_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."attach_list_to_flow_and_backfill"("p_flow_id" "uuid", "p_list_id" "uuid", "p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
declare
  elm_email_col text;
  leads_email_col text;
begin
  -- Ensure email_list_members has lead_id
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='email_list_members' and column_name='lead_id'
  ) then
    alter table public.email_list_members add column lead_id uuid;
  end if;

  -- Detect email column in email_list_members
  select c.column_name into elm_email_col
  from information_schema.columns c
  where c.table_schema='public'
    and c.table_name='email_list_members'
    and c.column_name in ('email','email_address','subscriber_email','contact_email')
  order by case c.column_name
    when 'email' then 1
    when 'email_address' then 2
    when 'subscriber_email' then 3
    when 'contact_email' then 4
    else 99
  end
  limit 1;

  if elm_email_col is null then
    raise exception 'email_list_members: missing email column (expected email/email_address/subscriber_email/contact_email)';
  end if;

  -- Detect email column in leads
  select c.column_name into leads_email_col
  from information_schema.columns c
  where c.table_schema='public'
    and c.table_name='leads'
    and c.column_name in ('email','email_address')
  order by case c.column_name
    when 'email' then 1
    when 'email_address' then 2
    else 99
  end
  limit 1;

  if leads_email_col is null then
    raise exception 'leads: missing email column (expected email or email_address)';
  end if;

  -- 1) Create missing leads for this list (so the flow can actually have members)
  execute format($sql$
    insert into public.leads (user_id, %I)
    select
      %L::uuid as user_id,
      lower(trim(elm.%I)) as email_norm
    from public.email_list_members elm
    where elm.list_id = %L::uuid
      and elm.%I is not null
      and trim(elm.%I) <> ''
      and not exists (
        select 1
        from public.leads l
        where l.user_id = %L::uuid
          and lower(trim(l.%I)) = lower(trim(elm.%I))
      );
  $sql$,
    leads_email_col,
    p_user_id,
    elm_email_col,
    p_list_id,
    elm_email_col,
    elm_email_col,
    p_user_id,
    leads_email_col,
    elm_email_col
  );

  -- 2) Backfill lead_id on email_list_members by matching email to leads (scoped to this user)
  execute format($sql$
    update public.email_list_members elm
    set lead_id = l.id
    from public.leads l
    where elm.list_id = %L::uuid
      and elm.lead_id is null
      and elm.%I is not null
      and trim(elm.%I) <> ''
      and l.user_id = %L::uuid
      and lower(trim(l.%I)) = lower(trim(elm.%I));
  $sql$,
    p_list_id,
    elm_email_col,
    elm_email_col,
    p_user_id,
    leads_email_col,
    elm_email_col
  );

  -- 3) Insert leads into the flow members table
  insert into public.automation_flow_members (user_id, flow_id, lead_id, status, source)
  select
    p_user_id,
    p_flow_id,
    elm.lead_id,
    'active',
    'list_import'
  from public.email_list_members elm
  where elm.list_id = p_list_id
    and elm.lead_id is not null
  on conflict (flow_id, lead_id) do nothing;

end;
$_$;


ALTER FUNCTION "public"."attach_list_to_flow_and_backfill"("p_flow_id" "uuid", "p_list_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."attach_list_to_flow_and_enrol"("p_user_id" "uuid", "p_flow_id" "uuid", "p_list_id" "uuid") RETURNS json
    LANGUAGE "plpgsql"
    AS $$
declare
  v_attached boolean := false;
  v_enrolled_count int := 0;
begin
  -- 1) Attach list to flow
  insert into public.automation_flow_lists(user_id, flow_id, list_id)
  values (p_user_id, p_flow_id, p_list_id)
  on conflict (flow_id, list_id) do nothing;

  v_attached := true;

  -- 2) Enrol every existing lead already in that list
  -- NOTE: This assumes automation_enrollments has: user_id, flow_id, lead_id, status, updated_at
  insert into public.automation_enrollments (user_id, flow_id, lead_id, status, updated_at)
  select m.user_id, p_flow_id, m.lead_id, 'active', now()
  from public.email_list_members m
  where m.user_id = p_user_id
    and m.list_id = p_list_id
  on conflict do nothing;

  get diagnostics v_enrolled_count = row_count;

  -- 3) Push them into the automation queue so the processor starts them
  -- NOTE: This assumes automation_queue has: user_id, flow_id, lead_id, status, run_at, updated_at
  insert into public.automation_queue (user_id, flow_id, lead_id, status, run_at, updated_at)
  select m.user_id, p_flow_id, m.lead_id, 'pending', now(), now()
  from public.email_list_members m
  where m.user_id = p_user_id
    and m.list_id = p_list_id
  on conflict do nothing;

  return json_build_object(
    'ok', true,
    'attached', v_attached,
    'enrolled_existing', v_enrolled_count
  );
end;
$$;


ALTER FUNCTION "public"."attach_list_to_flow_and_enrol"("p_user_id" "uuid", "p_flow_id" "uuid", "p_list_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_enrol_on_list_member_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_user_id uuid;
begin
  -- email_list_members does NOT have user_id, so derive it from the list
  select ll.user_id
    into v_user_id
  from public.lead_lists ll
  where ll.id = new.list_id;

  -- If we can’t determine the owner, do nothing (but DO NOT crash inserts)
  if v_user_id is null then
    return new;
  end if;

  -- Enrol into any flows that are linked to this list for that user
  insert into public.automation_enrollments (user_id, flow_id, lead_id, status, updated_at)
  select
    afl.user_id,
    afl.flow_id,
    new.lead_id,
    'active',
    now()
  from public.automation_flow_lists afl
  where afl.user_id = v_user_id
    and afl.list_id = new.list_id
    and new.lead_id is not null
  on conflict do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."auto_enrol_on_list_member_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."backup_user_leads"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  r RECORD;
  user_uuid uuid;
  file_path text;
  json_data jsonb;
BEGIN
  FOR r IN SELECT DISTINCT user_id FROM leads LOOP
    user_uuid := r.user_id;
    file_path := 'backups/' || user_uuid || '/' || to_char(now(), 'YYYY-MM-DD_HH24-MI') || '.json';
    SELECT jsonb_agg(leads.*) INTO json_data FROM leads WHERE user_id = user_uuid;
    PERFORM storage.upload(
      bucketname := 'user_backups',
      path := file_path,
      filecontents := convert_to(json_data::text, 'UTF8'),
      contenttype := 'application/json'
    );
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."backup_user_leads"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."email_campaigns_queue" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "campaign_id" "uuid" NOT NULL,
    "subscriber_id" "uuid",
    "subscriber_email" "text",
    "email_index" smallint NOT NULL,
    "scheduled_at" timestamp with time zone NOT NULL,
    "sent_at" timestamp with time zone,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "error" "text",
    "subject" "text",
    "preheader" "text",
    "html" "text",
    "lead_id" "uuid",
    "template_id" "text",
    "from_name" "text",
    "from_email" "text",
    "extra_recipients" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "ab_test_id" "uuid",
    "ab_variant_key" "text",
    "processing" boolean DEFAULT false NOT NULL,
    "to_email" "text",
    "processed_at" timestamp with time zone,
    "claimed_at" timestamp with time zone,
    "processing_at" timestamp with time zone,
    "_schema_touch" boolean DEFAULT false,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "sendgrid_message_id" "text",
    "sendgrid_event_status" "text",
    "delivered_at" timestamp with time zone,
    "opened_at" timestamp with time zone,
    "bounced_at" timestamp with time zone,
    "dropped_at" timestamp with time zone
);


ALTER TABLE "public"."email_campaigns_queue" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_email_campaign_queue"("p_limit" integer) RETURNS SETOF "public"."email_campaigns_queue"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return query
  with picked as (
    select q.id
    from public.email_campaigns_queue q
    where
      q.processing = false
      and q.sent_at is null
      and (q.status in ('queued','scheduled','pending'))
      and q.scheduled_at <= now()
    order by q.scheduled_at asc, q.id asc
    for update skip locked
    limit greatest(p_limit, 1)
  ),
  upd as (
    update public.email_campaigns_queue q
    set
      processing = true,
      claimed_at = now(),
      processing_at = now(),
      attempts = coalesce(q.attempts, 0) + 1,
      last_error = null
    where q.id in (select id from picked)
    returning q.*
  )
  select * from upd;
end;
$$;


ALTER FUNCTION "public"."claim_email_campaign_queue"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_email_campaigns_queue"("p_limit" integer) RETURNS SETOF "public"."email_campaigns_queue"
    LANGUAGE "plpgsql"
    AS $$
begin
  return query
  with due as (
    select q.id
    from public.email_campaigns_queue q
    where
      q.sent_at is null
      and q.processing = false
      and q.scheduled_at <= now()
      and (q.status is null or q.status in ('queued','scheduled','pending'))
    order by q.scheduled_at asc, q.id asc
    limit p_limit
    for update skip locked
  )
  update public.email_campaigns_queue q
  set
    processing    = true,
    status        = 'processing',
    claimed_at    = now(),
    processing_at = now()
  from due
  where q.id = due.id
  returning q.*;
end;
$$;


ALTER FUNCTION "public"."claim_email_campaigns_queue"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clone_default_templates"("new_user" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  insert into email_templates (user_id, name, thumbnail_url, html_content, design_json, created_at)
  select new_user, name, thumbnail_url, html_content, design_json, now()
  from email_templates
  where user_id = '3c921040-cd45-4a05-ba74-60db34591091'; -- your master template user
end;
$$;


ALTER FUNCTION "public"."clone_default_templates"("new_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_campaign_secure"("p_subject" "text", "p_from_name" "text", "p_from_email" "text", "p_list_id" "uuid", "p_template_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  new_id uuid := uuid_generate_v4();
begin
  insert into public.email_campaigns (id, user_id, subject, from_name, from_email, list_id, template_id, status)
  values (new_id, auth.uid(), p_subject, p_from_name, p_from_email, p_list_id, p_template_id, 'draft');
  return new_id;
end; $$;


ALTER FUNCTION "public"."create_campaign_secure"("p_subject" "text", "p_from_name" "text", "p_from_email" "text", "p_list_id" "uuid", "p_template_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_leads_partition_for_user"("p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  partition_name text;
  partition_exists boolean;
BEGIN
  -- Generate a consistent, full-length table name
  partition_name := format('leads_user_%s', replace(p_user_id::text, '-', '_'));

  -- Check if partition already exists
  SELECT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relname = partition_name
  ) INTO partition_exists;

  -- Create partition only if it doesn't exist
  IF NOT partition_exists THEN
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF leads FOR VALUES IN (%L);',
      partition_name,
      p_user_id::text
    );
  END IF;
END;
$$;


ALTER FUNCTION "public"."create_leads_partition_for_user"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_user_storage_folders"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  user_id uuid;
  folder_names text[] := ARRAY['templates', 'uploads', 'logos', 'proof'];
  folder_name text;
  base_path text;
BEGIN
  user_id := NEW.id;
  base_path := user_id::text || '/';

  -- Loop through and create all subfolders with .keep file
  FOREACH folder_name IN ARRAY folder_names LOOP
    INSERT INTO storage.objects (bucket_id, name, owner, metadata)
    VALUES (
      'public-assets',
      base_path || folder_name || '/.keep',
      user_id,
      '{"created_by_trigger": true}'
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_user_storage_folders"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_active_org"() RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.active_org_id
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;
$$;


ALTER FUNCTION "public"."current_active_org"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_autoresponder_on_list_add"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  ar record;
begin
  -- Loop through ALL ACTIVE autoresponders attached to this list
  for ar in
    select
      ea.id as autoresponder_id,
      ea.subject,
      ea.template_path
    from public.email_automations ea
    where ea.is_active = true
      and ea.list_id = new.list_id
  loop
    insert into public.email_autoresponder_queue (
      user_id,
      autoresponder_id,
      list_id,
      lead_id,
      to_email,
      to_name,
      subject,
      template_path,
      scheduled_at,
      status,
      attempts
    ) values (
      new.user_id,
      ar.autoresponder_id,
      new.list_id,
      new.lead_id,
      new.email,
      new.name,
      ar.subject,
      ar.template_path,
      now(),
      'queued',
      0
    )
    on conflict do nothing;
  end loop;

  return new;
end;
$$;


ALTER FUNCTION "public"."enqueue_autoresponder_on_list_add"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_leads_partition_exists"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  PERFORM create_leads_partition_for_user(NEW.user_id);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."ensure_leads_partition_exists"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."foldername"("name" "text") RETURNS "text"
    LANGUAGE "sql" STABLE
    AS $$
  select split_part(name, '/', 1);
$$;


ALTER FUNCTION "public"."foldername"("name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."force_refresh"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  PERFORM 1;
END;
$$;


ALTER FUNCTION "public"."force_refresh"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_affiliate_link"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.status = 'approved' AND (NEW.affiliate_link IS NULL OR NEW.affiliate_link = '') THEN
    NEW.affiliate_link := 'https://www.waiteandsea.com.au/?ref=' || encode(gen_random_bytes(6), 'hex');
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."generate_affiliate_link"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_affiliate_slug"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
declare
  slug text;
begin
  slug := 'ref/' || substr(md5(random()::text), 1, 8);
  return slug;
end;
$$;


ALTER FUNCTION "public"."generate_affiliate_slug"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_account_brand"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  result text;
begin
  select
    coalesce(a.business_name, a.name, u.email)
  into result
  from auth.users u
  left join accounts a on a.owner_id = u.id
  where u.id = auth.uid()
  limit 1;

  if result is null then
    result := 'Member';
  end if;

  return result;
end;
$$;


ALTER FUNCTION "public"."get_account_brand"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_leads"("p_user_id" "uuid") RETURNS TABLE("id" "uuid", "user_id" "uuid", "list_id" "uuid", "name" "text", "email" "text", "phone" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT id,
         user_id,
         list_id,
         name,
         email,
         phone,
         created_at,
         updated_at
  FROM public.leads
  WHERE user_id = p_user_id
  ORDER BY created_at DESC;
$$;


ALTER FUNCTION "public"."get_user_leads"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_user_leads"("p_user_id" "uuid") IS 'Fetches all leads for the given user_id';



CREATE OR REPLACE FUNCTION "public"."gr8_enqueue_autoresponder_on_email_list_member_add"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_user_id uuid;
begin
  -- Derive list owner (multi-tenant safe)
  select ll.user_id
    into v_user_id
  from public.lead_lists ll
  where ll.id = new.list_id;

  if v_user_id is null then
    return new;
  end if;

  -- Need an email to enqueue
  if new.email is null or btrim(new.email) = '' then
    return new;
  end if;

  insert into public.email_autoresponder_queue
    (user_id, autoresponder_id, list_id, lead_id, to_email, to_name, subject, template_path, scheduled_at, status, attempts)
  select
    a.user_id,
    a.id,
    new.list_id,
    new.lead_id,
    lower(btrim(new.email)) as to_email,
    nullif(btrim(coalesce(new.name,'')), '') as to_name,
    a.subject,
    a.template_path,
    now() as scheduled_at,
    'queued' as status,
    0 as attempts
  from public.email_automations a
  where a.user_id = v_user_id
    and a.list_id = new.list_id
    and coalesce(a.is_active, true) = true   -- ✅ FIX HERE
    and coalesce(a.status, 'draft') in ('active','draft')
    and a.template_path is not null
    and btrim(a.template_path) <> ''
    and a.subject is not null
    and btrim(a.subject) <> ''
  on conflict do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."gr8_enqueue_autoresponder_on_email_list_member_add"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gr8_enqueue_autoresponder_on_email_list_member_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  ar record;
begin
  -- Only enqueue when this member is flagged to receive autoresponders
  if coalesce(new.autoresponder, false) is not true then
    return new;
  end if;

  if new.email is null or length(trim(new.email)) = 0 then
    return new;
  end if;

  -- Find the active autoresponder for this list.
  -- (If you later support multiple, this can enqueue multiple.)
  select
    id,
    user_id,
    list_id,
    subject,
    template_path
  into ar
  from public.email_automations
  where list_id = new.list_id
    and is_active = true
    and coalesce(template_path, '') <> ''
    and coalesce(subject, '') <> ''
  order by updated_at desc
  limit 1;

  if not found then
    -- No active autoresponder for this list
    return new;
  end if;

  -- Insert into queue (avoid duplicates)
  if new.lead_id is not null then
    insert into public.email_autoresponder_queue (
      user_id,
      autoresponder_id,
      list_id,
      lead_id,
      to_email,
      to_name,
      subject,
      template_path,
      scheduled_at,
      status,
      attempts,
      created_at
    )
    values (
      ar.user_id,
      ar.id,
      new.list_id,
      new.lead_id,
      new.email,
      nullif(trim(new.name), ''),
      ar.subject,
      ar.template_path,
      now(),
      'queued',
      0,
      now()
    )
    on conflict (autoresponder_id, lead_id) do nothing;

  else
    insert into public.email_autoresponder_queue (
      user_id,
      autoresponder_id,
      list_id,
      lead_id,
      to_email,
      to_name,
      subject,
      template_path,
      scheduled_at,
      status,
      attempts,
      created_at
    )
    values (
      ar.user_id,
      ar.id,
      new.list_id,
      null,
      new.email,
      nullif(trim(new.name), ''),
      ar.subject,
      ar.template_path,
      now(),
      'queued',
      0,
      now()
    )
    on conflict (autoresponder_id, to_email) do nothing;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."gr8_enqueue_autoresponder_on_email_list_member_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gr8_enqueue_autoresponder_on_lead_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  a record;
begin
  if coalesce(nullif(trim(new.email), ''), '') = '' then
    return new;
  end if;

  for a in
    select id, user_id, list_id, subject, template_path
    from public.email_automations
    where is_active = true
      and list_id = new.list_id
      and user_id = new.user_id
  loop
    if not exists (
      select 1
      from public.email_autoresponder_queue q
      where q.autoresponder_id = a.id
        and q.lead_id = new.id
        and q.status in ('queued','pending','processing','sent')
    ) then
      insert into public.email_autoresponder_queue (
        user_id,
        autoresponder_id,
        list_id,
        lead_id,
        to_email,
        to_name,
        subject,
        template_path,
        scheduled_at,
        status,
        attempts,
        created_at
      ) values (
        a.user_id,
        a.id,
        a.list_id,
        new.id,
        new.email,
        new.name,
        a.subject,
        a.template_path,
        now(),
        'pending',
        0,
        now()
      );
    end if;
  end loop;

  return new;
end;
$$;


ALTER FUNCTION "public"."gr8_enqueue_autoresponder_on_lead_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gr8_enqueue_autoresponder_on_lead_list_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- Only do work when list_id is set and changed/added
  if new.list_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and (new.list_id is not distinct from old.list_id) then
    return new;
  end if;

  /*
    Assumptions based on what YOU said:
    - autoresponder definitions live in public.email_automations
    - it has: id, user_id, list_id, status, subject, template_path
    If your "active" flag differs, tweak the WHERE line (see note below).
  */

  insert into public.email_autoresponder_queue (
    user_id,
    autoresponder_id,
    list_id,
    lead_id,
    to_email,
    to_name,
    subject,
    template_path,
    scheduled_at,
    status,
    attempts,
    created_at
  )
  select
    a.user_id,
    a.id as autoresponder_id,
    new.list_id,
    new.id as lead_id,
    new.email as to_email,
    coalesce(new.name, '') as to_name,
    a.subject,
    a.template_path,
    now() as scheduled_at,
    'queued' as status,
    0 as attempts,
    now() as created_at
  from public.email_automations a
  where a.user_id = new.user_id
    and a.list_id = new.list_id
    and coalesce(a.status, '') in ('active', 'enabled')  -- <-- if yours is different, change this line
    and new.email is not null
    and new.email <> ''
    and not exists (
      select 1
      from public.email_autoresponder_queue q
      where q.user_id = a.user_id
        and q.autoresponder_id = a.id
        and q.lead_id = new.id
        and q.status in ('queued','pending','processing','sent')
    );

  return new;
end;
$$;


ALTER FUNCTION "public"."gr8_enqueue_autoresponder_on_lead_list_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gr8_enqueue_autoresponder_on_lead_list_member_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  a record;
  lead_rec record;
  v_scheduled_at timestamptz;
begin
  -- Fetch the lead
  select
    l.id,
    l.user_id,
    l.name,
    l.email
  into lead_rec
  from public.leads l
  where l.id = new.lead_id;

  -- If lead missing or no email, do nothing
  if lead_rec.id is null or lead_rec.email is null or length(trim(lead_rec.email)) = 0 then
    return new;
  end if;

  -- For every ACTIVE autoresponder that targets THIS list + THIS user
  for a in
    select
      ea.id,
      ea.user_id,
      ea.list_id,
      ea.subject,
      ea.template_path,
      ea.delay_type,
      ea.delay_value,
      ea.delay_days
    from public.email_automations ea
    where ea.is_active = true
      and ea.user_id = new.user_id
      and ea.list_id = new.list_id
  loop
    -- Scheduling:
    -- immediate => now()
    -- delay_days or delay_value (days) => now() + N days
    v_scheduled_at := now();

    if coalesce(a.delay_type,'') = 'days' then
      v_scheduled_at := now() + make_interval(days => coalesce(a.delay_value, 0));
    elsif coalesce(a.delay_days, 0) > 0 then
      v_scheduled_at := now() + make_interval(days => a.delay_days);
    end if;

    -- Insert queue row if not already queued/sent for this autoresponder+lead
    insert into public.email_autoresponder_queue (
      user_id,
      autoresponder_id,
      list_id,
      lead_id,
      to_email,
      to_name,
      subject,
      template_path,
      scheduled_at,
      status,
      attempts,
      created_at
    )
    select
      new.user_id,
      a.id,
      new.list_id,
      new.lead_id,
      lower(trim(lead_rec.email)),
      lead_rec.name,
      coalesce(a.subject, ''),
      a.template_path,
      v_scheduled_at,
      'queued',
      0,
      now()
    where not exists (
      select 1
      from public.email_autoresponder_queue q
      where q.autoresponder_id = a.id
        and q.lead_id = new.lead_id
        and q.status in ('queued','pending','processing','sent')
    );

  end loop;

  return new;
end;
$$;


ALTER FUNCTION "public"."gr8_enqueue_autoresponder_on_lead_list_member_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gr8_enqueue_autoresponder_on_list_add"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- NO-OP: do not crash inserts
  return new;
end;
$$;


ALTER FUNCTION "public"."gr8_enqueue_autoresponder_on_list_add"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gr8_ensure_lead_from_email_list_member"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_user_id uuid;
begin
  v_user_id := public.gr8_list_owner_user_id(new.list_id);

  -- create lead if missing (same list_id + email)
  insert into public.leads (
    user_id,
    list_id,
    name,
    email,
    phone,
    source,
    tags,
    notes,
    created_at,
    updated_at
  )
  select
    v_user_id,
    new.list_id,
    coalesce(new.name, ''),
    new.email,
    null,
    '',
    '',
    '',
    now(),
    now()
  where not exists (
    select 1
    from public.leads l
    where l.list_id = new.list_id
      and lower(l.email) = lower(new.email)
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."gr8_ensure_lead_from_email_list_member"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gr8_list_owner_user_id"("p_list_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $_$
declare
  v uuid;
begin
  -- try lead_lists.user_id
  if to_regclass('public.lead_lists') is not null then
    begin
      execute 'select user_id from public.lead_lists where id = $1 limit 1'
        into v
        using p_list_id;
      if v is not null then return v; end if;
    exception when others then
      null;
    end;
  end if;

  -- try email_lists.user_id (if you have it)
  if to_regclass('public.email_lists') is not null then
    begin
      execute 'select user_id from public.email_lists where id = $1 limit 1'
        into v
        using p_list_id;
      if v is not null then return v; end if;
    exception when others then
      null;
    end;
  end if;

  return null;
end;
$_$;


ALTER FUNCTION "public"."gr8_list_owner_user_id"("p_list_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gr8_sync_lead_list_member_to_email_list_members"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- Insert or update the subscriber row for this list member
  insert into public.email_list_members (
    list_id,
    lead_id,
    email,
    name,
    autoresponder,
    crm,
    funnel,
    broadcasts,
    automation,
    ab_testing,
    courses,
    created_at
  )
  select
    new.list_id,
    l.id,
    l.email,
    coalesce(l.name, ''),
    true,   -- autoresponder
    false,  -- crm
    false,  -- funnel
    false,  -- broadcasts
    false,  -- automation
    false,  -- ab_testing
    false,  -- courses
    now()
  from public.leads l
  where l.id = new.lead_id
    and l.email is not null
  on conflict (list_id, lead_id)
  do update set
    email = excluded.email,
    name  = excluded.name;

  return new;

exception when others then
  -- IMPORTANT: never block inserts into lead_list_members just because email sync failed
  return new;
end;
$$;


ALTER FUNCTION "public"."gr8_sync_lead_list_member_to_email_list_members"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gr8_sync_lead_membership_from_leads"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  -- remove any old membership rows for this lead (single list model)
  delete from public.lead_list_members
  where lead_id = new.id
    and user_id = new.user_id;

  -- add the current membership row (if list_id is set)
  if new.list_id is not null then
    insert into public.lead_list_members (id, user_id, list_id, lead_id, created_at)
    values (gen_random_uuid(), new.user_id, new.list_id, new.id, now())
    on conflict do nothing;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."gr8_sync_lead_membership_from_leads"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  insert into public.accounts (id, email, is_approved)
  values (new.id, new.email, false);
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user_clone_templates"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  perform clone_default_templates(new.id);
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user_clone_templates"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user_crm_pipeline"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  base_template record;
begin
  -- Get the Base CRM Pipeline template
  select *
  into base_template
  from public.pipeline_templates
  where name = 'Base CRM Pipeline'
  order by created_at desc
  limit 1;

  -- If we have a base template, copy it
  if base_template.id is not null then
    insert into public.crm_pipelines (user_id, name, description, stages)
    values (
      new.id,                         -- auth.users.id
      base_template.name,
      base_template.description,
      base_template.stages
    );

  else
    -- Fallback: create a super simple pipeline with just New Lead
    insert into public.crm_pipelines (user_id, name, description, stages)
    values (
      new.id,
      'My CRM Pipeline',
      'Auto-created default pipeline',
      '[
        { "id": "new_lead", "title": "New Lead", "color": "#0ea5e9" }
      ]'::jsonb
    );
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user_crm_pipeline"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."http_post"("url" "text", "payload" json) RETURNS "jsonb"
    LANGUAGE "sql"
    AS $$
  SELECT public.http_post_bridge(url, payload);
$$;


ALTER FUNCTION "public"."http_post"("url" "text", "payload" json) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."http_post_bridge"("url" "text", "payload" json) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  resp jsonb;
BEGIN
  SELECT (extensions.http_post(
    url := url,
    content := payload::text,
    content_type := 'application/json'
  )).content::jsonb INTO resp;

  RETURN resp;
END;
$$;


ALTER FUNCTION "public"."http_post_bridge"("url" "text", "payload" json) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."http_post_json"("url" "text", "payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  job_id bigint;
  result jsonb;
BEGIN
  -- Send the async request
  SELECT net.http_post(
    url,
    '{"Content-Type": "application/json"}'::jsonb,
    payload
  ) INTO job_id;

  -- Wait briefly and fetch result
  PERFORM pg_sleep(1); -- give background worker a second
  SELECT body::jsonb INTO result FROM net.http_get_result(job_id);
  RETURN result;
END;
$$;


ALTER FUNCTION "public"."http_post_json"("url" "text", "payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."http_post_json_retry"("url" "text", "payload" "jsonb", "max_retries" integer DEFAULT 3, "delay_seconds" integer DEFAULT 2) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  job_id BIGINT;
  attempt INT := 0;
  result JSONB;
  status_code_val INT;
  body_text TEXT;
BEGIN
  WHILE attempt < max_retries LOOP
    attempt := attempt + 1;

    -- 1️⃣ Queue async HTTP POST
    SELECT net.http_post(
      url,
      '{"Content-Type": "application/json"}'::jsonb,
      payload
    ) INTO job_id;

    -- 2️⃣ Wait for the worker
    PERFORM pg_sleep(delay_seconds);

    -- 3️⃣ Read from _http_response using alias to avoid ambiguity
    SELECT r.content, r.status_code
      INTO body_text, status_code_val
      FROM net._http_response AS r
     WHERE r.id = job_id;

    -- 4️⃣ Parse and return if success
    IF status_code_val IN (200, 201) THEN
      BEGIN
        result := body_text::jsonb;
      EXCEPTION WHEN others THEN
        result := jsonb_build_object('raw', body_text);
      END;
      RETURN result;
    END IF;

    RAISE NOTICE 'Attempt % failed (status: %), retrying...', attempt, status_code_val;
    PERFORM pg_sleep(delay_seconds);
  END LOOP;

  RETURN jsonb_build_object(
    'error', 'No valid response after retries',
    'last_status', status_code_val
  );
END;
$$;


ALTER FUNCTION "public"."http_post_json_retry"("url" "text", "payload" "jsonb", "max_retries" integer, "delay_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_page_views"("p_slug" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.pages
     set views = coalesce(views,0) + 1
   where slug = p_slug
     and published = true;
end;
$$;


ALTER FUNCTION "public"."increment_page_views"("p_slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_org_member"("org" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.organisation_members m
    where m.org_id = org and m.user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_org_member"("org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_page_position"("in_funnel" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce(max(position) + 1, 0)
  from public.pages
  where funnel_id = in_funnel
$$;


ALTER FUNCTION "public"."next_page_position"("in_funnel" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_crm_call_row"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_our text;
  sid_from_url text;
  re_match text[];
BEGIN
  NEW.from_number := trim(coalesce(NEW.from_number, ''));
  NEW.to_number := trim(coalesce(NEW.to_number, ''));

  IF (NEW.recording_sid IS NULL OR NEW.recording_sid = '') THEN
    IF (NEW.twilio_sid IS NOT NULL AND NEW.twilio_sid <> '') THEN
      NEW.recording_sid := NEW.twilio_sid;
    ELSE
      re_match := regexp_matches(coalesce(NEW.recording_url::text, ''), '/Recordings/(RE[0-9A-Za-z]+)');
      IF re_match IS NOT NULL AND array_length(re_match,1) >= 1 THEN
        sid_from_url := re_match[1];
        NEW.recording_sid := sid_from_url;
      END IF;
    END IF;
  END IF;

  IF (NEW.recording_duration IS NULL OR NEW.recording_duration = 0) AND (NEW.duration IS NOT NULL) THEN
    NEW.recording_duration := NEW.duration;
  END IF;

  SELECT number INTO v_our
    FROM public.crm_our_numbers
    WHERE number IS NOT NULL
      AND (number = NEW.from_number OR number = NEW.to_number)
    LIMIT 1;

  IF v_our IS NOT NULL THEN
    NEW.our_number := v_our;
    IF NEW.from_number = v_our THEN
      NEW.contact_number := NEW.to_number;
      NEW.direction := 'outbound';
    ELSE
      NEW.contact_number := NEW.from_number;
      NEW.direction := 'inbound';
    END IF;
  ELSE
    IF NEW.direction IS NULL OR NEW.direction = '' THEN
      NEW.direction := 'inbound';
    ELSE
      IF position('outbound' in lower(NEW.direction)) > 0 THEN
        NEW.direction := 'outbound';
      ELSIF position('inbound' in lower(NEW.direction)) > 0 THEN
        NEW.direction := 'inbound';
      ELSE
        NEW.direction := 'inbound';
      END IF;
    END IF;

    IF NEW.contact_number IS NULL OR NEW.contact_number = '' THEN
      NEW.contact_number := NEW.from_number;
    END IF;
  END IF;

  IF NEW.raw_payload IS NULL AND TG_OP = 'INSERT' THEN
    NEW.raw_payload := NEW.raw_payload;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."normalize_crm_call_row"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_account_approval"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  resp jsonb;
BEGIN
  -- Only notify if the approval flag changed to true
  IF NEW.is_approved = true AND OLD.is_approved IS DISTINCT FROM NEW.is_approved THEN
    PERFORM net.http_post(
      url := 'https://your-webhook-url-here',
      body := jsonb_build_object(
        'id', NEW.id,
        'email', NEW.email,
        'approved', NEW.is_approved
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      )
    );
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_account_approval"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_vendor_of_application"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  vendor_email TEXT;
  product_title TEXT;
BEGIN
  -- Get vendor's email and product title
  SELECT p.title, pr.email INTO product_title, vendor_email
  FROM products p
  JOIN profiles pr ON p.merchant_id = pr.id
  WHERE p.id = NEW.product_id;

  -- If vendor email exists, insert a record in 'notifications' table
  IF vendor_email IS NOT NULL THEN
    INSERT INTO notifications (recipient_email, subject, message, created_at)
    VALUES (
      vendor_email,
      'New Affiliate Application Received',
      'An affiliate has applied to promote your product "' || product_title || '". Please review it in your dashboard.',
      NOW()
    );
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_vendor_of_application"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_vendor_on_new_application"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  vendor_email text;
  product_title text;
begin
  -- get the vendor email and product name
  select u.email, p.title into vendor_email, product_title
  from products p
  join auth.users u on u.id = p.merchant_id
  where p.id = new.product_id;

  -- insert into notifications table
  insert into notifications (user_id, title, message)
  values (
    (select id from auth.users where email = vendor_email),
    'New Affiliate Application',
    'Someone has applied to promote your product: ' || product_title
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."notify_vendor_on_new_application"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pages_set_position"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
    begin
      if new.position is null or new.position = 0 then
        select coalesce(max(p.position)+1, 0) into new.position
        from public.pages p
        where p.funnel_id = new.funnel_id;
      end if;
      return new;
    end;$$;


ALTER FUNCTION "public"."pages_set_position"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_abandoned_carts"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  s               record;
  cutoff          timestamptz := now() - interval '60 minutes'; -- how long before we call it abandoned

  -- your Abandoned Checkout Recovery flow id
  abandoned_flow_id uuid := '22222222-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

  -- your REAL auth user id (from auth.users)
  auth_user_id   uuid := '1079cb2f-bd80-4b43-96ae-95197887ed51';
begin
  -- loop over all open sessions older than cutoff
  for s in
    select *
    from checkout_sessions
    where status = 'open'
      and updated_at < cutoff
  loop
    -- does this store have a PAID order since they started this checkout?
    if exists (
      select 1
      from orders
      where user_id = s.user_id
        and status = 'paid'
        and created_at >= s.created_at
    ) then
      -- they bought: mark completed instead of abandoned
      update checkout_sessions
      set status = 'completed',
          updated_at = now()
      where id = s.id;
    else
      -- no order: mark abandoned
      update checkout_sessions
      set status = 'abandoned',
          updated_at = now()
      where id = s.id;

      -- and enqueue an automation job, using your auth user id
      insert into automation_queue (user_id, contact_id, flow_id, run_at, status)
      values (auth_user_id, s.contact_id, abandoned_flow_id, now(), 'pending');

      -- optional: log event
      insert into automation_events (contact_id, event_type, payload)
      values (s.contact_id, 'checkout_abandoned', jsonb_build_object(
        'session_id', s.id,
        'cart_items', s.cart_items
      ));
    end if;
  end loop;
end;
$$;


ALTER FUNCTION "public"."process_abandoned_carts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_segment"("p_user_id" "uuid", "p_list_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_tag_any" "uuid"[] DEFAULT NULL::"uuid"[], "p_tag_all" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS TABLE("id" "uuid", "email" "text")
    LANGUAGE "sql"
    AS $$
  with base as (
    select s.id, s.email
    from public.subscribers s
    where s.user_id = p_user_id
  ),
  list_filtered as (
    select distinct s.id, s.email
    from base s
    join public.list_subscribers ls on ls.subscriber_id = s.id
    where (p_list_ids is null or array_length(p_list_ids,1) is null) or ls.list_id = any(p_list_ids)
  ),
  any_filtered as (
    select distinct s.id, s.email
    from list_filtered s
    left join public.subscriber_tags st on st.subscriber_id = s.id
    where (p_tag_any is null or array_length(p_tag_any,1) is null) or st.tag_id = any(p_tag_any)
  ),
  all_filtered as (
    select s.id, s.email
    from any_filtered s
    where (p_tag_all is null or array_length(p_tag_all,1) is null)
       or not exists (
          select 1
          from unnest(p_tag_all) t(tag_id)
          where not exists (
            select 1 from public.subscriber_tags st
            where st.subscriber_id = s.id and st.tag_id = t.tag_id
          )
       )
  )
  select id, email from all_filtered;
$$;


ALTER FUNCTION "public"."resolve_segment"("p_user_id" "uuid", "p_list_ids" "uuid"[], "p_tag_any" "uuid"[], "p_tag_all" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_automation_engine"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  url text := 'https://YOUR_PUBLIC_DOMAIN_HERE/api/automation/engine/tick?force=1&key=gr8_automation_cron_9f3k2l8xQp';
begin
  perform net.http_get(url);
exception
  when others then
    raise notice 'Automation cron failed: %', sqlerrm;
end;
$$;


ALTER FUNCTION "public"."run_automation_engine"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_product_direct"("payload" "jsonb", "pid" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  update products
  set
    title = payload->>'title',
    description = payload->>'description',
    sales_page_url = payload->>'sales_page_url',
    affiliate_link = payload->>'affiliate_link',
    sale_price = coalesce((payload->>'sale_price')::numeric, 0),
    commission = coalesce((payload->>'commission')::numeric, 0),
    revenue_per_sale = coalesce((payload->>'revenue_per_sale')::numeric, 0),
    category = payload->>'category',
    thumbnail_url = payload->>'thumbnail_url',
    extra_imgs = payload->'extra_imgs',
    updated_at = now()
  where id = pid;
end;
$$;


ALTER FUNCTION "public"."save_product_direct"("payload" "jsonb", "pid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_product_fixed"("pid" "uuid", "title" "text", "description" "text", "sales_page_url" "text", "affiliate_link" "text", "sale_price" numeric, "commission" numeric, "revenue_per_sale" numeric, "category" "text", "thumbnail_url" "text", "images" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  update products
  set
    title = title,
    description = description,
    sales_page_url = sales_page_url,
    affiliate_link = affiliate_link,
    sale_price = sale_price,
    commission = commission,
    revenue_per_sale = revenue_per_sale,
    category = category,
    thumbnail_url = thumbnail_url,
    extra_imgs = images,
    updated_at = now()
  where id = pid;
end;
$$;


ALTER FUNCTION "public"."save_product_fixed"("pid" "uuid", "title" "text", "description" "text", "sales_page_url" "text", "affiliate_link" "text", "sale_price" numeric, "commission" numeric, "revenue_per_sale" numeric, "category" "text", "thumbnail_url" "text", "images" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_affiliate_slug_func"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.affiliate = true and (new.affiliate_slug is null or new.affiliate_slug = '') then
    new.affiliate_slug := 'ref/' || substr(md5(random()::text), 1, 8);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."set_affiliate_slug_func"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_campaign_list_name"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.subscriber_list_id IS NOT NULL THEN
    SELECT name
    INTO NEW.subscriber_list_name
    FROM public.email_lists
    WHERE id = NEW.subscriber_list_id;
  ELSE
    NEW.subscriber_list_name := NULL;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_campaign_list_name"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_page_position"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if TG_OP = 'INSERT' then
    NEW.position := public.next_page_position(NEW.funnel_id);
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."set_page_position"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_site_projects_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_site_projects_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_email_campaign"("p_campaign_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_campaign record;
  v_rows     integer;
begin
  -- Get the campaign row
  select *
  into v_campaign
  from public.email_campaigns
  where id = p_campaign_id;

  if not found then
    raise exception 'Campaign % not found', p_campaign_id;
  end if;

  -- Queue one email per LEAD in the chosen list
  insert into public.email_campaign_queue (
    user_id,
    campaign_id,
    lead_id,
    email_index,
    scheduled_at,
    status
  )
  select
    v_campaign.user_id,
    v_campaign.id,
    l.id,          -- lead id
    1,             -- first email in the series for now
    now(),         -- send immediately
    'queued'
  from public.leads l
  where l.user_id = v_campaign.user_id
    and l.list_id = v_campaign.subscriber_list_id;

  -- How many rows did we add?
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    raise exception 'No leads found for this campaign list. Add leads first, then try again.';
  end if;

  -- Update campaign status
  update public.email_campaigns
  set status = 'sending'
  where id = v_campaign.id;

  return 'ok';
end;
$$;


ALTER FUNCTION "public"."start_email_campaign"("p_campaign_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_email_list_members_lead_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
    begin
      if new.lead_id is null and new.email is not null then
        select id into new.lead_id
        from public.leads
        where lower(trim(email)) = lower(trim(new.email))
        limit 1;
      end if;
      return new;
    end;
    $$;


ALTER FUNCTION "public"."sync_email_list_members_lead_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin new.updated_at = now(); return new; end $$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_lead_contacts_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_lead_contacts_timestamp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_lead_email_records_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_lead_email_records_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_leads_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_leads_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_product_safe"("pid" "uuid", "payload" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  update products
  set
    title = payload->>'title',
    description = payload->>'description',
    sales_page_url = payload->>'sales_page_url',
    affiliate_link = payload->>'affiliate_link',
    sale_price = (payload->>'sale_price')::numeric,
    commission = (payload->>'commission')::numeric,
    revenue_per_sale = (payload->>'revenue_per_sale')::numeric,
    category = payload->>'category',
    thumbnail_url = payload->>'thumbnail_url',
    extra_imgs = payload->'extra_imgs',
    updated_at = now()
  where id = pid;
end;
$$;


ALTER FUNCTION "public"."update_product_safe"("pid" "uuid", "payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_site_projects_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_site_projects_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_vendor_flag"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  update accounts
  set vendor_agreement_signed = true,
      updated_at = now()
  where user_id = new.user_id;
  return new;
end;
$$;


ALTER FUNCTION "public"."update_vendor_flag"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."access_codes" (
    "code" "text" NOT NULL,
    "unlock_all" boolean DEFAULT false NOT NULL,
    "modules" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "max_uses" integer,
    "uses" integer DEFAULT 0 NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "expires_at" timestamp with time zone,
    "last_used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "note" "text"
);


ALTER TABLE "public"."access_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."account_members" (
    "account_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "account_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'editor'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."account_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "business_logo" "text",
    "business_avatar" "text",
    "full_name" "text",
    "email" "text",
    "phone" "text",
    "country" "text",
    "business_name" "text",
    "abn" "text",
    "tax_country" "text",
    "affiliate" boolean DEFAULT false,
    "vendor" boolean DEFAULT false,
    "paypal_email" "text",
    "bank_account" "text",
    "agree_terms" boolean DEFAULT false,
    "agree_privacy" boolean DEFAULT false,
    "user_id" "uuid",
    "id_back_url" "text",
    "id_front_url" "text",
    "proof_of_address_url" "text",
    "approved" boolean DEFAULT false,
    "is_approved" boolean DEFAULT false,
    "dob" "date",
    "residential_address" "text",
    "residential_city" "text",
    "residential_state" "text",
    "residential_postcode" "text",
    "residential_country" "text",
    "alt_phone" "text",
    "business_address" "text",
    "business_city" "text",
    "business_state" "text",
    "business_postcode" "text",
    "business_country" "text",
    "postal_address" "text",
    "postal_city" "text",
    "postal_state" "text",
    "postal_postcode" "text",
    "postal_country" "text",
    "same_as_business" boolean DEFAULT false,
    "business_phone" "text",
    "business_email" "text",
    "position" "text",
    "website" "text",
    "linkedin" "text",
    "registration_doc_url" "text",
    "company" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "subscription_status" "text" DEFAULT 'none'::"text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "affiliate_slug" "text",
    "vendor_agreement_signed" boolean DEFAULT false,
    "business_id" "text",
    "driver_card_number" "text",
    "driver_expiry" "text",
    "driver_licence_number" "text",
    "auth_id" "uuid",
    "email_plan_tier" "text" DEFAULT 'email-starter'::"text",
    "email_subscribers_count" integer DEFAULT 0,
    "email_emails_sent_month" integer DEFAULT 0,
    "email_plan_effective_date" timestamp without time zone DEFAULT "now"(),
    "email_plan" "text",
    "email_plan_price" numeric,
    "email_plan_updated_at" timestamp with time zone DEFAULT "now"(),
    "sendgrid_api_key" "text",
    "sendgrid_connected" boolean DEFAULT false,
    "sendgrid_domain" "text",
    "sendgrid_verified" boolean DEFAULT false,
    "sendgrid_key_issued" boolean DEFAULT false,
    "sendgrid_key_created_at" timestamp with time zone,
    "dkim_domain" "text",
    "dkim_records" "jsonb",
    "dkim_verified" boolean DEFAULT false,
    "twilio_phone" "text",
    "sendgrid_from_email" "text",
    "sendgrid_from_name" "text",
    "sendgrid_reply_to" "text"
);


ALTER TABLE "public"."accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activities" (
    "id" "uuid" NOT NULL,
    "owner" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "text" "text",
    "meta" "jsonb",
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_demo_backup_email_broadcasts" (
    "id" "uuid",
    "user_id" "uuid",
    "title" "text",
    "subject" "text",
    "to_field" "text",
    "html_content" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "preheader" "text",
    "from_name" "text",
    "from_email" "text",
    "reply_to" "text",
    "audience_type" "text",
    "list_id" "uuid",
    "saved_email_path" "text",
    "recipients" "text"[],
    "ab_enabled" boolean,
    "ab_subject_a" "text",
    "ab_subject_b" "text",
    "name" "text"
);


ALTER TABLE "public"."admin_demo_backup_email_broadcasts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_demo_backup_email_sends" (
    "id" "uuid",
    "user_id" "uuid",
    "broadcast_id" "uuid",
    "campaign_id" "uuid",
    "automation_id" "uuid",
    "email" "text",
    "variant" "text",
    "status" "text",
    "sent_at" timestamp with time zone,
    "open_count" integer,
    "first_open_at" timestamp with time zone,
    "last_open_at" timestamp with time zone,
    "click_count" integer,
    "last_click_at" timestamp with time zone,
    "unsubscribed" boolean,
    "recipient_email" "text",
    "email_type" "text",
    "autoresponder_id" "uuid",
    "opened_at" timestamp with time zone,
    "clicked_at" timestamp with time zone,
    "bounced_at" timestamp with time zone,
    "unsubscribed_at" timestamp with time zone,
    "message_hash" "text",
    "sg_message_id" "text",
    "processed_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "spam_reported" boolean,
    "last_event" "text",
    "last_event_at" timestamp with time zone,
    "send_id" "text",
    "subscriber_id" "uuid",
    "created_at" timestamp with time zone,
    "sendgrid_message_id" "text",
    "error_message" "text",
    "ab_enabled" boolean,
    "ab_variant" "text",
    "subject" "text",
    "broadcast_title" "text",
    "broadcast_subject" "text",
    "preheader" "text"
);


ALTER TABLE "public"."admin_demo_backup_email_sends" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_send_debug_backups" (
    "id" "uuid",
    "user_id" "uuid",
    "broadcast_id" "uuid",
    "campaign_id" "uuid",
    "automation_id" "uuid",
    "email" "text",
    "variant" "text",
    "status" "text",
    "sent_at" timestamp with time zone,
    "open_count" integer,
    "first_open_at" timestamp with time zone,
    "last_open_at" timestamp with time zone,
    "click_count" integer,
    "last_click_at" timestamp with time zone,
    "unsubscribed" boolean,
    "recipient_email" "text",
    "email_type" "text",
    "autoresponder_id" "uuid",
    "opened_at" timestamp with time zone,
    "clicked_at" timestamp with time zone,
    "bounced_at" timestamp with time zone,
    "unsubscribed_at" timestamp with time zone,
    "message_hash" "text",
    "sg_message_id" "text",
    "processed_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "spam_reported" boolean,
    "last_event" "text",
    "last_event_at" timestamp with time zone,
    "send_id" "text",
    "subscriber_id" "uuid",
    "created_at" timestamp with time zone,
    "sendgrid_message_id" "text",
    "error_message" "text",
    "ab_enabled" boolean,
    "ab_variant" "text",
    "subject" "text",
    "broadcast_title" "text",
    "broadcast_subject" "text",
    "preheader" "text"
);


ALTER TABLE "public"."admin_send_debug_backups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admins" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."admins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."affiliate_applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "affiliate_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "affiliate_link" "text",
    "user_id" "uuid",
    "name" "text",
    "email" "text",
    "message" "text"
);


ALTER TABLE "public"."affiliate_applications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."affiliate_clicks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "affiliate_id" "uuid",
    "product_id" "uuid",
    "ip_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."affiliate_clicks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."affiliate_conversions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "affiliate_id" "uuid",
    "product_id" "uuid",
    "amount" numeric(10,2),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."affiliate_conversions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."affiliate_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "affiliate_id" "uuid" NOT NULL,
    "tracking_code" "text" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."affiliate_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."affiliate_marketplace" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "product_name" "text",
    "product_description" "text",
    "product_url" "text",
    "image_url" "text",
    "commission_rate" numeric,
    "payout_schedule" "text",
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."affiliate_marketplace" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."affiliate_payouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "affiliate_id" "uuid",
    "amount" numeric(10,2),
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."affiliate_payouts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "api_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "revoked" boolean DEFAULT false
);


ALTER TABLE "public"."api_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automation_actions__deprecated" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "queue_id" "uuid",
    "action_type" "text",
    "payload" "jsonb",
    "scheduled_at" timestamp with time zone,
    "executed_at" timestamp with time zone
);


ALTER TABLE "public"."automation_actions__deprecated" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automation_color_settings" (
    "user_id" "uuid" NOT NULL,
    "trigger_color" "text" DEFAULT '#22c55e'::"text" NOT NULL,
    "email_color" "text" DEFAULT '#eab308'::"text" NOT NULL,
    "delay_color" "text" DEFAULT '#f97316'::"text" NOT NULL,
    "condition_color" "text" DEFAULT '#a855f7'::"text" NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."automation_color_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automation_email_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "flow_id" "uuid" NOT NULL,
    "node_id" "text" NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "to_email" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "html_content" "text" NOT NULL,
    "variant" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "sendgrid_message_id" "text",
    "open_count" integer DEFAULT 0,
    "click_count" integer DEFAULT 0,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "sent_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "email_name" "text",
    CONSTRAINT "automation_email_queue_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'failed'::"text", 'bounced'::"text"])))
);


ALTER TABLE "public"."automation_email_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automation_enrollments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "flow_id" "uuid" NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "source" "text",
    "current_node_id" "text",
    "status" "text" DEFAULT 'active'::"text",
    "entered_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."automation_enrollments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automation_events__deprecated" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."automation_events__deprecated" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automation_flow_lists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "flow_id" "uuid" NOT NULL,
    "list_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."automation_flow_lists" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automation_flow_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "flow_id" "uuid" NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'active'::"text",
    "source" "text" DEFAULT 'manual'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."automation_flow_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automation_flow_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "flow_id" "uuid" NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "current_node_id" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "available_at" timestamp with time zone,
    "source" "text",
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sendgrid_message_id" "text"
);


ALTER TABLE "public"."automation_flow_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automation_flows" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "nodes" "jsonb",
    "edges" "jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "name" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_standard" boolean DEFAULT false
);


ALTER TABLE "public"."automation_flows" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automation_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "subscriber_id" "uuid" NOT NULL,
    "flow_id" "uuid" NOT NULL,
    "node_id" "text" NOT NULL,
    "node_type" "text" NOT NULL,
    "action" "text" NOT NULL,
    "status" "text" DEFAULT 'success'::"text",
    "message" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "automation_logs_status_check" CHECK (("status" = ANY (ARRAY['success'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."automation_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automation_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "subscriber_id" "uuid",
    "flow_id" "uuid" NOT NULL,
    "next_node_id" "text",
    "run_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "lead_id" "text",
    "list_id" "text",
    "contact_id" "uuid",
    CONSTRAINT "automation_queue_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'done'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."automation_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blocks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "page_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "type" "text" NOT NULL,
    "props" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "position" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "blocks_type_check" CHECK (("type" = ANY (ARRAY['text'::"text", 'image'::"text", 'form'::"text"])))
);


ALTER TABLE "public"."blocks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."checkout_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "cart_items" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."checkout_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clicks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "link_id" "uuid" NOT NULL,
    "ip_address" "text",
    "user_agent" "text",
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."clicks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."commissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sale_id" "uuid" NOT NULL,
    "affiliate_id" "uuid" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."commissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."communities" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_public" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_global" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."communities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."community_channels" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "community_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_private" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."community_channels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."community_code_acceptances" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "policy_version" integer DEFAULT 1 NOT NULL,
    "accepted_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."community_code_acceptances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."community_posts" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "channel_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "image_url" "text"
);


ALTER TABLE "public"."community_posts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contact_notes" (
    "id" "uuid" NOT NULL,
    "owner" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "text" "text",
    "sentiment" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid"
);


ALTER TABLE "public"."contact_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_enrolments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "access_level" "text" DEFAULT 'modules'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."course_enrolments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_entitlements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "module_id" "uuid",
    "entitlement_type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "course_entitlements_module_check" CHECK (((("entitlement_type" = 'full_course'::"text") AND ("module_id" IS NULL)) OR (("entitlement_type" = 'module'::"text") AND ("module_id" IS NOT NULL)))),
    CONSTRAINT "course_entitlements_type_check" CHECK (("entitlement_type" = ANY (ARRAY['full_course'::"text", 'module'::"text"])))
);


ALTER TABLE "public"."course_entitlements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_lessons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "module_id" "uuid" NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "sort_order" integer DEFAULT 1 NOT NULL,
    "content_type" "text" DEFAULT 'video'::"text" NOT NULL,
    "content_url" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."course_lessons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_modules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "sort_order" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."course_modules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_pricing" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "scope" "text" NOT NULL,
    "module_id" "uuid",
    "price_cents" integer DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'AUD'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "course_pricing_module_scope_check" CHECK (((("scope" = 'full_course'::"text") AND ("module_id" IS NULL)) OR (("scope" = 'module'::"text") AND ("module_id" IS NOT NULL)))),
    CONSTRAINT "course_pricing_scope_check" CHECK (("scope" = ANY (ARRAY['full_course'::"text", 'module'::"text"])))
);


ALTER TABLE "public"."course_pricing" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_vendors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "display_name" "text" DEFAULT 'New Vendor'::"text" NOT NULL,
    "commission_percent" numeric DEFAULT 20 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."course_vendors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."courses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "cover_url" "text" DEFAULT ''::"text" NOT NULL,
    "is_published" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."courses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_calls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "account_id" "uuid",
    "direction" "text" DEFAULT 'inbound'::"text",
    "from_number" "text",
    "to_number" "text",
    "caller_name" "text",
    "status" "text",
    "recording_url" "text",
    "recording_duration" integer,
    "transcription" "text",
    "twilio_sid" "text",
    "raw_payload" "jsonb",
    "lead_id" "uuid",
    "duration" integer,
    "unread" boolean DEFAULT true,
    "our_number" "text",
    "contact_number" "text",
    "recording_sid" "text",
    "tw_start_at" timestamp with time zone,
    CONSTRAINT "crm_calls_direction_check" CHECK (("direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text"])))
);


ALTER TABLE "public"."crm_calls" OWNER TO "postgres";


COMMENT ON COLUMN "public"."crm_calls"."from_number" IS 'Phone number the call came from (from Twilio)';



COMMENT ON COLUMN "public"."crm_calls"."to_number" IS 'Phone number the call went to (from Twilio)';



COMMENT ON COLUMN "public"."crm_calls"."tw_start_at" IS 'Start time from Twilio for auditing/sync checks';



CREATE TABLE IF NOT EXISTS "public"."crm_field_values" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid",
    "field_id" "uuid",
    "value" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."crm_field_values" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_fields" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pipeline_id" "uuid",
    "label" "text" NOT NULL,
    "type" "text" DEFAULT 'text'::"text",
    "options" "text"[],
    "position" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."crm_fields" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_our_numbers" (
    "number" "text" NOT NULL,
    "description" "text"
);


ALTER TABLE "public"."crm_our_numbers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_pipelines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "stages" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."crm_pipelines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_tasks" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "contact_id" "uuid",
    "title" "text" NOT NULL,
    "notes" "text",
    "due_date" "date",
    "completed" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "task_type" "text",
    "task_time" time without time zone,
    "location" "text"
);


ALTER TABLE "public"."crm_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."discount_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "discount_percent" numeric NOT NULL,
    "description" "text",
    "active" boolean DEFAULT true NOT NULL,
    "expiry_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "discount_codes_discount_percent_check" CHECK ((("discount_percent" >= (0)::numeric) AND ("discount_percent" <= (100)::numeric)))
);


ALTER TABLE "public"."discount_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."discount_tiers" (
    "id" bigint NOT NULL,
    "min_count" integer NOT NULL,
    "percent_off" integer NOT NULL,
    CONSTRAINT "discount_tiers_percent_off_check" CHECK ((("percent_off" >= 0) AND ("percent_off" <= 100)))
);


ALTER TABLE "public"."discount_tiers" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."discount_tiers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."discount_tiers_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."discount_tiers_id_seq" OWNED BY "public"."discount_tiers"."id";



CREATE TABLE IF NOT EXISTS "public"."dkim_records" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "domain" "text" NOT NULL,
    "selector" "text" NOT NULL,
    "public_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."dkim_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_ab_tests" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "context_type" "text" NOT NULL,
    "context_id" "uuid" NOT NULL,
    "test_name" "text",
    "test_size_percent" integer DEFAULT 20 NOT NULL,
    "variant_count" integer DEFAULT 2 NOT NULL,
    "metric" "text" DEFAULT 'open'::"text" NOT NULL,
    "duration_minutes" integer DEFAULT 240 NOT NULL,
    "send_remaining_at" timestamp with time zone,
    "winner_variant" "text",
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "email_ab_tests_context_type_check" CHECK (("context_type" = ANY (ARRAY['broadcast'::"text", 'campaign'::"text", 'automation'::"text"])))
);


ALTER TABLE "public"."email_ab_tests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_ab_variants" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "ab_test_id" "uuid" NOT NULL,
    "variant_key" "text" NOT NULL,
    "subject_line" "text",
    "template_id" "uuid",
    "from_name" "text",
    "from_email" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."email_ab_variants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_automations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner" "uuid",
    "name" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "trigger" "text" DEFAULT 'manual'::"text" NOT NULL,
    "steps" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "trigger_type" "text" DEFAULT 'signup'::"text",
    "delay_days" integer DEFAULT 0,
    "email_template_id" "uuid",
    "list_id" "uuid",
    "is_active" boolean DEFAULT true,
    "active_days" "text"[] DEFAULT ARRAY[]::"text"[],
    "delay_type" "text" DEFAULT 'immediate'::"text",
    "delay_value" integer DEFAULT 0,
    "send_timezone" "text" DEFAULT 'Australia/Sydney'::"text",
    "user_id" "uuid",
    "send_day" "text",
    "send_time" "text",
    "from_name" "text",
    "from_email" "text",
    "reply_to" "text",
    "subject" "text",
    "template_id" "uuid",
    "template_path" "text"
);


ALTER TABLE "public"."email_automations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_autoresponder_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "autoresponder_id" "uuid" NOT NULL,
    "list_id" "uuid" NOT NULL,
    "lead_id" "uuid",
    "to_email" "text" NOT NULL,
    "to_name" "text",
    "subject" "text" NOT NULL,
    "template_path" "text" NOT NULL,
    "scheduled_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "provider_message_id" "text",
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."email_autoresponder_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_broadcasts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text",
    "subject" "text",
    "to_field" "text",
    "html_content" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "preheader" "text",
    "from_name" "text",
    "from_email" "text",
    "reply_to" "text",
    "audience_type" "text",
    "list_id" "uuid",
    "saved_email_path" "text",
    "recipients" "text"[],
    "ab_enabled" boolean,
    "ab_subject_a" "text",
    "ab_subject_b" "text",
    "name" "text"
);


ALTER TABLE "public"."email_broadcasts" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."email_campaign_queue_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."email_campaign_queue_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."email_campaign_queue_id_seq" OWNED BY "public"."email_campaigns_queue"."id";



CREATE TABLE IF NOT EXISTS "public"."email_campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text",
    "status" "text" DEFAULT 'draft'::"text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "from_name" "text",
    "from_email" "text",
    "subscriber_list_id" "uuid",
    "send_to_all" boolean DEFAULT false,
    "email1_subject" "text",
    "email2_subject" "text",
    "email3_subject" "text",
    "email1_preheader" "text",
    "email2_preheader" "text",
    "email3_preheader" "text",
    "email1_template_id" "text",
    "email2_template_id" "text",
    "email3_template_id" "text",
    "email1_delay_minutes" integer DEFAULT 0,
    "email2_delay_minutes" integer DEFAULT 0,
    "email3_delay_minutes" integer DEFAULT 0,
    "extra_recipients" "text",
    "send_test_email" "text",
    "reply_to" "text",
    "audience_type" "text",
    "audience" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "outline" "text",
    "reply_to_email" "text",
    "updated_at" timestamp with time zone,
    "subscriber_list_name" "text",
    "list_id" "uuid"
);


ALTER TABLE "public"."email_campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_campaigns_sends" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "campaign_id" "uuid" NOT NULL,
    "subscriber_id" "uuid",
    "email_lower" "text" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "sent_at" timestamp with time zone,
    "open_token" "uuid",
    "click_token" "uuid",
    "unsubscribe_token" "uuid",
    "open_count" integer DEFAULT 0 NOT NULL,
    "click_count" integer DEFAULT 0 NOT NULL,
    "last_opened_at" timestamp with time zone,
    "last_clicked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "email_campaign_sends_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'sent'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."email_campaigns_sends" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_clicks" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "broadcast_id" "uuid",
    "send_id" "uuid",
    "email" "text" NOT NULL,
    "url" "text",
    "clicked_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."email_clicks" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."email_clicks_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."email_clicks_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."email_clicks_id_seq" OWNED BY "public"."email_clicks"."id";



CREATE TABLE IF NOT EXISTS "public"."email_dkim" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "domain" "text" NOT NULL,
    "selector" "text" NOT NULL,
    "public_key" "text" NOT NULL,
    "txt_record" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."email_dkim" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_events" (
    "id" "uuid" NOT NULL,
    "owner" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "campaign_id" "text",
    "event" "text" NOT NULL,
    "url" "text",
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."email_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_flow_enrolments" (
    "id" "uuid" NOT NULL,
    "flow_id" "uuid" NOT NULL,
    "subscriber_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "current_step_position" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "email_flow_enrolments_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'completed'::"text", 'paused'::"text"])))
);


ALTER TABLE "public"."email_flow_enrolments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_flow_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "automation_id" "uuid",
    "subscriber_id" "uuid",
    "started_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'running'::"text"
);


ALTER TABLE "public"."email_flow_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_flow_steps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "flow_run_id" "uuid",
    "node_id" "text",
    "node_type" "text",
    "executed_at" timestamp with time zone DEFAULT "now"(),
    "outcome" "text"
);


ALTER TABLE "public"."email_flow_steps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_flows" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."email_flows" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_list_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "list_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "autoresponder" boolean DEFAULT false,
    "crm" boolean DEFAULT false,
    "funnel" boolean DEFAULT false,
    "broadcasts" boolean DEFAULT false,
    "automation" boolean DEFAULT false,
    "ab_testing" boolean DEFAULT false,
    "courses" boolean DEFAULT false,
    "phone" "text",
    "company" "text",
    "country" "text",
    "opt_in_status" "text" DEFAULT 'Single Opt-in'::"text",
    "lead_id" "uuid"
);


ALTER TABLE "public"."email_list_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_lists" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "action" "text" DEFAULT 'none'::"text",
    "pipeline_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "default_source" "text",
    "default_tags" "text",
    "webhook_url" "text",
    "color" "text",
    "icon" "text",
    "auto_add_settings" "jsonb" DEFAULT '[]'::"jsonb",
    "flow_id" "uuid",
    "facebook_pixel" "text",
    "facebook_form_id" "text",
    "facebook_token" "text",
    "instagram_token" "text",
    "tiktok_pixel" "text",
    "tiktok_token" "text",
    "linkedin_form_id" "text",
    "linkedin_token" "text",
    "youtube_key" "text",
    "pinterest_tag" "text",
    "custom_code" "text",
    "api_key" "text",
    "auto_add_crm" boolean DEFAULT false,
    "tags" "text",
    "pipelines" "text"[],
    "flows" "text"[],
    "source_type" "text",
    "updated_at" timestamp with time zone,
    CONSTRAINT "lead_lists_action_check" CHECK (("action" = ANY (ARRAY['None'::"text", 'CRM'::"text", 'Automation'::"text", 'Both'::"text"])))
);


ALTER TABLE "public"."lead_lists" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."email_lists" AS
 SELECT "id",
    "user_id",
    "name",
    "created_at"
   FROM "public"."lead_lists";


ALTER VIEW "public"."email_lists" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "name" "text" NOT NULL,
    "subject" "text",
    "html_content" "text",
    "template_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_public" boolean DEFAULT false
);


ALTER TABLE "public"."email_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_senders" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "from_name" "text",
    "from_email" "text",
    "reply_to" "text",
    "verified" boolean DEFAULT false,
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."email_senders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_sends" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "broadcast_id" "uuid",
    "campaign_id" "uuid",
    "automation_id" "uuid",
    "email" "text" NOT NULL,
    "variant" "text",
    "status" "text" DEFAULT 'sent'::"text",
    "sent_at" timestamp with time zone DEFAULT "now"(),
    "open_count" integer DEFAULT 0,
    "first_open_at" timestamp with time zone,
    "last_open_at" timestamp with time zone,
    "click_count" integer DEFAULT 0,
    "last_click_at" timestamp with time zone,
    "unsubscribed" boolean DEFAULT false,
    "recipient_email" "text",
    "email_type" "text",
    "autoresponder_id" "uuid",
    "opened_at" timestamp with time zone,
    "clicked_at" timestamp with time zone,
    "bounced_at" timestamp with time zone,
    "unsubscribed_at" timestamp with time zone,
    "message_hash" "text",
    "sg_message_id" "text",
    "processed_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "spam_reported" boolean DEFAULT false NOT NULL,
    "last_event" "text",
    "last_event_at" timestamp with time zone,
    "send_id" "text",
    "subscriber_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sendgrid_message_id" "text",
    "error_message" "text",
    "ab_enabled" boolean DEFAULT false,
    "ab_variant" "text",
    "subject" "text",
    "broadcast_title" "text",
    "broadcast_subject" "text",
    "preheader" "text"
);


ALTER TABLE "public"."email_sends" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_sends_cleanup_backup" (
    "id" "uuid",
    "user_id" "uuid",
    "broadcast_id" "uuid",
    "campaign_id" "uuid",
    "automation_id" "uuid",
    "email" "text",
    "variant" "text",
    "status" "text",
    "sent_at" timestamp with time zone,
    "open_count" integer,
    "first_open_at" timestamp with time zone,
    "last_open_at" timestamp with time zone,
    "click_count" integer,
    "last_click_at" timestamp with time zone,
    "unsubscribed" boolean,
    "recipient_email" "text",
    "email_type" "text",
    "autoresponder_id" "uuid",
    "opened_at" timestamp with time zone,
    "clicked_at" timestamp with time zone,
    "bounced_at" timestamp with time zone,
    "unsubscribed_at" timestamp with time zone,
    "message_hash" "text",
    "sg_message_id" "text",
    "processed_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "spam_reported" boolean,
    "last_event" "text",
    "last_event_at" timestamp with time zone,
    "send_id" "text",
    "subscriber_id" "uuid",
    "created_at" timestamp with time zone,
    "sendgrid_message_id" "text",
    "error_message" "text",
    "ab_enabled" boolean,
    "ab_variant" "text",
    "subject" "text",
    "broadcast_title" "text",
    "broadcast_subject" "text",
    "preheader" "text"
);


ALTER TABLE "public"."email_sends_cleanup_backup" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_suppressions" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "email_lower" "text" NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."email_suppressions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text",
    "subject" "text",
    "html_content" "text",
    "thumbnail_url" "text",
    "category" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "storage_path" "text"
);


ALTER TABLE "public"."email_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_unsubscribes" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "broadcast_id" "uuid",
    "email" "text" NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."email_unsubscribes" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."email_unsubscribes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."email_unsubscribes_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."email_unsubscribes_id_seq" OWNED BY "public"."email_unsubscribes"."id";



CREATE TABLE IF NOT EXISTS "public"."email_uploads" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "file_name" "text",
    "file_url" "text",
    "category" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    CONSTRAINT "email_uploads_category_check" CHECK (("category" = ANY (ARRAY['template'::"text", 'image'::"text", 'block'::"text"])))
);


ALTER TABLE "public"."email_uploads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."entitlements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "module_slug" "text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "current_period_end" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."entitlements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "funnel_id" "uuid",
    "step_id" "uuid",
    "list_id" "uuid",
    "email" "text",
    "name" "text",
    "payload" "jsonb",
    "user_id" "uuid"
);


ALTER TABLE "public"."form_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."funnel_steps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "funnel_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" DEFAULT ''::"text",
    "order_index" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."funnel_steps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."funnels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"(),
    "owner_user_id" "uuid" NOT NULL,
    "slug" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "description" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notify_email" "text",
    "default_list_id" "uuid",
    CONSTRAINT "funnels_status_chk" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."funnels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_followups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "next_contact_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."lead_followups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_list_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "list_id" "uuid" NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lead_list_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_list_members_backup" (
    "id" "uuid",
    "user_id" "uuid",
    "list_id" "uuid",
    "lead_id" "uuid",
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."lead_list_members_backup" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_list_members_backup_20260120" (
    "id" "uuid",
    "user_id" "uuid",
    "list_id" "uuid",
    "lead_id" "uuid",
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."lead_list_members_backup_20260120" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "note" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."lead_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "pipeline_id" "uuid",
    "stage" "text",
    "name" "text",
    "email" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "list_id" "uuid",
    "phone" "text",
    "source" "text",
    "tags" "text",
    "notes" "text",
    "avatar_icon" "text" DEFAULT '🙂'::"text",
    "avatar_color" "text" DEFAULT '#3b82f6'::"text",
    "unsubscribed_at" timestamp with time zone
);


ALTER TABLE "public"."leads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."list_api_keys" (
    "id" "uuid" NOT NULL,
    "list_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "api_key" "text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."list_api_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."modules" (
    "id" "text" NOT NULL,
    "name" "text",
    "price_cents" integer DEFAULT 0,
    "active" boolean DEFAULT true,
    "stripe_price_id" "text",
    "paypal_plan_id" "text",
    "currency" "text",
    "interval" "text",
    "stripe_product_id" "text",
    "description" "text"
);


ALTER TABLE "public"."modules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" NOT NULL,
    "recipient_email" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "message" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "read" boolean DEFAULT false
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "amount_cents" integer NOT NULL,
    "currency" "text" DEFAULT 'AUD'::"text" NOT NULL,
    "status" "text" DEFAULT 'paid'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organisation_members" (
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'owner'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."organisation_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organisations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "logo_url" "text",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."organisations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."page_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "meta" "jsonb" DEFAULT '{}'::"jsonb",
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."page_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "funnel_id" "uuid",
    "title" "text",
    "html" "text",
    "css" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"(),
    "slug" "text",
    "published" boolean DEFAULT false,
    "position" integer,
    "views" bigint DEFAULT 0 NOT NULL,
    "blocks" "jsonb",
    "tenant_id" "uuid",
    "owner_user_id" "uuid"
);


ALTER TABLE "public"."pages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid",
    "amount" numeric(10,2) NOT NULL,
    "status" "text" DEFAULT 'completed'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "module" "text"
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "affiliate_id" "uuid" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "method" "text",
    "status" "text" DEFAULT 'processing'::"text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "affiliate_earnings" numeric,
    "platform_earnings" numeric,
    "total_deduction" numeric,
    "commission_rate" numeric,
    "sale_amount" numeric
);


ALTER TABLE "public"."payouts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pipeline_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "stages" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "public" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pipeline_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "description" "text",
    "category" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "user_id" "uuid" DEFAULT "auth"."uid"(),
    "affiliate_link" "text",
    "sales_page_url" "text",
    "commission" numeric(10,2),
    "thumbnail_url" "text",
    "gallery_urls" "text"[],
    "title" "text",
    "gravity_score" numeric,
    "avg_commission" numeric,
    "conversion_rate" numeric,
    "cookie_days" integer,
    "epc" numeric,
    "rebill_total" numeric,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "price" numeric,
    "images" "jsonb",
    "sale_price" numeric(10,2) DEFAULT 0,
    "revenue_per_sale" numeric(10,2) DEFAULT 0,
    "extra_images" "jsonb" DEFAULT '[]'::"jsonb",
    "merchant_id" "uuid",
    "extra_imgs" "jsonb" DEFAULT '[]'::"jsonb"
);


ALTER TABLE "public"."products" OWNER TO "postgres";


COMMENT ON COLUMN "public"."products"."extra_imgs" IS 'refresh cache';



CREATE TABLE IF NOT EXISTS "public"."sales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "link_id" "uuid" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "currency" "text" DEFAULT 'AUD'::"text",
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."sales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sendgrid_events" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event" "text",
    "email" "text",
    "timestamp" bigint,
    "sg_message_id" "text",
    "sg_event_id" "text",
    "payload" "jsonb"
);


ALTER TABLE "public"."sendgrid_events" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."sendgrid_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."sendgrid_events_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."sendgrid_events_id_seq" OWNED BY "public"."sendgrid_events"."id";



CREATE TABLE IF NOT EXISTS "public"."sendgrid_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "account_name" "text" NOT NULL,
    "api_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sendgrid_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."site_projects" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" DEFAULT 'landing'::"text" NOT NULL,
    "html" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "template_slug" "text" DEFAULT 'blank'::"text" NOT NULL,
    "theme_slug" "text" DEFAULT 'modern-blue'::"text" NOT NULL,
    "is_published" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."site_projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sms_delivery_receipts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "provider_id" "text",
    "to" "text",
    "status" "text",
    "delivered_at" timestamp with time zone,
    "raw" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sms_delivery_receipts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sms_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "lead_id" "uuid",
    "list_id" "uuid",
    "provider" "text" DEFAULT 'smsglobal'::"text" NOT NULL,
    "provider_id" "text",
    "to" "text" NOT NULL,
    "body" "text" NOT NULL,
    "send_status" "text",
    "delivery_status" "text",
    "delivered_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_receipt_raw" "jsonb"
);


ALTER TABLE "public"."sms_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sms_provider_settings" (
    "org_id" "uuid" NOT NULL,
    "provider" "text" DEFAULT 'smsglobal'::"text" NOT NULL,
    "api_key" "text",
    "api_secret" "text",
    "origin" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sms_provider_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sms_queue" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "step_no" integer NOT NULL,
    "to_phone" "text" NOT NULL,
    "body" "text" NOT NULL,
    "scheduled_for" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "provider_message_id" "text",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "sent_at" timestamp with time zone,
    "origin" "text",
    "available_at" timestamp with time zone DEFAULT "now"(),
    "provider_id" "text",
    "last_error" "text"
);


ALTER TABLE "public"."sms_queue" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."sms_queue_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."sms_queue_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."sms_queue_id_seq" OWNED BY "public"."sms_queue"."id";



CREATE TABLE IF NOT EXISTS "public"."sms_sends" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "lead_id" "uuid",
    "to_phone" "text" NOT NULL,
    "body" "text" NOT NULL,
    "status" "text" DEFAULT 'sent'::"text" NOT NULL,
    "provider_message_id" "text",
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "delivered_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "reply_count" integer DEFAULT 0,
    "last_event" "text",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sms_sends" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sms_sequence_steps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sequence_id" "uuid" NOT NULL,
    "step_no" integer NOT NULL,
    "template_id" "uuid",
    "body" "text" NOT NULL,
    "delay_seconds" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "sms_sequence_steps_step_no_check" CHECK ((("step_no" >= 1) AND ("step_no" <= 3)))
);


ALTER TABLE "public"."sms_sequence_steps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sms_sequences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sms_sequences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sms_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "name" "text" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sms_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "slug" "text" NOT NULL,
    "page_id" "uuid",
    "funnel_id" "uuid",
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "ip" "inet",
    "ua" "text"
);


ALTER TABLE "public"."submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriber_tags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subscriber_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."subscriber_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscribers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "phone" "text",
    "org_id" "uuid",
    "owner" "uuid" DEFAULT "auth"."uid"(),
    "list_id" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "affiliate_slug" "text",
    CONSTRAINT "chk_subscribers_email_format" CHECK (("email" ~* '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$'::"text"))
);


ALTER TABLE "public"."subscribers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid",
    "module" "text" NOT NULL,
    "price" numeric(10,2) DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true,
    "cancelled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."suppression_emails" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."suppression_emails" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL
);


ALTER TABLE "public"."tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."telephony_messages" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone,
    "channel" "text" DEFAULT 'sms'::"text" NOT NULL,
    "direction" "text" DEFAULT 'outbound'::"text" NOT NULL,
    "to_number" "text",
    "from_number" "text",
    "messaging_service_sid" "text",
    "body" "text",
    "twilio_sid" "text",
    "status" "text",
    "error" "text",
    "error_code" "text",
    "lead_id" "uuid",
    "user_id" "uuid"
);


ALTER TABLE "public"."telephony_messages" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."telephony_messages_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."telephony_messages_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."telephony_messages_id_seq" OWNED BY "public"."telephony_messages"."id";



CREATE TABLE IF NOT EXISTS "public"."templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "slug" "text",
    "html" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."test" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text"
);


ALTER TABLE "public"."test" OWNER TO "postgres";


ALTER TABLE "public"."test" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."test_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."trigger_logs" (
    "id" bigint NOT NULL,
    "event_type" "text",
    "payload" "jsonb",
    "matched_flows" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."trigger_logs" OWNER TO "postgres";


ALTER TABLE "public"."trigger_logs" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."trigger_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."twilio_callback_routes" (
    "id" bigint NOT NULL,
    "account_id" "uuid",
    "user_id" "uuid",
    "destination" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."twilio_callback_routes" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."twilio_callback_routes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."twilio_callback_routes_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."twilio_callback_routes_id_seq" OWNED BY "public"."twilio_callback_routes"."id";



CREATE TABLE IF NOT EXISTS "public"."user_emails" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "title" "text" NOT NULL,
    "html_content" "text" NOT NULL,
    "thumbnail_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_emails" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_modules" (
    "user_id" "uuid" NOT NULL,
    "module_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_modules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_agreements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "signed_at" timestamp without time zone DEFAULT "now"(),
    "signer_name" "text",
    "date_signed" "date",
    "agreement_version" "text" DEFAULT '1.0'::"text",
    "agreed" boolean DEFAULT false,
    "vendor_name" "text",
    "email" "text",
    "full_name" "text",
    "ip_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "vendor_agreement_signed" boolean DEFAULT false
);


ALTER TABLE "public"."vendor_agreements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text",
    "description" "text",
    "link" "text",
    "image_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."vendor_assets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."website_pages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "title" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."website_pages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."website_templates" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "category" "text",
    "thumbnail" "text",
    "template" "jsonb" NOT NULL,
    "is_system" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."website_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspace_settings" (
    "user_id" "uuid" NOT NULL,
    "default_from_name" "text",
    "default_from_email" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."workspace_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."xero_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "tenant_id" "text",
    "access_token" "text" NOT NULL,
    "refresh_token" "text" NOT NULL,
    "id_token" "text",
    "scope" "text",
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."xero_connections" OWNER TO "postgres";


ALTER TABLE ONLY "public"."discount_tiers" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."discount_tiers_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."email_campaigns_queue" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."email_campaign_queue_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."email_clicks" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."email_clicks_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."email_unsubscribes" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."email_unsubscribes_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."sendgrid_events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."sendgrid_events_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."sms_queue" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."sms_queue_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."telephony_messages" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."telephony_messages_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."twilio_callback_routes" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."twilio_callback_routes_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."access_codes"
    ADD CONSTRAINT "access_codes_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."account_members"
    ADD CONSTRAINT "account_members_pkey" PRIMARY KEY ("account_id", "user_id");



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_user_id_unique" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admins"
    ADD CONSTRAINT "admins_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."admins"
    ADD CONSTRAINT "admins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."affiliate_applications"
    ADD CONSTRAINT "affiliate_applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."affiliate_clicks"
    ADD CONSTRAINT "affiliate_clicks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."affiliate_conversions"
    ADD CONSTRAINT "affiliate_conversions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."affiliate_links"
    ADD CONSTRAINT "affiliate_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."affiliate_links"
    ADD CONSTRAINT "affiliate_links_tracking_code_key" UNIQUE ("tracking_code");



ALTER TABLE ONLY "public"."affiliate_marketplace"
    ADD CONSTRAINT "affiliate_marketplace_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."affiliate_payouts"
    ADD CONSTRAINT "affiliate_payouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automation_actions__deprecated"
    ADD CONSTRAINT "automation_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automation_color_settings"
    ADD CONSTRAINT "automation_color_settings_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."automation_email_queue"
    ADD CONSTRAINT "automation_email_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automation_enrollments"
    ADD CONSTRAINT "automation_enrollments_flow_id_lead_id_key" UNIQUE ("flow_id", "lead_id");



ALTER TABLE ONLY "public"."automation_enrollments"
    ADD CONSTRAINT "automation_enrollments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automation_enrollments"
    ADD CONSTRAINT "automation_enrollments_unique" UNIQUE ("user_id", "flow_id", "lead_id");



ALTER TABLE ONLY "public"."automation_enrollments"
    ADD CONSTRAINT "automation_enrollments_unique_user_flow_lead" UNIQUE ("user_id", "flow_id", "lead_id");



ALTER TABLE ONLY "public"."automation_events__deprecated"
    ADD CONSTRAINT "automation_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automation_flow_lists"
    ADD CONSTRAINT "automation_flow_lists_flow_id_list_id_key" UNIQUE ("flow_id", "list_id");



ALTER TABLE ONLY "public"."automation_flow_lists"
    ADD CONSTRAINT "automation_flow_lists_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automation_flow_members"
    ADD CONSTRAINT "automation_flow_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automation_flow_members"
    ADD CONSTRAINT "automation_flow_members_unique" UNIQUE ("flow_id", "lead_id");



ALTER TABLE ONLY "public"."automation_flow_runs"
    ADD CONSTRAINT "automation_flow_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automation_flows"
    ADD CONSTRAINT "automation_flows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automation_logs"
    ADD CONSTRAINT "automation_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automation_queue"
    ADD CONSTRAINT "automation_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automation_queue"
    ADD CONSTRAINT "automation_queue_unique" UNIQUE ("user_id", "flow_id", "lead_id");



ALTER TABLE ONLY "public"."automation_queue"
    ADD CONSTRAINT "automation_queue_unique_user_flow_lead" UNIQUE ("user_id", "flow_id", "lead_id");



ALTER TABLE ONLY "public"."blocks"
    ADD CONSTRAINT "blocks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checkout_sessions"
    ADD CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clicks"
    ADD CONSTRAINT "clicks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commissions"
    ADD CONSTRAINT "commissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."communities"
    ADD CONSTRAINT "communities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."community_channels"
    ADD CONSTRAINT "community_channels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."community_code_acceptances"
    ADD CONSTRAINT "community_code_acceptances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."community_posts"
    ADD CONSTRAINT "community_posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contact_notes"
    ADD CONSTRAINT "contact_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_enrolments"
    ADD CONSTRAINT "course_enrolments_course_id_user_id_key" UNIQUE ("course_id", "user_id");



ALTER TABLE ONLY "public"."course_enrolments"
    ADD CONSTRAINT "course_enrolments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_entitlements"
    ADD CONSTRAINT "course_entitlements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_lessons"
    ADD CONSTRAINT "course_lessons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_modules"
    ADD CONSTRAINT "course_modules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_pricing"
    ADD CONSTRAINT "course_pricing_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_vendors"
    ADD CONSTRAINT "course_vendors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_vendors"
    ADD CONSTRAINT "course_vendors_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_calls"
    ADD CONSTRAINT "crm_calls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_field_values"
    ADD CONSTRAINT "crm_field_values_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_fields"
    ADD CONSTRAINT "crm_fields_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_our_numbers"
    ADD CONSTRAINT "crm_our_numbers_pkey" PRIMARY KEY ("number");



ALTER TABLE ONLY "public"."crm_pipelines"
    ADD CONSTRAINT "crm_pipelines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_tasks"
    ADD CONSTRAINT "crm_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discount_codes"
    ADD CONSTRAINT "discount_codes_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."discount_codes"
    ADD CONSTRAINT "discount_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discount_tiers"
    ADD CONSTRAINT "discount_tiers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dkim_records"
    ADD CONSTRAINT "dkim_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_ab_tests"
    ADD CONSTRAINT "email_ab_tests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_ab_variants"
    ADD CONSTRAINT "email_ab_variants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_automations"
    ADD CONSTRAINT "email_automations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_autoresponder_queue"
    ADD CONSTRAINT "email_autoresponder_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_broadcasts"
    ADD CONSTRAINT "email_broadcasts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_campaigns_queue"
    ADD CONSTRAINT "email_campaign_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_campaigns_sends"
    ADD CONSTRAINT "email_campaign_sends_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_campaigns"
    ADD CONSTRAINT "email_campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_clicks"
    ADD CONSTRAINT "email_clicks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_dkim"
    ADD CONSTRAINT "email_dkim_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_dkim"
    ADD CONSTRAINT "email_dkim_user_id_domain_key" UNIQUE ("user_id", "domain");



ALTER TABLE ONLY "public"."email_events"
    ADD CONSTRAINT "email_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_flow_enrolments"
    ADD CONSTRAINT "email_flow_enrolments_flow_id_subscriber_id_key" UNIQUE ("flow_id", "subscriber_id");



ALTER TABLE ONLY "public"."email_flow_enrolments"
    ADD CONSTRAINT "email_flow_enrolments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_flow_runs"
    ADD CONSTRAINT "email_flow_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_flow_steps"
    ADD CONSTRAINT "email_flow_steps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_flows"
    ADD CONSTRAINT "email_flows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_list_members"
    ADD CONSTRAINT "email_list_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_messages"
    ADD CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_senders"
    ADD CONSTRAINT "email_senders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_sends"
    ADD CONSTRAINT "email_sends_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_suppressions"
    ADD CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_suppressions"
    ADD CONSTRAINT "email_suppressions_user_id_email_lower_key" UNIQUE ("user_id", "email_lower");



ALTER TABLE ONLY "public"."email_templates"
    ADD CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_unsubscribes"
    ADD CONSTRAINT "email_unsubscribes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_uploads"
    ADD CONSTRAINT "email_uploads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."entitlements"
    ADD CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."entitlements"
    ADD CONSTRAINT "entitlements_user_id_module_slug_key" UNIQUE ("user_id", "module_slug");



ALTER TABLE ONLY "public"."form_submissions"
    ADD CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."funnel_steps"
    ADD CONSTRAINT "funnel_steps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."funnels"
    ADD CONSTRAINT "funnels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_followups"
    ADD CONSTRAINT "lead_followups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_list_members"
    ADD CONSTRAINT "lead_list_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_list_members"
    ADD CONSTRAINT "lead_list_members_unique" UNIQUE ("user_id", "list_id", "lead_id");



ALTER TABLE ONLY "public"."lead_list_members"
    ADD CONSTRAINT "lead_list_members_unique_list_lead" UNIQUE ("list_id", "lead_id");



ALTER TABLE ONLY "public"."lead_lists"
    ADD CONSTRAINT "lead_lists_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_notes"
    ADD CONSTRAINT "lead_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."list_api_keys"
    ADD CONSTRAINT "list_api_keys_api_key_key" UNIQUE ("api_key");



ALTER TABLE ONLY "public"."list_api_keys"
    ADD CONSTRAINT "list_api_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."modules"
    ADD CONSTRAINT "modules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organisation_members"
    ADD CONSTRAINT "organisation_members_pkey" PRIMARY KEY ("org_id", "user_id");



ALTER TABLE ONLY "public"."organisations"
    ADD CONSTRAINT "organisations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."page_events"
    ADD CONSTRAINT "page_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payouts"
    ADD CONSTRAINT "payouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pipeline_templates"
    ADD CONSTRAINT "pipeline_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sendgrid_events"
    ADD CONSTRAINT "sendgrid_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sendgrid_keys"
    ADD CONSTRAINT "sendgrid_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_projects"
    ADD CONSTRAINT "site_projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sms_delivery_receipts"
    ADD CONSTRAINT "sms_delivery_receipts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sms_messages"
    ADD CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sms_provider_settings"
    ADD CONSTRAINT "sms_provider_settings_pkey" PRIMARY KEY ("org_id");



ALTER TABLE ONLY "public"."sms_queue"
    ADD CONSTRAINT "sms_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sms_sends"
    ADD CONSTRAINT "sms_sends_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sms_sequence_steps"
    ADD CONSTRAINT "sms_sequence_steps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sms_sequences"
    ADD CONSTRAINT "sms_sequences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sms_templates"
    ADD CONSTRAINT "sms_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriber_tags"
    ADD CONSTRAINT "subscriber_tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscribers"
    ADD CONSTRAINT "subscribers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suppression_emails"
    ADD CONSTRAINT "suppression_emails_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."telephony_messages"
    ADD CONSTRAINT "telephony_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."templates"
    ADD CONSTRAINT "templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."templates"
    ADD CONSTRAINT "templates_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."test"
    ADD CONSTRAINT "test_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trigger_logs"
    ADD CONSTRAINT "trigger_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."twilio_callback_routes"
    ADD CONSTRAINT "twilio_callback_routes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_emails"
    ADD CONSTRAINT "user_emails_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_modules"
    ADD CONSTRAINT "user_modules_pkey" PRIMARY KEY ("user_id", "module_id");



ALTER TABLE ONLY "public"."email_list_members"
    ADD CONSTRAINT "ux_email_list_members_list_id_lead_id" UNIQUE ("list_id", "lead_id");



ALTER TABLE ONLY "public"."vendor_agreements"
    ADD CONSTRAINT "vendor_agreements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_assets"
    ADD CONSTRAINT "vendor_assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."website_pages"
    ADD CONSTRAINT "website_pages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."website_pages"
    ADD CONSTRAINT "website_pages_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."website_templates"
    ADD CONSTRAINT "website_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspace_settings"
    ADD CONSTRAINT "workspace_settings_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."xero_connections"
    ADD CONSTRAINT "xero_connections_pkey" PRIMARY KEY ("id");



CREATE INDEX "account_members_user_idx" ON "public"."account_members" USING "btree" ("user_id");



CREATE INDEX "activities_contact_ts_idx" ON "public"."activities" USING "btree" ("contact_id", "ts" DESC);



CREATE INDEX "activities_owner_ts_idx" ON "public"."activities" USING "btree" ("owner", "ts" DESC);



CREATE INDEX "automation_flow_members_flow_id_idx" ON "public"."automation_flow_members" USING "btree" ("flow_id");



CREATE INDEX "automation_flow_members_lead_id_idx" ON "public"."automation_flow_members" USING "btree" ("lead_id");



CREATE INDEX "crm_calls_created_at_idx" ON "public"."crm_calls" USING "btree" ("created_at" DESC);



CREATE INDEX "crm_calls_lead_id_created_at_idx" ON "public"."crm_calls" USING "btree" ("lead_id", "created_at" DESC);



CREATE INDEX "crm_calls_user_id_idx" ON "public"."crm_calls" USING "btree" ("user_id");



CREATE INDEX "crm_pipelines_user_idx" ON "public"."crm_pipelines" USING "btree" ("user_id");



CREATE INDEX "email_ab_tests_account_id_idx" ON "public"."email_ab_tests" USING "btree" ("account_id");



CREATE INDEX "email_ab_tests_context_type_context_id_idx" ON "public"."email_ab_tests" USING "btree" ("context_type", "context_id");



CREATE INDEX "email_ab_tests_status_send_remaining_at_idx" ON "public"."email_ab_tests" USING "btree" ("status", "send_remaining_at");



CREATE INDEX "email_ab_variants_ab_test_id_idx" ON "public"."email_ab_variants" USING "btree" ("ab_test_id");



CREATE UNIQUE INDEX "email_autoresponder_queue_autoresponder_email_unique" ON "public"."email_autoresponder_queue" USING "btree" ("autoresponder_id", "to_email");



CREATE UNIQUE INDEX "email_autoresponder_queue_uq" ON "public"."email_autoresponder_queue" USING "btree" ("autoresponder_id", "lead_id") WHERE ("lead_id" IS NOT NULL);



CREATE UNIQUE INDEX "email_autoresponder_queue_uq_email" ON "public"."email_autoresponder_queue" USING "btree" ("autoresponder_id", "to_email") WHERE (("lead_id" IS NULL) AND ("to_email" IS NOT NULL));



CREATE INDEX "email_broadcasts_user_id_idx" ON "public"."email_broadcasts" USING "btree" ("user_id");



CREATE INDEX "email_campaign_queue_campaign_idx" ON "public"."email_campaigns_queue" USING "btree" ("campaign_id", "email_index");



CREATE INDEX "email_campaign_queue_due_idx" ON "public"."email_campaigns_queue" USING "btree" ("processing", "sent_at", "scheduled_at");



CREATE INDEX "email_campaign_queue_processing_idx" ON "public"."email_campaigns_queue" USING "btree" ("processing", "scheduled_at");



CREATE INDEX "email_campaign_queue_sched_status_idx" ON "public"."email_campaigns_queue" USING "btree" ("status", "scheduled_at");



CREATE INDEX "email_events_contact_ts_idx" ON "public"."email_events" USING "btree" ("contact_id", "ts" DESC);



CREATE INDEX "email_events_event_idx" ON "public"."email_events" USING "btree" ("event");



CREATE INDEX "email_sends_automation_id_idx" ON "public"."email_sends" USING "btree" ("automation_id");



CREATE INDEX "email_sends_broadcast_id_idx" ON "public"."email_sends" USING "btree" ("broadcast_id");



CREATE INDEX "email_sends_campaign_id_idx" ON "public"."email_sends" USING "btree" ("campaign_id");



CREATE INDEX "email_sends_created_at_idx" ON "public"."email_sends" USING "btree" ("created_at");



CREATE INDEX "email_sends_email_idx" ON "public"."email_sends" USING "btree" ("email");



CREATE INDEX "email_sends_last_event_at_idx" ON "public"."email_sends" USING "btree" ("last_event_at");



CREATE INDEX "email_sends_sg_msg_id_idx" ON "public"."email_sends" USING "btree" ("sendgrid_message_id");



CREATE INDEX "email_sends_user_id_idx" ON "public"."email_sends" USING "btree" ("user_id");



CREATE INDEX "idx_accounts_affiliate_slug" ON "public"."accounts" USING "btree" ("affiliate_slug");



CREATE INDEX "idx_accounts_email" ON "public"."accounts" USING "btree" ("email");



CREATE INDEX "idx_ae_flow_id" ON "public"."automation_enrollments" USING "btree" ("flow_id");



CREATE INDEX "idx_ae_flow_status" ON "public"."automation_enrollments" USING "btree" ("flow_id", "status");



CREATE INDEX "idx_ae_lead_id" ON "public"."automation_enrollments" USING "btree" ("lead_id");



CREATE INDEX "idx_ae_user_id" ON "public"."automation_enrollments" USING "btree" ("user_id");



CREATE INDEX "idx_afl_flow" ON "public"."automation_flow_lists" USING "btree" ("flow_id");



CREATE INDEX "idx_afl_list" ON "public"."automation_flow_lists" USING "btree" ("list_id");



CREATE INDEX "idx_afl_user" ON "public"."automation_flow_lists" USING "btree" ("user_id");



CREATE INDEX "idx_afm_flow_id" ON "public"."automation_flow_members" USING "btree" ("flow_id");



CREATE INDEX "idx_afm_lead_id" ON "public"."automation_flow_members" USING "btree" ("lead_id");



CREATE INDEX "idx_afm_user_id" ON "public"."automation_flow_members" USING "btree" ("user_id");



CREATE INDEX "idx_afr_flow" ON "public"."automation_flow_runs" USING "btree" ("flow_id");



CREATE INDEX "idx_afr_lead" ON "public"."automation_flow_runs" USING "btree" ("lead_id");



CREATE INDEX "idx_afr_status_time" ON "public"."automation_flow_runs" USING "btree" ("status", "available_at");



CREATE INDEX "idx_automation_email_queue_created_at" ON "public"."automation_email_queue" USING "btree" ("created_at");



CREATE INDEX "idx_automation_email_queue_flow_id" ON "public"."automation_email_queue" USING "btree" ("flow_id");



CREATE INDEX "idx_automation_email_queue_flow_node" ON "public"."automation_email_queue" USING "btree" ("flow_id", "node_id");



CREATE INDEX "idx_automation_email_queue_lead" ON "public"."automation_email_queue" USING "btree" ("lead_id");



CREATE INDEX "idx_automation_email_queue_lead_id" ON "public"."automation_email_queue" USING "btree" ("lead_id");



CREATE INDEX "idx_automation_email_queue_status" ON "public"."automation_email_queue" USING "btree" ("status");



CREATE INDEX "idx_automation_email_queue_user_id" ON "public"."automation_email_queue" USING "btree" ("user_id");



CREATE INDEX "idx_automation_queue_run_at" ON "public"."automation_queue" USING "btree" ("run_at");



CREATE INDEX "idx_automation_queue_status" ON "public"."automation_queue" USING "btree" ("status");



CREATE INDEX "idx_automation_queue_user" ON "public"."automation_queue" USING "btree" ("user_id");



CREATE INDEX "idx_blocks_page_pos" ON "public"."blocks" USING "btree" ("page_id", "position");



CREATE INDEX "idx_campaign_sends_campaign" ON "public"."email_campaigns_sends" USING "btree" ("campaign_id");



CREATE INDEX "idx_campaign_sends_subscriber" ON "public"."email_campaigns_sends" USING "btree" ("subscriber_id");



CREATE INDEX "idx_campaign_sends_tokens" ON "public"."email_campaigns_sends" USING "btree" ("open_token", "click_token", "unsubscribe_token");



CREATE INDEX "idx_channels_community_id" ON "public"."community_channels" USING "btree" ("community_id");



CREATE INDEX "idx_communities_owner_id" ON "public"."communities" USING "btree" ("owner_id");



CREATE INDEX "idx_courses_vendor_id" ON "public"."courses" USING "btree" ("vendor_id");



CREATE INDEX "idx_crm_calls_contact_number" ON "public"."crm_calls" USING "btree" ("contact_number");



CREATE INDEX "idx_crm_calls_our_number" ON "public"."crm_calls" USING "btree" ("our_number");



CREATE INDEX "idx_crm_calls_recording_sid" ON "public"."crm_calls" USING "btree" ("recording_sid");



CREATE INDEX "idx_email_autoresponder_queue_autoresponder" ON "public"."email_autoresponder_queue" USING "btree" ("autoresponder_id");



CREATE INDEX "idx_email_autoresponder_queue_status_scheduled" ON "public"."email_autoresponder_queue" USING "btree" ("status", "scheduled_at");



CREATE INDEX "idx_email_autoresponder_queue_user" ON "public"."email_autoresponder_queue" USING "btree" ("user_id");



CREATE INDEX "idx_email_campaign_queue_processing" ON "public"."email_campaigns_queue" USING "btree" ("processing") WHERE ("processing" = false);



CREATE INDEX "idx_email_list_members_lead_id" ON "public"."email_list_members" USING "btree" ("lead_id");



CREATE UNIQUE INDEX "idx_email_list_members_unique" ON "public"."email_list_members" USING "btree" ("list_id", "lower"("email"));



CREATE INDEX "idx_email_sends_auto" ON "public"."email_sends" USING "btree" ("autoresponder_id", "automation_id");



CREATE INDEX "idx_email_sends_broadcast" ON "public"."email_sends" USING "btree" ("broadcast_id");



CREATE INDEX "idx_email_sends_campaign" ON "public"."email_sends" USING "btree" ("campaign_id");



CREATE INDEX "idx_email_sends_email_type" ON "public"."email_sends" USING "btree" ("email_type");



CREATE UNIQUE INDEX "idx_email_sends_message_hash" ON "public"."email_sends" USING "btree" ("message_hash");



CREATE INDEX "idx_email_sends_sendgrid_message_id" ON "public"."email_sends" USING "btree" ("sendgrid_message_id");



CREATE UNIQUE INDEX "idx_email_sends_sg_message_id" ON "public"."email_sends" USING "btree" ("sg_message_id");



CREATE INDEX "idx_email_sends_user" ON "public"."email_sends" USING "btree" ("user_id");



CREATE INDEX "idx_email_sends_user_id_created_at" ON "public"."email_sends" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_email_suppressions_user_email_lower" ON "public"."email_suppressions" USING "btree" ("user_id", "email_lower");



CREATE INDEX "idx_email_templates_name" ON "public"."email_templates" USING "btree" ("name");



CREATE INDEX "idx_entitlements_user_course" ON "public"."course_entitlements" USING "btree" ("user_id", "course_id");



CREATE INDEX "idx_funnels_owner" ON "public"."funnels" USING "btree" ("owner_user_id");



CREATE UNIQUE INDEX "idx_funnels_slug_unique" ON "public"."funnels" USING "btree" ("slug") WHERE ("slug" IS NOT NULL);



CREATE INDEX "idx_funnels_user" ON "public"."funnels" USING "btree" ("user_id");



CREATE INDEX "idx_lead_followups_user" ON "public"."lead_followups" USING "btree" ("user_id", "lead_id");



CREATE INDEX "idx_lead_list_members_list" ON "public"."lead_list_members" USING "btree" ("list_id");



CREATE INDEX "idx_lead_list_members_user" ON "public"."lead_list_members" USING "btree" ("user_id");



CREATE INDEX "idx_lead_lists_flow" ON "public"."lead_lists" USING "btree" ("flow_id");



CREATE INDEX "idx_lead_notes_user" ON "public"."lead_notes" USING "btree" ("user_id", "lead_id");



CREATE INDEX "idx_lessons_module_id" ON "public"."course_lessons" USING "btree" ("module_id");



CREATE UNIQUE INDEX "idx_members_unique" ON "public"."email_list_members" USING "btree" ("list_id", "lower"("email"));



CREATE INDEX "idx_modules_course_id" ON "public"."course_modules" USING "btree" ("course_id");



CREATE UNIQUE INDEX "idx_pages_funnel_position" ON "public"."pages" USING "btree" ("funnel_id", "position");



CREATE INDEX "idx_pages_owner" ON "public"."pages" USING "btree" ("owner_user_id");



CREATE INDEX "idx_pages_slug" ON "public"."pages" USING "btree" ("slug");



CREATE INDEX "idx_payments_account_id" ON "public"."payments" USING "btree" ("account_id");



CREATE INDEX "idx_posts_channel_id_created_at" ON "public"."community_posts" USING "btree" ("channel_id", "created_at");



CREATE INDEX "idx_sessions_account_id" ON "public"."sessions" USING "btree" ("account_id");



CREATE INDEX "idx_site_projects_user" ON "public"."site_projects" USING "btree" ("user_id");



CREATE INDEX "idx_sms_sends_lead_id" ON "public"."sms_sends" USING "btree" ("lead_id");



CREATE INDEX "idx_sms_sends_provider_message_id" ON "public"."sms_sends" USING "btree" ("provider_message_id");



CREATE INDEX "idx_sms_sends_sent_at" ON "public"."sms_sends" USING "btree" ("sent_at");



CREATE INDEX "idx_sms_sends_status" ON "public"."sms_sends" USING "btree" ("status");



CREATE INDEX "idx_sms_sends_to_phone" ON "public"."sms_sends" USING "btree" ("to_phone");



CREATE INDEX "idx_sms_sends_user_id" ON "public"."sms_sends" USING "btree" ("user_id");



CREATE INDEX "idx_submissions_created" ON "public"."submissions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_submissions_slug" ON "public"."submissions" USING "btree" ("slug");



CREATE INDEX "idx_subscribers_affiliate_slug" ON "public"."subscribers" USING "btree" ("affiliate_slug");



CREATE UNIQUE INDEX "idx_subscribers_owner_email" ON "public"."subscribers" USING "btree" ("user_id", "lower"("email"));



CREATE INDEX "idx_subscriptions_account_id" ON "public"."subscriptions" USING "btree" ("account_id");



CREATE INDEX "leads_list_id_idx" ON "public"."leads" USING "btree" ("list_id");



CREATE INDEX "leads_pipeline_idx" ON "public"."leads" USING "btree" ("pipeline_id");



CREATE INDEX "leads_stage_idx" ON "public"."leads" USING "btree" ("stage");



CREATE INDEX "leads_user_idx" ON "public"."leads" USING "btree" ("user_id");



CREATE INDEX "list_api_keys_list_idx" ON "public"."list_api_keys" USING "btree" ("list_id");



CREATE INDEX "orders_created_at_idx" ON "public"."orders" USING "btree" ("created_at");



CREATE INDEX "page_events_occurred_idx" ON "public"."page_events" USING "btree" ("occurred_at");



CREATE INDEX "page_events_type_idx" ON "public"."page_events" USING "btree" ("type");



CREATE INDEX "pages_tenant_id_idx" ON "public"."pages" USING "btree" ("tenant_id");



CREATE INDEX "sendgrid_events_email_idx" ON "public"."sendgrid_events" USING "btree" ("email");



CREATE INDEX "sendgrid_events_event_idx" ON "public"."sendgrid_events" USING "btree" ("event");



CREATE INDEX "sendgrid_events_msg_idx" ON "public"."sendgrid_events" USING "btree" ("sg_message_id");



CREATE UNIQUE INDEX "sendgrid_keys_account_id_idx" ON "public"."sendgrid_keys" USING "btree" ("account_id");



CREATE INDEX "site_projects_updated_at_idx" ON "public"."site_projects" USING "btree" ("updated_at" DESC);



CREATE INDEX "site_projects_user_id_idx" ON "public"."site_projects" USING "btree" ("user_id");



CREATE INDEX "sms_delivery_receipts_provider_id_idx" ON "public"."sms_delivery_receipts" USING "btree" ("provider_id");



CREATE INDEX "sms_messages_list_id_idx" ON "public"."sms_messages" USING "btree" ("list_id");



CREATE INDEX "sms_messages_provider_id_idx" ON "public"."sms_messages" USING "btree" ("provider_id");



CREATE INDEX "sms_messages_user_id_idx" ON "public"."sms_messages" USING "btree" ("user_id");



CREATE UNIQUE INDEX "sms_provider_settings_org_id_uidx" ON "public"."sms_provider_settings" USING "btree" ("org_id");



CREATE INDEX "sms_provider_settings_provider_idx" ON "public"."sms_provider_settings" USING "btree" ("provider");



CREATE INDEX "sms_queue_due_idx" ON "public"."sms_queue" USING "btree" ("scheduled_for", "id");



CREATE INDEX "sms_queue_pending_due_idx" ON "public"."sms_queue" USING "btree" ("status", "available_at");



CREATE INDEX "sms_queue_status_scheduled_for_idx" ON "public"."sms_queue" USING "btree" ("status", "scheduled_for");



CREATE INDEX "sms_templates_user_id_idx" ON "public"."sms_templates" USING "btree" ("user_id");



CREATE INDEX "telephony_messages_created_at_idx" ON "public"."telephony_messages" USING "btree" ("created_at" DESC);



CREATE INDEX "telephony_messages_twilio_sid_idx" ON "public"."telephony_messages" USING "btree" ("twilio_sid");



CREATE INDEX "twilio_callback_routes_account_idx" ON "public"."twilio_callback_routes" USING "btree" ("account_id");



CREATE INDEX "twilio_callback_routes_dest_idx" ON "public"."twilio_callback_routes" USING "btree" ("destination");



CREATE UNIQUE INDEX "uniq_pages_slug_published" ON "public"."pages" USING "btree" ("funnel_id", "lower"("slug")) WHERE (("published" = true) AND ("slug" IS NOT NULL));



CREATE UNIQUE INDEX "uq_subscriber_tag" ON "public"."subscriber_tags" USING "btree" ("subscriber_id", "tag_id");



CREATE UNIQUE INDEX "uq_subscribers_owner_email" ON "public"."subscribers" USING "btree" ("user_id", "email");



CREATE UNIQUE INDEX "uq_subscribers_owner_phone" ON "public"."subscribers" USING "btree" ("user_id", "phone") WHERE ("phone" IS NOT NULL);



CREATE UNIQUE INDEX "uq_suppression_owner_email" ON "public"."suppression_emails" USING "btree" ("user_id", "email");



CREATE UNIQUE INDEX "uq_tags_owner_name" ON "public"."tags" USING "btree" ("user_id", "name");



CREATE UNIQUE INDEX "ux_arq_autoresponder_lead" ON "public"."email_autoresponder_queue" USING "btree" ("autoresponder_id", "lead_id") WHERE ("lead_id" IS NOT NULL);



CREATE UNIQUE INDEX "ux_arq_autoresponder_to_email" ON "public"."email_autoresponder_queue" USING "btree" ("autoresponder_id", "to_email");



CREATE UNIQUE INDEX "ux_email_autoresponder_queue_once" ON "public"."email_autoresponder_queue" USING "btree" ("autoresponder_id", "lead_id");



CREATE UNIQUE INDEX "ux_email_list_members_list_email" ON "public"."email_list_members" USING "btree" ("list_id", "email");



CREATE UNIQUE INDEX "ux_email_list_members_list_lead" ON "public"."email_list_members" USING "btree" ("list_id", "lead_id");



CREATE UNIQUE INDEX "ux_lead_list_members_list_lead" ON "public"."lead_list_members" USING "btree" ("list_id", "lead_id");



CREATE UNIQUE INDEX "ux_lead_list_members_once" ON "public"."lead_list_members" USING "btree" ("list_id", "lead_id");



CREATE INDEX "website_pages_user_id_idx" ON "public"."website_pages" USING "btree" ("user_id");



CREATE INDEX "xero_connections_user_idx" ON "public"."xero_connections" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "on_account_update" AFTER UPDATE ON "public"."accounts" FOR EACH ROW EXECUTE FUNCTION "public"."notify_account_approval"();



CREATE OR REPLACE TRIGGER "on_new_affiliate_application" AFTER INSERT ON "public"."affiliate_applications" FOR EACH ROW EXECUTE FUNCTION "public"."notify_vendor_on_new_application"();



CREATE OR REPLACE TRIGGER "set_affiliate_slug" BEFORE INSERT OR UPDATE ON "public"."accounts" FOR EACH ROW EXECUTE FUNCTION "public"."set_affiliate_slug_func"();



CREATE OR REPLACE TRIGGER "subs_touch" BEFORE UPDATE ON "public"."subscribers" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "t_funnel_steps_set_updated_at" BEFORE UPDATE ON "public"."funnel_steps" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "t_funnels_set_updated_at" BEFORE UPDATE ON "public"."funnels" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_afm_updated_at" BEFORE UPDATE ON "public"."automation_flow_members" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_automation_flow_runs_updated" BEFORE UPDATE ON "public"."automation_flow_runs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_clone_templates" AFTER INSERT ON "public"."accounts" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user_clone_templates"();



CREATE OR REPLACE TRIGGER "trg_courses_updated_at" BEFORE UPDATE ON "public"."courses" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_enqueue_autoresponder_on_list_add" AFTER INSERT ON "public"."email_list_members" FOR EACH ROW EXECUTE FUNCTION "public"."enqueue_autoresponder_on_list_add"();



CREATE OR REPLACE TRIGGER "trg_generate_affiliate_link" BEFORE UPDATE ON "public"."affiliate_applications" FOR EACH ROW WHEN (("old"."status" IS DISTINCT FROM "new"."status")) EXECUTE FUNCTION "public"."generate_affiliate_link"();



CREATE OR REPLACE TRIGGER "trg_gr8_enqueue_autoresponder_on_email_list_member_insert" AFTER INSERT ON "public"."email_list_members" FOR EACH ROW EXECUTE FUNCTION "public"."gr8_enqueue_autoresponder_on_email_list_member_insert"();

ALTER TABLE "public"."email_list_members" DISABLE TRIGGER "trg_gr8_enqueue_autoresponder_on_email_list_member_insert";



CREATE OR REPLACE TRIGGER "trg_gr8_enqueue_autoresponder_on_lead_insert" AFTER INSERT ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."gr8_enqueue_autoresponder_on_lead_insert"();



CREATE OR REPLACE TRIGGER "trg_gr8_enqueue_autoresponder_on_lead_list_change" AFTER INSERT OR UPDATE OF "list_id" ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."gr8_enqueue_autoresponder_on_lead_list_change"();



CREATE OR REPLACE TRIGGER "trg_gr8_enqueue_autoresponder_on_lead_list_member_insert" AFTER INSERT ON "public"."lead_list_members" FOR EACH ROW EXECUTE FUNCTION "public"."gr8_enqueue_autoresponder_on_lead_list_member_insert"();



CREATE OR REPLACE TRIGGER "trg_gr8_ensure_lead_from_email_list_member" AFTER INSERT ON "public"."email_list_members" FOR EACH ROW EXECUTE FUNCTION "public"."gr8_ensure_lead_from_email_list_member"();

ALTER TABLE "public"."email_list_members" DISABLE TRIGGER "trg_gr8_ensure_lead_from_email_list_member";



CREATE OR REPLACE TRIGGER "trg_gr8_sync_lead_list_member_to_email_list_members" AFTER INSERT ON "public"."lead_list_members" FOR EACH ROW EXECUTE FUNCTION "public"."gr8_sync_lead_list_member_to_email_list_members"();



CREATE OR REPLACE TRIGGER "trg_gr8_sync_lead_membership_from_leads" AFTER INSERT OR UPDATE OF "list_id" ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."gr8_sync_lead_membership_from_leads"();



CREATE OR REPLACE TRIGGER "trg_normalize_crm_calls" BEFORE INSERT OR UPDATE ON "public"."crm_calls" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_crm_call_row"();



CREATE OR REPLACE TRIGGER "trg_pages_apply_tenant" BEFORE INSERT ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."apply_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_pages_autoposition" BEFORE INSERT ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."set_page_position"();



CREATE OR REPLACE TRIGGER "trg_pages_set_position" BEFORE INSERT ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."pages_set_position"();



CREATE OR REPLACE TRIGGER "trg_set_campaign_list_name" BEFORE INSERT OR UPDATE OF "subscriber_list_id" ON "public"."email_campaigns" FOR EACH ROW EXECUTE FUNCTION "public"."set_campaign_list_name"();



CREATE OR REPLACE TRIGGER "trg_site_projects_updated_at" BEFORE UPDATE ON "public"."site_projects" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_sms_provider_settings_updated_at" BEFORE UPDATE ON "public"."sms_provider_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_sync_email_list_members_lead_id" BEFORE INSERT OR UPDATE ON "public"."email_list_members" FOR EACH ROW EXECUTE FUNCTION "public"."sync_email_list_members_lead_id"();

ALTER TABLE "public"."email_list_members" DISABLE TRIGGER "trg_sync_email_list_members_lead_id";



CREATE OR REPLACE TRIGGER "trg_templates_updated_at" BEFORE UPDATE ON "public"."templates" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_notify_vendor_application" AFTER INSERT ON "public"."affiliate_applications" FOR EACH ROW EXECUTE FUNCTION "public"."notify_vendor_of_application"();



CREATE OR REPLACE TRIGGER "update_site_projects_updated_at" BEFORE UPDATE ON "public"."site_projects" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "vendor_agreement_signed_trigger" AFTER INSERT ON "public"."vendor_agreements" FOR EACH ROW EXECUTE FUNCTION "public"."update_vendor_flag"();



ALTER TABLE ONLY "public"."account_members"
    ADD CONSTRAINT "account_members_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."account_members"
    ADD CONSTRAINT "account_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admins"
    ADD CONSTRAINT "admins_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."affiliate_applications"
    ADD CONSTRAINT "affiliate_applications_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."affiliate_applications"
    ADD CONSTRAINT "affiliate_applications_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."affiliate_applications"
    ADD CONSTRAINT "affiliate_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."affiliate_clicks"
    ADD CONSTRAINT "affiliate_clicks_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."affiliate_conversions"
    ADD CONSTRAINT "affiliate_conversions_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."affiliate_links"
    ADD CONSTRAINT "affiliate_links_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."affiliate_links"
    ADD CONSTRAINT "affiliate_links_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."affiliate_marketplace"
    ADD CONSTRAINT "affiliate_marketplace_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."affiliate_payouts"
    ADD CONSTRAINT "affiliate_payouts_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."automation_actions__deprecated"
    ADD CONSTRAINT "automation_actions_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "public"."automation_queue"("id");



ALTER TABLE ONLY "public"."automation_color_settings"
    ADD CONSTRAINT "automation_color_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."automation_email_queue"
    ADD CONSTRAINT "automation_email_queue_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "public"."automation_flows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."automation_email_queue"
    ADD CONSTRAINT "automation_email_queue_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."automation_email_queue"
    ADD CONSTRAINT "automation_email_queue_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."automation_flow_members"
    ADD CONSTRAINT "automation_flow_members_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."automation_flow_members"
    ADD CONSTRAINT "automation_flow_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."automation_flows"
    ADD CONSTRAINT "automation_flows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE NOT VALID;



ALTER TABLE ONLY "public"."automation_logs"
    ADD CONSTRAINT "automation_logs_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "public"."automation_flows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."automation_logs"
    ADD CONSTRAINT "automation_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."automation_queue"
    ADD CONSTRAINT "automation_queue_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."blocks"
    ADD CONSTRAINT "blocks_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clicks"
    ADD CONSTRAINT "clicks_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "public"."affiliate_links"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."commissions"
    ADD CONSTRAINT "commissions_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."commissions"
    ADD CONSTRAINT "commissions_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."community_channels"
    ADD CONSTRAINT "community_channels_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."community_posts"
    ADD CONSTRAINT "community_posts_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."community_channels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contact_notes"
    ADD CONSTRAINT "contact_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."course_enrolments"
    ADD CONSTRAINT "course_enrolments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_enrolments"
    ADD CONSTRAINT "course_enrolments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_entitlements"
    ADD CONSTRAINT "course_entitlements_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_entitlements"
    ADD CONSTRAINT "course_entitlements_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "public"."course_modules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_entitlements"
    ADD CONSTRAINT "course_entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_lessons"
    ADD CONSTRAINT "course_lessons_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "public"."course_modules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_modules"
    ADD CONSTRAINT "course_modules_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_pricing"
    ADD CONSTRAINT "course_pricing_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_pricing"
    ADD CONSTRAINT "course_pricing_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "public"."course_modules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_vendors"
    ADD CONSTRAINT "course_vendors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."course_vendors"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_calls"
    ADD CONSTRAINT "crm_calls_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_field_values"
    ADD CONSTRAINT "crm_field_values_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "public"."crm_fields"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_pipelines"
    ADD CONSTRAINT "crm_pipelines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_tasks"
    ADD CONSTRAINT "crm_tasks_contact_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dkim_records"
    ADD CONSTRAINT "dkim_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_ab_variants"
    ADD CONSTRAINT "email_ab_variants_ab_test_id_fkey" FOREIGN KEY ("ab_test_id") REFERENCES "public"."email_ab_tests"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_automations"
    ADD CONSTRAINT "email_automations_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "public"."lead_lists"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."email_automations"
    ADD CONSTRAINT "email_automations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_campaigns_queue"
    ADD CONSTRAINT "email_campaign_queue_ab_test_id_fkey" FOREIGN KEY ("ab_test_id") REFERENCES "public"."email_ab_tests"("id");



ALTER TABLE ONLY "public"."email_campaigns_queue"
    ADD CONSTRAINT "email_campaign_queue_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_campaigns"
    ADD CONSTRAINT "email_campaigns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_dkim"
    ADD CONSTRAINT "email_dkim_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_flow_enrolments"
    ADD CONSTRAINT "email_flow_enrolments_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "public"."email_flows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_flow_steps"
    ADD CONSTRAINT "email_flow_steps_flow_run_id_fkey" FOREIGN KEY ("flow_run_id") REFERENCES "public"."email_flow_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_list_members"
    ADD CONSTRAINT "email_list_members_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "public"."lead_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_messages"
    ADD CONSTRAINT "email_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_senders"
    ADD CONSTRAINT "email_senders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_uploads"
    ADD CONSTRAINT "email_uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."funnel_steps"
    ADD CONSTRAINT "funnel_steps_funnel_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "public"."funnels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_list_members"
    ADD CONSTRAINT "lead_list_members_lead_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_list_members"
    ADD CONSTRAINT "lead_list_members_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_list_members"
    ADD CONSTRAINT "lead_list_members_list_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lead_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_list_members"
    ADD CONSTRAINT "lead_list_members_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "public"."lead_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_lists"
    ADD CONSTRAINT "lead_lists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "public"."lead_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "public"."crm_pipelines"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organisation_members"
    ADD CONSTRAINT "organisation_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organisation_members"
    ADD CONSTRAINT "organisation_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organisations"
    ADD CONSTRAINT "organisations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_funnel_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."funnels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_funnel_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "public"."funnels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payouts"
    ADD CONSTRAINT "payouts_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pipeline_templates"
    ADD CONSTRAINT "pipeline_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "public"."affiliate_links"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_projects"
    ADD CONSTRAINT "site_projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sms_provider_settings"
    ADD CONSTRAINT "sms_provider_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sms_queue"
    ADD CONSTRAINT "sms_queue_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sms_sequence_steps"
    ADD CONSTRAINT "sms_sequence_steps_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "public"."sms_sequences"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sms_sequence_steps"
    ADD CONSTRAINT "sms_sequence_steps_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."sms_templates"("id");



ALTER TABLE ONLY "public"."sms_sequences"
    ADD CONSTRAINT "sms_sequences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriber_tags"
    ADD CONSTRAINT "subscriber_tags_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriber_tags"
    ADD CONSTRAINT "subscriber_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscribers"
    ADD CONSTRAINT "subscribers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."templates"
    ADD CONSTRAINT "templates_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."templates"
    ADD CONSTRAINT "templates_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_emails"
    ADD CONSTRAINT "user_emails_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_modules"
    ADD CONSTRAINT "user_modules_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_modules"
    ADD CONSTRAINT "user_modules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_agreements"
    ADD CONSTRAINT "vendor_agreements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



CREATE POLICY "Admin full access" ON "public"."vendor_agreements" USING (("auth"."uid"() = ( SELECT "users"."id"
   FROM "auth"."users"
  WHERE (("users"."email")::"text" = 'youremail@yourdomain.com'::"text")))) WITH CHECK (true);



CREATE POLICY "Admins full access to lead lists" ON "public"."lead_lists" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Allow admin approval updates" ON "public"."accounts" FOR UPDATE USING ((("auth"."role"() = 'service_role'::"text") OR ("auth"."uid"() = "user_id"))) WITH CHECK ((("auth"."role"() = 'service_role'::"text") OR ("auth"."uid"() = "user_id")));



CREATE POLICY "Allow admin to view all products" ON "public"."products" FOR SELECT TO "authenticated" USING (("auth"."email"() = 'support@gr8result.com'::"text"));



CREATE POLICY "Allow all access to lead_lists" ON "public"."lead_lists" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all authenticated users to insert products" ON "public"."products" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow all users to insert products" ON "public"."products" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow anon inserts on lead_lists" ON "public"."lead_lists" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow anon read" ON "public"."email_list_members" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Allow anon select on lead_lists" ON "public"."lead_lists" FOR SELECT USING (true);



CREATE POLICY "Allow anon to approve accounts" ON "public"."accounts" FOR UPDATE TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow anon to read accounts" ON "public"."accounts" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Allow authenticated insert products" ON "public"."products" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow delete on lead_lists" ON "public"."lead_lists" FOR DELETE USING (true);



CREATE POLICY "Allow delete own automations" ON "public"."email_automations" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Allow delete own products" ON "public"."products" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Allow insert for all" ON "public"."test" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow insert for authenticated users" ON "public"."email_automations" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Allow logged-in users to insert products" ON "public"."products" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow public read access" ON "public"."products" FOR SELECT USING (true);



CREATE POLICY "Allow read access for authenticated users" ON "public"."email_list_members" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow read access for authenticated users" ON "public"."subscribers" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow read for anon" ON "public"."email_list_members" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Allow read own automations" ON "public"."email_automations" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Allow select on products" ON "public"."products" FOR SELECT USING (true);



CREATE POLICY "Allow service role full access" ON "public"."products" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Allow update on lead_lists" ON "public"."lead_lists" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Allow update own automations" ON "public"."email_automations" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Anyone logged in can view products" ON "public"."products" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Delete own automation flows" ON "public"."automation_flows" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Delete own funnels" ON "public"."funnels" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Delete own pages" ON "public"."pages" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Enable insert for users based on user_id" ON "public"."funnels" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Enable read for anon" ON "public"."email_list_members" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Insert own automation flows" ON "public"."automation_flows" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Insert own flows" ON "public"."automation_flows" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Insert own funnels" ON "public"."funnels" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Insert own pages" ON "public"."pages" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Public can read products" ON "public"."products" FOR SELECT USING (true);



CREATE POLICY "Public can view products" ON "public"."products" FOR SELECT USING (true);



CREATE POLICY "Public email templates readable by all" ON "public"."email_messages" FOR SELECT USING ((("is_public" = true) OR ("auth"."uid"() = "user_id")));



CREATE POLICY "Public insert on accounts" ON "public"."accounts" FOR INSERT WITH CHECK (true);



CREATE POLICY "Read own and standard automation flows" ON "public"."automation_flows" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") OR ("is_standard" = true)));



CREATE POLICY "Read own funnels" ON "public"."funnels" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Read own pages" ON "public"."pages" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Read published pages" ON "public"."pages" FOR SELECT USING (("published" = true));



CREATE POLICY "Service role can insert and update" ON "public"."sendgrid_keys" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role can insert emails" ON "public"."automation_email_queue" FOR INSERT WITH CHECK (true);



CREATE POLICY "Service role can update emails" ON "public"."automation_email_queue" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access" ON "public"."sendgrid_keys" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Update own automation flows" ON "public"."automation_flows" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Update own flows" ON "public"."automation_flows" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Update own funnels" ON "public"."funnels" FOR UPDATE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Update own pages" ON "public"."pages" FOR UPDATE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "User can manage own flows" ON "public"."automation_flows" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "User can view own lists" ON "public"."lead_lists" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can access their own senders" ON "public"."email_senders" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can access their own uploads" ON "public"."email_uploads" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own emails" ON "public"."user_emails" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own products" ON "public"."products" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own DKIM records" ON "public"."dkim_records" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own applications" ON "public"."affiliate_applications" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own emails" ON "public"."user_emails" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own vendor agreements" ON "public"."vendor_agreements" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their leads" ON "public"."leads" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own email messages" ON "public"."email_messages" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their pipelines" ON "public"."crm_pipelines" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own DKIM records" ON "public"."dkim_records" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own account" ON "public"."accounts" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own affiliate slug" ON "public"."accounts" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own affiliate slug" ON "public"."subscribers" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can view their own DKIM records" ON "public"."dkim_records" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own account" ON "public"."accounts" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own applications" ON "public"."affiliate_applications" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own emails" ON "public"."user_emails" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own products" ON "public"."products" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own vendor agreements" ON "public"."vendor_agreements" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own sites" ON "public"."site_projects" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users see own automation emails" ON "public"."automation_email_queue" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Vendors can insert their own lists" ON "public"."lead_lists" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Vendors can read their own lists" ON "public"."lead_lists" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "View own or standard flows" ON "public"."automation_flows" FOR SELECT USING ((("auth"."uid"() = "user_id") OR ("is_standard" = true)));



CREATE POLICY "WaiteSea admin updates" ON "public"."products" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Website templates are readable" ON "public"."website_templates" FOR SELECT USING (true);



CREATE POLICY "Website templates insert" ON "public"."website_templates" FOR INSERT WITH CHECK (true);



CREATE POLICY "acceptances_all" ON "public"."community_code_acceptances" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."access_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."account_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."activities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activities_owner_all" ON "public"."activities" USING (("auth"."uid"() = "owner")) WITH CHECK (("auth"."uid"() = "owner"));



ALTER TABLE "public"."affiliate_applications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."affiliate_clicks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."affiliate_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."affiliate_marketplace" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "allow authenticated access" ON "public"."accounts" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow authenticated access" ON "public"."affiliate_marketplace" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow authenticated access" ON "public"."commissions" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow authenticated access" ON "public"."lead_lists" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow authenticated read/write" ON "public"."crm_calls" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow public read for billing" ON "public"."discount_codes" FOR SELECT USING (true);



CREATE POLICY "allow read for all" ON "public"."products" FOR SELECT USING (true);



CREATE POLICY "allow updates" ON "public"."email_list_members" FOR UPDATE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "allow_delete_lead_lists" ON "public"."lead_lists" FOR DELETE USING (true);



CREATE POLICY "allow_update_lead_lists" ON "public"."lead_lists" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "auth users all access" ON "public"."communities" USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "auth users all access" ON "public"."community_channels" USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "auth users all access" ON "public"."community_posts" USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."automation_email_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."automation_flow_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "autoresponder_queue_insert_owner" ON "public"."email_autoresponder_queue" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "autoresponder_queue_select_owner" ON "public"."email_autoresponder_queue" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."blocks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "blocks_owner_crud" ON "public"."blocks" USING ((EXISTS ( SELECT 1
   FROM ("public"."pages" "p"
     JOIN "public"."funnels" "f" ON (("f"."id" = "p"."funnel_id")))
  WHERE (("p"."id" = "blocks"."page_id") AND ("f"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."pages" "p"
     JOIN "public"."funnels" "f" ON (("f"."id" = "p"."funnel_id")))
  WHERE (("p"."id" = "blocks"."page_id") AND ("f"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."clicks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."communities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."community_code_acceptances" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "community_posts_owner_delete" ON "public"."community_posts" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "community_posts_owner_update" ON "public"."community_posts" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."contact_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contact_notes_owner_all" ON "public"."contact_notes" USING (("auth"."uid"() = "owner")) WITH CHECK (("auth"."uid"() = "owner"));



ALTER TABLE "public"."course_enrolments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_entitlements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_lessons" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_modules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_pricing" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_vendors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."courses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "courses_public_read_published" ON "public"."courses" FOR SELECT TO "authenticated", "anon" USING (("is_published" = true));



CREATE POLICY "courses_vendor_delete" ON "public"."courses" FOR DELETE TO "authenticated" USING (("vendor_id" IN ( SELECT "course_vendors"."id"
   FROM "public"."course_vendors"
  WHERE ("course_vendors"."user_id" = "auth"."uid"()))));



CREATE POLICY "courses_vendor_insert" ON "public"."courses" FOR INSERT TO "authenticated" WITH CHECK (("vendor_id" IN ( SELECT "course_vendors"."id"
   FROM "public"."course_vendors"
  WHERE ("course_vendors"."user_id" = "auth"."uid"()))));



CREATE POLICY "courses_vendor_read_own" ON "public"."courses" FOR SELECT TO "authenticated" USING (("vendor_id" IN ( SELECT "course_vendors"."id"
   FROM "public"."course_vendors"
  WHERE ("course_vendors"."user_id" = "auth"."uid"()))));



CREATE POLICY "courses_vendor_update" ON "public"."courses" FOR UPDATE TO "authenticated" USING (("vendor_id" IN ( SELECT "course_vendors"."id"
   FROM "public"."course_vendors"
  WHERE ("course_vendors"."user_id" = "auth"."uid"())))) WITH CHECK (("vendor_id" IN ( SELECT "course_vendors"."id"
   FROM "public"."course_vendors"
  WHERE ("course_vendors"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."crm_calls" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_pipelines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."discount_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."discount_tiers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dkim_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_automations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_automations_owner_all" ON "public"."email_automations" USING (("auth"."uid"() = "owner")) WITH CHECK (("auth"."uid"() = "owner"));



ALTER TABLE "public"."email_autoresponder_queue" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_campaign_sends_rw" ON "public"."email_campaigns_sends" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."email_campaigns_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_campaigns_sends" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_events_owner_all" ON "public"."email_events" USING (("auth"."uid"() = "owner")) WITH CHECK (("auth"."uid"() = "owner"));



ALTER TABLE "public"."email_flow_enrolments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_flow_enrolments_all" ON "public"."email_flow_enrolments" USING (true) WITH CHECK (true);



ALTER TABLE "public"."email_flow_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_flow_steps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_flows" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_flows_rw" ON "public"."email_flows" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."email_list_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_senders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_sends" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_sends_insert_owner" ON "public"."email_sends" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "email_sends_select_owner" ON "public"."email_sends" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."email_suppressions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_suppressions_delete" ON "public"."email_suppressions" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "email_suppressions_insert" ON "public"."email_suppressions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "email_suppressions_select" ON "public"."email_suppressions" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."email_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_uploads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "enrolments_user_read_own" ON "public"."course_enrolments" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."entitlements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "entitlements_insert_own" ON "public"."entitlements" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "entitlements_modify_own" ON "public"."entitlements" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "entitlements_select_own" ON "public"."entitlements" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "entitlements_user_read_own" ON "public"."course_entitlements" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."form_submissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."funnel_steps" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "funnel_steps_owner_all" ON "public"."funnel_steps" USING ((EXISTS ( SELECT 1
   FROM "public"."funnels" "f"
  WHERE (("f"."id" = "funnel_steps"."funnel_id") AND ("f"."owner_user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."funnels" "f"
  WHERE (("f"."id" = "funnel_steps"."funnel_id") AND ("f"."owner_user_id" = "auth"."uid"())))));



ALTER TABLE "public"."funnels" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "funnels_delete" ON "public"."funnels" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "funnels_delete_own" ON "public"."funnels" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "funnels_delete_owner" ON "public"."funnels" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "funnels_insert" ON "public"."funnels" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "funnels_insert_owner" ON "public"."funnels" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "funnels_insert_sets_owner" ON "public"."funnels" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "funnels_modify_owner" ON "public"."funnels" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "funnels_owner_all" ON "public"."funnels" USING (("owner_user_id" = "auth"."uid"())) WITH CHECK (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "funnels_owner_delete" ON "public"."funnels" FOR DELETE USING (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "funnels_owner_insert" ON "public"."funnels" FOR INSERT WITH CHECK (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "funnels_owner_select" ON "public"."funnels" FOR SELECT USING (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "funnels_owner_update" ON "public"."funnels" FOR UPDATE USING (("owner_user_id" = "auth"."uid"())) WITH CHECK (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "funnels_select" ON "public"."funnels" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "funnels_select_own" ON "public"."funnels" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "funnels_select_owner" ON "public"."funnels" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "funnels_update_own" ON "public"."funnels" FOR UPDATE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "funnels_update_owner" ON "public"."funnels" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "insert_own" ON "public"."affiliate_applications" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."lead_lists" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_lists_user_rls" ON "public"."lead_lists" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "leads_delete_own" ON "public"."leads" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "leads_insert_own" ON "public"."leads" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "leads_select_own" ON "public"."leads" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "leads_update_own" ON "public"."leads" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "lessons_public_read_published_course" ON "public"."course_lessons" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM ("public"."course_modules" "m"
     JOIN "public"."courses" "c" ON (("c"."id" = "m"."course_id")))
  WHERE (("m"."id" = "course_lessons"."module_id") AND ("c"."is_published" = true)))));



CREATE POLICY "lessons_vendor_manage" ON "public"."course_lessons" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."course_modules" "m"
     JOIN "public"."courses" "c" ON (("c"."id" = "m"."course_id")))
  WHERE (("m"."id" = "course_lessons"."module_id") AND ("c"."vendor_id" IN ( SELECT "course_vendors"."id"
           FROM "public"."course_vendors"
          WHERE ("course_vendors"."user_id" = "auth"."uid"()))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."course_modules" "m"
     JOIN "public"."courses" "c" ON (("c"."id" = "m"."course_id")))
  WHERE (("m"."id" = "course_lessons"."module_id") AND ("c"."vendor_id" IN ( SELECT "course_vendors"."id"
           FROM "public"."course_vendors"
          WHERE ("course_vendors"."user_id" = "auth"."uid"())))))));



ALTER TABLE "public"."list_api_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."modules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "modules_public_read_published_course" ON "public"."course_modules" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "course_modules"."course_id") AND ("c"."is_published" = true)))));



CREATE POLICY "modules_read_all" ON "public"."modules" FOR SELECT USING (true);



CREATE POLICY "modules_vendor_manage" ON "public"."course_modules" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "course_modules"."course_id") AND ("c"."vendor_id" IN ( SELECT "course_vendors"."id"
           FROM "public"."course_vendors"
          WHERE ("course_vendors"."user_id" = "auth"."uid"()))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "course_modules"."course_id") AND ("c"."vendor_id" IN ( SELECT "course_vendors"."id"
           FROM "public"."course_vendors"
          WHERE ("course_vendors"."user_id" = "auth"."uid"())))))));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orders_owner_insert" ON "public"."orders" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "orders_owner_select" ON "public"."orders" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."organisation_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organisations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "owner all subscriber_tags" ON "public"."subscriber_tags" USING ((EXISTS ( SELECT 1
   FROM "public"."subscribers" "s"
  WHERE (("s"."id" = "subscriber_tags"."subscriber_id") AND ("s"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."subscribers" "s"
  WHERE (("s"."id" = "subscriber_tags"."subscriber_id") AND ("s"."user_id" = "auth"."uid"())))));



CREATE POLICY "owner all subscribers" ON "public"."subscribers" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "owner all tags" ON "public"."tags" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "owner read form_submissions" ON "public"."form_submissions" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "owner subscriber_tags" ON "public"."subscriber_tags" USING ((EXISTS ( SELECT 1
   FROM "public"."subscribers" "s"
  WHERE (("s"."id" = "subscriber_tags"."subscriber_id") AND ("s"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."subscribers" "s"
  WHERE (("s"."id" = "subscriber_tags"."subscriber_id") AND ("s"."user_id" = "auth"."uid"())))));



CREATE POLICY "owner subscribers" ON "public"."subscribers" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "owner suppression" ON "public"."suppression_emails" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "owner tags" ON "public"."tags" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."page_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "page_events_owner_insert" ON "public"."page_events" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "page_events_owner_select" ON "public"."page_events" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."pages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pages_delete" ON "public"."pages" FOR DELETE TO "authenticated" USING (("funnel_id" IN ( SELECT "funnels"."id"
   FROM "public"."funnels"
  WHERE ("funnels"."user_id" = "auth"."uid"()))));



CREATE POLICY "pages_delete_owner" ON "public"."pages" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "pages_delete_when_own_funnel" ON "public"."pages" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."funnels" "f"
  WHERE (("f"."id" = "pages"."funnel_id") AND ("f"."user_id" = "auth"."uid"())))));



CREATE POLICY "pages_insert" ON "public"."pages" FOR INSERT TO "authenticated" WITH CHECK (("funnel_id" IN ( SELECT "funnels"."id"
   FROM "public"."funnels"
  WHERE ("funnels"."user_id" = "auth"."uid"()))));



CREATE POLICY "pages_insert_owner" ON "public"."pages" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "pages_insert_when_own_funnel" ON "public"."pages" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."funnels" "f"
  WHERE (("f"."id" = "pages"."funnel_id") AND ("f"."user_id" = "auth"."uid"())))));



CREATE POLICY "pages_modify_owner" ON "public"."pages" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "pages_owner_all" ON "public"."pages" USING (("owner_user_id" = "auth"."uid"())) WITH CHECK (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "pages_public_read" ON "public"."pages" FOR SELECT USING (("published" = true));



CREATE POLICY "pages_read_all" ON "public"."pages" FOR SELECT USING (true);



CREATE POLICY "pages_select" ON "public"."pages" FOR SELECT TO "authenticated" USING (("funnel_id" IN ( SELECT "funnels"."id"
   FROM "public"."funnels"
  WHERE ("funnels"."user_id" = "auth"."uid"()))));



CREATE POLICY "pages_select_own" ON "public"."pages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."funnels" "f"
  WHERE (("f"."id" = "pages"."funnel_id") AND ("f"."user_id" = "auth"."uid"())))));



CREATE POLICY "pages_select_owner" ON "public"."pages" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "pages_select_published" ON "public"."pages" FOR SELECT USING (("published" = true));



CREATE POLICY "pages_update_owner" ON "public"."pages" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "pages_update_when_own_funnel" ON "public"."pages" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."funnels" "f"
  WHERE (("f"."id" = "pages"."funnel_id") AND ("f"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."payouts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pricing_public_read_published_active" ON "public"."course_pricing" FOR SELECT TO "authenticated", "anon" USING ((("is_active" = true) AND (EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "course_pricing"."course_id") AND ("c"."is_published" = true))))));



CREATE POLICY "pricing_vendor_manage" ON "public"."course_pricing" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "course_pricing"."course_id") AND ("c"."vendor_id" IN ( SELECT "course_vendors"."id"
           FROM "public"."course_vendors"
          WHERE ("course_vendors"."user_id" = "auth"."uid"()))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "course_pricing"."course_id") AND ("c"."vendor_id" IN ( SELECT "course_vendors"."id"
           FROM "public"."course_vendors"
          WHERE ("course_vendors"."user_id" = "auth"."uid"())))))));



ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public_read_products" ON "public"."products" FOR SELECT USING (true);



CREATE POLICY "read_own_data" ON "public"."affiliate_clicks" FOR SELECT USING (("auth"."uid"() = "affiliate_id"));



CREATE POLICY "read_own_data" ON "public"."affiliate_conversions" FOR SELECT USING (("auth"."uid"() = "affiliate_id"));



CREATE POLICY "read_own_data" ON "public"."affiliate_payouts" FOR SELECT USING (("auth"."uid"() = "affiliate_id"));



ALTER TABLE "public"."sales" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "select_own" ON "public"."affiliate_applications" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "select_own_account" ON "public"."accounts" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."sendgrid_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."site_projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."submissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "submissions_owner_select" ON "public"."submissions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."pages" "p"
     JOIN "public"."funnels" "f" ON (("f"."id" = "p"."funnel_id")))
  WHERE (("p"."slug" = "submissions"."slug") AND ("f"."user_id" = "auth"."uid"())))));



CREATE POLICY "submissions_public_insert" ON "public"."submissions" FOR INSERT TO "authenticated", "anon" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."pages" "p"
  WHERE (("p"."slug" = "submissions"."slug") AND ("p"."published" = true)))));



CREATE POLICY "subs_owner_all" ON "public"."subscribers" USING (("auth"."uid"() = "owner")) WITH CHECK (("auth"."uid"() = "owner"));



ALTER TABLE "public"."subscriber_tags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscribers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."suppression_emails" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "templates: insert within account" ON "public"."templates" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."account_members" "m"
  WHERE (("m"."account_id" = "templates"."account_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."role" = ANY (ARRAY['owner'::"text", 'editor'::"text"]))))));



CREATE POLICY "templates: read within account" ON "public"."templates" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."account_members" "m"
  WHERE (("m"."account_id" = "templates"."account_id") AND ("m"."user_id" = "auth"."uid"())))));



CREATE POLICY "templates: write within account" ON "public"."templates" USING ((EXISTS ( SELECT 1
   FROM "public"."account_members" "m"
  WHERE (("m"."account_id" = "templates"."account_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."role" = ANY (ARRAY['owner'::"text", 'editor'::"text"]))))));



CREATE POLICY "tenant can delete pages" ON "public"."pages" FOR DELETE USING (("tenant_id" = "auth"."uid"()));



CREATE POLICY "tenant can insert pages" ON "public"."pages" FOR INSERT WITH CHECK (("tenant_id" = "auth"."uid"()));



CREATE POLICY "tenant can read pages" ON "public"."pages" FOR SELECT USING (("tenant_id" = "auth"."uid"()));



CREATE POLICY "tenant can update pages" ON "public"."pages" FOR UPDATE USING (("tenant_id" = "auth"."uid"())) WITH CHECK (("tenant_id" = "auth"."uid"()));



ALTER TABLE "public"."test" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "test" ON "public"."test" FOR SELECT USING (true);



CREATE POLICY "tiers_read_all" ON "public"."discount_tiers" FOR SELECT USING (true);



CREATE POLICY "update_own_account" ON "public"."accounts" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "user_can_manage_own_flows" ON "public"."automation_flows" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."user_emails" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_insert_own_flows" ON "public"."automation_flows" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."user_modules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_modules_delete_owner" ON "public"."user_modules" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "user_modules_read_owner" ON "public"."user_modules" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "user_modules_update_owner" ON "public"."user_modules" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "user_modules_write_owner" ON "public"."user_modules" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "user_select_own_flows" ON "public"."automation_flows" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "user_update_own_flows" ON "public"."automation_flows" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."vendor_agreements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vendors_insert_self" ON "public"."course_vendors" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "vendors_read_own" ON "public"."course_vendors" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "vendors_update_own" ON "public"."course_vendors" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."website_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workspace_settings_rw" ON "public"."workspace_settings" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."products";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



















































GRANT ALL ON FUNCTION "public"."apply_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."apply_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_tenant_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_default_user_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."assign_default_user_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_default_user_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."attach_list_to_flow_and_backfill"("p_flow_id" "uuid", "p_list_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."attach_list_to_flow_and_backfill"("p_flow_id" "uuid", "p_list_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."attach_list_to_flow_and_backfill"("p_flow_id" "uuid", "p_list_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."attach_list_to_flow_and_enrol"("p_user_id" "uuid", "p_flow_id" "uuid", "p_list_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."attach_list_to_flow_and_enrol"("p_user_id" "uuid", "p_flow_id" "uuid", "p_list_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."attach_list_to_flow_and_enrol"("p_user_id" "uuid", "p_flow_id" "uuid", "p_list_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_enrol_on_list_member_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_enrol_on_list_member_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_enrol_on_list_member_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."backup_user_leads"() TO "anon";
GRANT ALL ON FUNCTION "public"."backup_user_leads"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."backup_user_leads"() TO "service_role";



GRANT ALL ON TABLE "public"."email_campaigns_queue" TO "anon";
GRANT ALL ON TABLE "public"."email_campaigns_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."email_campaigns_queue" TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_email_campaign_queue"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_email_campaign_queue"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_email_campaign_queue"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_email_campaigns_queue"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_email_campaigns_queue"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_email_campaigns_queue"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."clone_default_templates"("new_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."clone_default_templates"("new_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."clone_default_templates"("new_user" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_campaign_secure"("p_subject" "text", "p_from_name" "text", "p_from_email" "text", "p_list_id" "uuid", "p_template_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_campaign_secure"("p_subject" "text", "p_from_name" "text", "p_from_email" "text", "p_list_id" "uuid", "p_template_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_campaign_secure"("p_subject" "text", "p_from_name" "text", "p_from_email" "text", "p_list_id" "uuid", "p_template_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_campaign_secure"("p_subject" "text", "p_from_name" "text", "p_from_email" "text", "p_list_id" "uuid", "p_template_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_leads_partition_for_user"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_leads_partition_for_user"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_leads_partition_for_user"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_user_storage_folders"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_user_storage_folders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_user_storage_folders"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_active_org"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_active_org"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_active_org"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_autoresponder_on_list_add"() TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_autoresponder_on_list_add"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_autoresponder_on_list_add"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_leads_partition_exists"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_leads_partition_exists"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_leads_partition_exists"() TO "service_role";



GRANT ALL ON FUNCTION "public"."foldername"("name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."foldername"("name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."foldername"("name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."force_refresh"() TO "anon";
GRANT ALL ON FUNCTION "public"."force_refresh"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."force_refresh"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_affiliate_link"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_affiliate_link"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_affiliate_link"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_affiliate_slug"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_affiliate_slug"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_affiliate_slug"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_account_brand"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_account_brand"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_account_brand"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_leads"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_leads"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_leads"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."gr8_enqueue_autoresponder_on_email_list_member_add"() TO "anon";
GRANT ALL ON FUNCTION "public"."gr8_enqueue_autoresponder_on_email_list_member_add"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."gr8_enqueue_autoresponder_on_email_list_member_add"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gr8_enqueue_autoresponder_on_email_list_member_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."gr8_enqueue_autoresponder_on_email_list_member_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."gr8_enqueue_autoresponder_on_email_list_member_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gr8_enqueue_autoresponder_on_lead_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."gr8_enqueue_autoresponder_on_lead_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."gr8_enqueue_autoresponder_on_lead_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gr8_enqueue_autoresponder_on_lead_list_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."gr8_enqueue_autoresponder_on_lead_list_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."gr8_enqueue_autoresponder_on_lead_list_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gr8_enqueue_autoresponder_on_lead_list_member_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."gr8_enqueue_autoresponder_on_lead_list_member_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."gr8_enqueue_autoresponder_on_lead_list_member_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gr8_enqueue_autoresponder_on_list_add"() TO "anon";
GRANT ALL ON FUNCTION "public"."gr8_enqueue_autoresponder_on_list_add"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."gr8_enqueue_autoresponder_on_list_add"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gr8_ensure_lead_from_email_list_member"() TO "anon";
GRANT ALL ON FUNCTION "public"."gr8_ensure_lead_from_email_list_member"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."gr8_ensure_lead_from_email_list_member"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gr8_list_owner_user_id"("p_list_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."gr8_list_owner_user_id"("p_list_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gr8_list_owner_user_id"("p_list_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."gr8_sync_lead_list_member_to_email_list_members"() TO "anon";
GRANT ALL ON FUNCTION "public"."gr8_sync_lead_list_member_to_email_list_members"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."gr8_sync_lead_list_member_to_email_list_members"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gr8_sync_lead_membership_from_leads"() TO "anon";
GRANT ALL ON FUNCTION "public"."gr8_sync_lead_membership_from_leads"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."gr8_sync_lead_membership_from_leads"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user_clone_templates"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user_clone_templates"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user_clone_templates"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user_crm_pipeline"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user_crm_pipeline"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user_crm_pipeline"() TO "service_role";



GRANT ALL ON FUNCTION "public"."http_post"("url" "text", "payload" json) TO "anon";
GRANT ALL ON FUNCTION "public"."http_post"("url" "text", "payload" json) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_post"("url" "text", "payload" json) TO "service_role";



GRANT ALL ON FUNCTION "public"."http_post_bridge"("url" "text", "payload" json) TO "anon";
GRANT ALL ON FUNCTION "public"."http_post_bridge"("url" "text", "payload" json) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_post_bridge"("url" "text", "payload" json) TO "service_role";



GRANT ALL ON FUNCTION "public"."http_post_json"("url" "text", "payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."http_post_json"("url" "text", "payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_post_json"("url" "text", "payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."http_post_json_retry"("url" "text", "payload" "jsonb", "max_retries" integer, "delay_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."http_post_json_retry"("url" "text", "payload" "jsonb", "max_retries" integer, "delay_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_post_json_retry"("url" "text", "payload" "jsonb", "max_retries" integer, "delay_seconds" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_page_views"("p_slug" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_page_views"("p_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_page_views"("p_slug" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_org_member"("org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_org_member"("org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_org_member"("org" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."next_page_position"("in_funnel" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."next_page_position"("in_funnel" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."next_page_position"("in_funnel" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_crm_call_row"() TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_crm_call_row"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_crm_call_row"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_account_approval"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_account_approval"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_account_approval"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_vendor_of_application"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_vendor_of_application"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_vendor_of_application"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_vendor_on_new_application"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_vendor_on_new_application"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_vendor_on_new_application"() TO "service_role";



GRANT ALL ON FUNCTION "public"."pages_set_position"() TO "anon";
GRANT ALL ON FUNCTION "public"."pages_set_position"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."pages_set_position"() TO "service_role";



GRANT ALL ON FUNCTION "public"."process_abandoned_carts"() TO "anon";
GRANT ALL ON FUNCTION "public"."process_abandoned_carts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_abandoned_carts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."resolve_segment"("p_user_id" "uuid", "p_list_ids" "uuid"[], "p_tag_any" "uuid"[], "p_tag_all" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_segment"("p_user_id" "uuid", "p_list_ids" "uuid"[], "p_tag_any" "uuid"[], "p_tag_all" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_segment"("p_user_id" "uuid", "p_list_ids" "uuid"[], "p_tag_any" "uuid"[], "p_tag_all" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."run_automation_engine"() TO "anon";
GRANT ALL ON FUNCTION "public"."run_automation_engine"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."run_automation_engine"() TO "service_role";



GRANT ALL ON FUNCTION "public"."save_product_direct"("payload" "jsonb", "pid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."save_product_direct"("payload" "jsonb", "pid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_product_direct"("payload" "jsonb", "pid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."save_product_fixed"("pid" "uuid", "title" "text", "description" "text", "sales_page_url" "text", "affiliate_link" "text", "sale_price" numeric, "commission" numeric, "revenue_per_sale" numeric, "category" "text", "thumbnail_url" "text", "images" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."save_product_fixed"("pid" "uuid", "title" "text", "description" "text", "sales_page_url" "text", "affiliate_link" "text", "sale_price" numeric, "commission" numeric, "revenue_per_sale" numeric, "category" "text", "thumbnail_url" "text", "images" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_product_fixed"("pid" "uuid", "title" "text", "description" "text", "sales_page_url" "text", "affiliate_link" "text", "sale_price" numeric, "commission" numeric, "revenue_per_sale" numeric, "category" "text", "thumbnail_url" "text", "images" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_affiliate_slug_func"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_affiliate_slug_func"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_affiliate_slug_func"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_campaign_list_name"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_campaign_list_name"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_campaign_list_name"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_page_position"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_page_position"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_page_position"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_site_projects_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_site_projects_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_site_projects_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."start_email_campaign"("p_campaign_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."start_email_campaign"("p_campaign_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."start_email_campaign"("p_campaign_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_email_list_members_lead_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_email_list_members_lead_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_email_list_members_lead_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_lead_contacts_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_lead_contacts_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_lead_contacts_timestamp"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_lead_email_records_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_lead_email_records_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_lead_email_records_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_leads_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_leads_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_leads_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_product_safe"("pid" "uuid", "payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."update_product_safe"("pid" "uuid", "payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_product_safe"("pid" "uuid", "payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_site_projects_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_site_projects_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_site_projects_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_vendor_flag"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_vendor_flag"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_vendor_flag"() TO "service_role";






























GRANT ALL ON TABLE "public"."access_codes" TO "anon";
GRANT ALL ON TABLE "public"."access_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."access_codes" TO "service_role";



GRANT ALL ON TABLE "public"."account_members" TO "anon";
GRANT ALL ON TABLE "public"."account_members" TO "authenticated";
GRANT ALL ON TABLE "public"."account_members" TO "service_role";



GRANT ALL ON TABLE "public"."accounts" TO "anon";
GRANT ALL ON TABLE "public"."accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."accounts" TO "service_role";



GRANT ALL ON TABLE "public"."activities" TO "anon";
GRANT ALL ON TABLE "public"."activities" TO "authenticated";
GRANT ALL ON TABLE "public"."activities" TO "service_role";



GRANT ALL ON TABLE "public"."admin_demo_backup_email_broadcasts" TO "anon";
GRANT ALL ON TABLE "public"."admin_demo_backup_email_broadcasts" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_demo_backup_email_broadcasts" TO "service_role";



GRANT ALL ON TABLE "public"."admin_demo_backup_email_sends" TO "anon";
GRANT ALL ON TABLE "public"."admin_demo_backup_email_sends" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_demo_backup_email_sends" TO "service_role";



GRANT ALL ON TABLE "public"."admin_send_debug_backups" TO "anon";
GRANT ALL ON TABLE "public"."admin_send_debug_backups" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_send_debug_backups" TO "service_role";



GRANT ALL ON TABLE "public"."admins" TO "anon";
GRANT ALL ON TABLE "public"."admins" TO "authenticated";
GRANT ALL ON TABLE "public"."admins" TO "service_role";



GRANT ALL ON TABLE "public"."affiliate_applications" TO "anon";
GRANT ALL ON TABLE "public"."affiliate_applications" TO "authenticated";
GRANT ALL ON TABLE "public"."affiliate_applications" TO "service_role";



GRANT ALL ON TABLE "public"."affiliate_clicks" TO "anon";
GRANT ALL ON TABLE "public"."affiliate_clicks" TO "authenticated";
GRANT ALL ON TABLE "public"."affiliate_clicks" TO "service_role";



GRANT ALL ON TABLE "public"."affiliate_conversions" TO "anon";
GRANT ALL ON TABLE "public"."affiliate_conversions" TO "authenticated";
GRANT ALL ON TABLE "public"."affiliate_conversions" TO "service_role";



GRANT ALL ON TABLE "public"."affiliate_links" TO "anon";
GRANT ALL ON TABLE "public"."affiliate_links" TO "authenticated";
GRANT ALL ON TABLE "public"."affiliate_links" TO "service_role";



GRANT ALL ON TABLE "public"."affiliate_marketplace" TO "anon";
GRANT ALL ON TABLE "public"."affiliate_marketplace" TO "authenticated";
GRANT ALL ON TABLE "public"."affiliate_marketplace" TO "service_role";



GRANT ALL ON TABLE "public"."affiliate_payouts" TO "anon";
GRANT ALL ON TABLE "public"."affiliate_payouts" TO "authenticated";
GRANT ALL ON TABLE "public"."affiliate_payouts" TO "service_role";



GRANT ALL ON TABLE "public"."api_keys" TO "anon";
GRANT ALL ON TABLE "public"."api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."api_keys" TO "service_role";



GRANT ALL ON TABLE "public"."automation_actions__deprecated" TO "anon";
GRANT ALL ON TABLE "public"."automation_actions__deprecated" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_actions__deprecated" TO "service_role";



GRANT ALL ON TABLE "public"."automation_color_settings" TO "anon";
GRANT ALL ON TABLE "public"."automation_color_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_color_settings" TO "service_role";



GRANT ALL ON TABLE "public"."automation_email_queue" TO "anon";
GRANT ALL ON TABLE "public"."automation_email_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_email_queue" TO "service_role";



GRANT ALL ON TABLE "public"."automation_enrollments" TO "anon";
GRANT ALL ON TABLE "public"."automation_enrollments" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_enrollments" TO "service_role";



GRANT ALL ON TABLE "public"."automation_events__deprecated" TO "anon";
GRANT ALL ON TABLE "public"."automation_events__deprecated" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_events__deprecated" TO "service_role";



GRANT ALL ON TABLE "public"."automation_flow_lists" TO "anon";
GRANT ALL ON TABLE "public"."automation_flow_lists" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_flow_lists" TO "service_role";



GRANT ALL ON TABLE "public"."automation_flow_members" TO "anon";
GRANT ALL ON TABLE "public"."automation_flow_members" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_flow_members" TO "service_role";



GRANT ALL ON TABLE "public"."automation_flow_runs" TO "anon";
GRANT ALL ON TABLE "public"."automation_flow_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_flow_runs" TO "service_role";



GRANT ALL ON TABLE "public"."automation_flows" TO "anon";
GRANT ALL ON TABLE "public"."automation_flows" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_flows" TO "service_role";



GRANT ALL ON TABLE "public"."automation_logs" TO "anon";
GRANT ALL ON TABLE "public"."automation_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_logs" TO "service_role";



GRANT ALL ON TABLE "public"."automation_queue" TO "anon";
GRANT ALL ON TABLE "public"."automation_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_queue" TO "service_role";



GRANT ALL ON TABLE "public"."blocks" TO "anon";
GRANT ALL ON TABLE "public"."blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."blocks" TO "service_role";



GRANT ALL ON TABLE "public"."checkout_sessions" TO "anon";
GRANT ALL ON TABLE "public"."checkout_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."checkout_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."clicks" TO "anon";
GRANT ALL ON TABLE "public"."clicks" TO "authenticated";
GRANT ALL ON TABLE "public"."clicks" TO "service_role";



GRANT ALL ON TABLE "public"."commissions" TO "anon";
GRANT ALL ON TABLE "public"."commissions" TO "authenticated";
GRANT ALL ON TABLE "public"."commissions" TO "service_role";



GRANT ALL ON TABLE "public"."communities" TO "anon";
GRANT ALL ON TABLE "public"."communities" TO "authenticated";
GRANT ALL ON TABLE "public"."communities" TO "service_role";



GRANT ALL ON TABLE "public"."community_channels" TO "anon";
GRANT ALL ON TABLE "public"."community_channels" TO "authenticated";
GRANT ALL ON TABLE "public"."community_channels" TO "service_role";



GRANT ALL ON TABLE "public"."community_code_acceptances" TO "anon";
GRANT ALL ON TABLE "public"."community_code_acceptances" TO "authenticated";
GRANT ALL ON TABLE "public"."community_code_acceptances" TO "service_role";



GRANT ALL ON TABLE "public"."community_posts" TO "anon";
GRANT ALL ON TABLE "public"."community_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."community_posts" TO "service_role";



GRANT ALL ON TABLE "public"."contact_notes" TO "anon";
GRANT ALL ON TABLE "public"."contact_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_notes" TO "service_role";



GRANT ALL ON TABLE "public"."course_enrolments" TO "anon";
GRANT ALL ON TABLE "public"."course_enrolments" TO "authenticated";
GRANT ALL ON TABLE "public"."course_enrolments" TO "service_role";



GRANT ALL ON TABLE "public"."course_entitlements" TO "anon";
GRANT ALL ON TABLE "public"."course_entitlements" TO "authenticated";
GRANT ALL ON TABLE "public"."course_entitlements" TO "service_role";



GRANT ALL ON TABLE "public"."course_lessons" TO "anon";
GRANT ALL ON TABLE "public"."course_lessons" TO "authenticated";
GRANT ALL ON TABLE "public"."course_lessons" TO "service_role";



GRANT ALL ON TABLE "public"."course_modules" TO "anon";
GRANT ALL ON TABLE "public"."course_modules" TO "authenticated";
GRANT ALL ON TABLE "public"."course_modules" TO "service_role";



GRANT ALL ON TABLE "public"."course_pricing" TO "anon";
GRANT ALL ON TABLE "public"."course_pricing" TO "authenticated";
GRANT ALL ON TABLE "public"."course_pricing" TO "service_role";



GRANT ALL ON TABLE "public"."course_vendors" TO "anon";
GRANT ALL ON TABLE "public"."course_vendors" TO "authenticated";
GRANT ALL ON TABLE "public"."course_vendors" TO "service_role";



GRANT ALL ON TABLE "public"."courses" TO "anon";
GRANT ALL ON TABLE "public"."courses" TO "authenticated";
GRANT ALL ON TABLE "public"."courses" TO "service_role";



GRANT ALL ON TABLE "public"."crm_calls" TO "anon";
GRANT ALL ON TABLE "public"."crm_calls" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_calls" TO "service_role";



GRANT ALL ON TABLE "public"."crm_field_values" TO "anon";
GRANT ALL ON TABLE "public"."crm_field_values" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_field_values" TO "service_role";



GRANT ALL ON TABLE "public"."crm_fields" TO "anon";
GRANT ALL ON TABLE "public"."crm_fields" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_fields" TO "service_role";



GRANT ALL ON TABLE "public"."crm_our_numbers" TO "anon";
GRANT ALL ON TABLE "public"."crm_our_numbers" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_our_numbers" TO "service_role";



GRANT ALL ON TABLE "public"."crm_pipelines" TO "anon";
GRANT ALL ON TABLE "public"."crm_pipelines" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_pipelines" TO "service_role";



GRANT ALL ON TABLE "public"."crm_tasks" TO "anon";
GRANT ALL ON TABLE "public"."crm_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."discount_codes" TO "anon";
GRANT ALL ON TABLE "public"."discount_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."discount_codes" TO "service_role";



GRANT ALL ON TABLE "public"."discount_tiers" TO "anon";
GRANT ALL ON TABLE "public"."discount_tiers" TO "authenticated";
GRANT ALL ON TABLE "public"."discount_tiers" TO "service_role";



GRANT ALL ON SEQUENCE "public"."discount_tiers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."discount_tiers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."discount_tiers_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."dkim_records" TO "anon";
GRANT ALL ON TABLE "public"."dkim_records" TO "authenticated";
GRANT ALL ON TABLE "public"."dkim_records" TO "service_role";



GRANT ALL ON TABLE "public"."email_ab_tests" TO "anon";
GRANT ALL ON TABLE "public"."email_ab_tests" TO "authenticated";
GRANT ALL ON TABLE "public"."email_ab_tests" TO "service_role";



GRANT ALL ON TABLE "public"."email_ab_variants" TO "anon";
GRANT ALL ON TABLE "public"."email_ab_variants" TO "authenticated";
GRANT ALL ON TABLE "public"."email_ab_variants" TO "service_role";



GRANT ALL ON TABLE "public"."email_automations" TO "anon";
GRANT ALL ON TABLE "public"."email_automations" TO "authenticated";
GRANT ALL ON TABLE "public"."email_automations" TO "service_role";



GRANT ALL ON TABLE "public"."email_autoresponder_queue" TO "anon";
GRANT ALL ON TABLE "public"."email_autoresponder_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."email_autoresponder_queue" TO "service_role";



GRANT ALL ON TABLE "public"."email_broadcasts" TO "anon";
GRANT ALL ON TABLE "public"."email_broadcasts" TO "authenticated";
GRANT ALL ON TABLE "public"."email_broadcasts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."email_campaign_queue_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."email_campaign_queue_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."email_campaign_queue_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."email_campaigns" TO "anon";
GRANT ALL ON TABLE "public"."email_campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."email_campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."email_campaigns_sends" TO "anon";
GRANT ALL ON TABLE "public"."email_campaigns_sends" TO "authenticated";
GRANT ALL ON TABLE "public"."email_campaigns_sends" TO "service_role";



GRANT ALL ON TABLE "public"."email_clicks" TO "anon";
GRANT ALL ON TABLE "public"."email_clicks" TO "authenticated";
GRANT ALL ON TABLE "public"."email_clicks" TO "service_role";



GRANT ALL ON SEQUENCE "public"."email_clicks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."email_clicks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."email_clicks_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."email_dkim" TO "anon";
GRANT ALL ON TABLE "public"."email_dkim" TO "authenticated";
GRANT ALL ON TABLE "public"."email_dkim" TO "service_role";



GRANT ALL ON TABLE "public"."email_events" TO "anon";
GRANT ALL ON TABLE "public"."email_events" TO "authenticated";
GRANT ALL ON TABLE "public"."email_events" TO "service_role";



GRANT ALL ON TABLE "public"."email_flow_enrolments" TO "anon";
GRANT ALL ON TABLE "public"."email_flow_enrolments" TO "authenticated";
GRANT ALL ON TABLE "public"."email_flow_enrolments" TO "service_role";



GRANT ALL ON TABLE "public"."email_flow_runs" TO "anon";
GRANT ALL ON TABLE "public"."email_flow_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."email_flow_runs" TO "service_role";



GRANT ALL ON TABLE "public"."email_flow_steps" TO "anon";
GRANT ALL ON TABLE "public"."email_flow_steps" TO "authenticated";
GRANT ALL ON TABLE "public"."email_flow_steps" TO "service_role";



GRANT ALL ON TABLE "public"."email_flows" TO "anon";
GRANT ALL ON TABLE "public"."email_flows" TO "authenticated";
GRANT ALL ON TABLE "public"."email_flows" TO "service_role";



GRANT ALL ON TABLE "public"."email_list_members" TO "anon";
GRANT ALL ON TABLE "public"."email_list_members" TO "authenticated";
GRANT ALL ON TABLE "public"."email_list_members" TO "service_role";



GRANT ALL ON TABLE "public"."lead_lists" TO "anon";
GRANT ALL ON TABLE "public"."lead_lists" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_lists" TO "service_role";



GRANT ALL ON TABLE "public"."email_lists" TO "anon";
GRANT ALL ON TABLE "public"."email_lists" TO "authenticated";
GRANT ALL ON TABLE "public"."email_lists" TO "service_role";



GRANT ALL ON TABLE "public"."email_messages" TO "anon";
GRANT ALL ON TABLE "public"."email_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."email_messages" TO "service_role";



GRANT ALL ON TABLE "public"."email_senders" TO "anon";
GRANT ALL ON TABLE "public"."email_senders" TO "authenticated";
GRANT ALL ON TABLE "public"."email_senders" TO "service_role";



GRANT ALL ON TABLE "public"."email_sends" TO "anon";
GRANT ALL ON TABLE "public"."email_sends" TO "authenticated";
GRANT ALL ON TABLE "public"."email_sends" TO "service_role";



GRANT ALL ON TABLE "public"."email_sends_cleanup_backup" TO "anon";
GRANT ALL ON TABLE "public"."email_sends_cleanup_backup" TO "authenticated";
GRANT ALL ON TABLE "public"."email_sends_cleanup_backup" TO "service_role";



GRANT ALL ON TABLE "public"."email_suppressions" TO "anon";
GRANT ALL ON TABLE "public"."email_suppressions" TO "authenticated";
GRANT ALL ON TABLE "public"."email_suppressions" TO "service_role";



GRANT ALL ON TABLE "public"."email_templates" TO "anon";
GRANT ALL ON TABLE "public"."email_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."email_templates" TO "service_role";



GRANT ALL ON TABLE "public"."email_unsubscribes" TO "anon";
GRANT ALL ON TABLE "public"."email_unsubscribes" TO "authenticated";
GRANT ALL ON TABLE "public"."email_unsubscribes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."email_unsubscribes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."email_unsubscribes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."email_unsubscribes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."email_uploads" TO "anon";
GRANT ALL ON TABLE "public"."email_uploads" TO "authenticated";
GRANT ALL ON TABLE "public"."email_uploads" TO "service_role";



GRANT ALL ON TABLE "public"."entitlements" TO "anon";
GRANT ALL ON TABLE "public"."entitlements" TO "authenticated";
GRANT ALL ON TABLE "public"."entitlements" TO "service_role";



GRANT ALL ON TABLE "public"."form_submissions" TO "anon";
GRANT ALL ON TABLE "public"."form_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."form_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."funnel_steps" TO "anon";
GRANT ALL ON TABLE "public"."funnel_steps" TO "authenticated";
GRANT ALL ON TABLE "public"."funnel_steps" TO "service_role";



GRANT ALL ON TABLE "public"."funnels" TO "anon";
GRANT ALL ON TABLE "public"."funnels" TO "authenticated";
GRANT ALL ON TABLE "public"."funnels" TO "service_role";



GRANT ALL ON TABLE "public"."lead_followups" TO "anon";
GRANT ALL ON TABLE "public"."lead_followups" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_followups" TO "service_role";



GRANT ALL ON TABLE "public"."lead_list_members" TO "anon";
GRANT ALL ON TABLE "public"."lead_list_members" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_list_members" TO "service_role";



GRANT ALL ON TABLE "public"."lead_list_members_backup" TO "anon";
GRANT ALL ON TABLE "public"."lead_list_members_backup" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_list_members_backup" TO "service_role";



GRANT ALL ON TABLE "public"."lead_list_members_backup_20260120" TO "anon";
GRANT ALL ON TABLE "public"."lead_list_members_backup_20260120" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_list_members_backup_20260120" TO "service_role";



GRANT ALL ON TABLE "public"."lead_notes" TO "anon";
GRANT ALL ON TABLE "public"."lead_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_notes" TO "service_role";



GRANT ALL ON TABLE "public"."leads" TO "anon";
GRANT ALL ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT ALL ON TABLE "public"."list_api_keys" TO "anon";
GRANT ALL ON TABLE "public"."list_api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."list_api_keys" TO "service_role";



GRANT ALL ON TABLE "public"."modules" TO "anon";
GRANT ALL ON TABLE "public"."modules" TO "authenticated";
GRANT ALL ON TABLE "public"."modules" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON TABLE "public"."organisation_members" TO "anon";
GRANT ALL ON TABLE "public"."organisation_members" TO "authenticated";
GRANT ALL ON TABLE "public"."organisation_members" TO "service_role";



GRANT ALL ON TABLE "public"."organisations" TO "anon";
GRANT ALL ON TABLE "public"."organisations" TO "authenticated";
GRANT ALL ON TABLE "public"."organisations" TO "service_role";



GRANT ALL ON TABLE "public"."page_events" TO "anon";
GRANT ALL ON TABLE "public"."page_events" TO "authenticated";
GRANT ALL ON TABLE "public"."page_events" TO "service_role";



GRANT ALL ON TABLE "public"."pages" TO "anon";
GRANT ALL ON TABLE "public"."pages" TO "authenticated";
GRANT ALL ON TABLE "public"."pages" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."payouts" TO "anon";
GRANT ALL ON TABLE "public"."payouts" TO "authenticated";
GRANT ALL ON TABLE "public"."payouts" TO "service_role";



GRANT ALL ON TABLE "public"."pipeline_templates" TO "anon";
GRANT ALL ON TABLE "public"."pipeline_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."pipeline_templates" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON TABLE "public"."sales" TO "anon";
GRANT ALL ON TABLE "public"."sales" TO "authenticated";
GRANT ALL ON TABLE "public"."sales" TO "service_role";



GRANT ALL ON TABLE "public"."sendgrid_events" TO "anon";
GRANT ALL ON TABLE "public"."sendgrid_events" TO "authenticated";
GRANT ALL ON TABLE "public"."sendgrid_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sendgrid_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sendgrid_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sendgrid_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sendgrid_keys" TO "anon";
GRANT ALL ON TABLE "public"."sendgrid_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."sendgrid_keys" TO "service_role";



GRANT ALL ON TABLE "public"."sessions" TO "anon";
GRANT ALL ON TABLE "public"."sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions" TO "service_role";



GRANT ALL ON TABLE "public"."site_projects" TO "anon";
GRANT ALL ON TABLE "public"."site_projects" TO "authenticated";
GRANT ALL ON TABLE "public"."site_projects" TO "service_role";



GRANT ALL ON TABLE "public"."sms_delivery_receipts" TO "anon";
GRANT ALL ON TABLE "public"."sms_delivery_receipts" TO "authenticated";
GRANT ALL ON TABLE "public"."sms_delivery_receipts" TO "service_role";



GRANT ALL ON TABLE "public"."sms_messages" TO "anon";
GRANT ALL ON TABLE "public"."sms_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."sms_messages" TO "service_role";



GRANT ALL ON TABLE "public"."sms_provider_settings" TO "anon";
GRANT ALL ON TABLE "public"."sms_provider_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."sms_provider_settings" TO "service_role";



GRANT ALL ON TABLE "public"."sms_queue" TO "anon";
GRANT ALL ON TABLE "public"."sms_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."sms_queue" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sms_queue_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sms_queue_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sms_queue_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sms_sends" TO "anon";
GRANT ALL ON TABLE "public"."sms_sends" TO "authenticated";
GRANT ALL ON TABLE "public"."sms_sends" TO "service_role";



GRANT ALL ON TABLE "public"."sms_sequence_steps" TO "anon";
GRANT ALL ON TABLE "public"."sms_sequence_steps" TO "authenticated";
GRANT ALL ON TABLE "public"."sms_sequence_steps" TO "service_role";



GRANT ALL ON TABLE "public"."sms_sequences" TO "anon";
GRANT ALL ON TABLE "public"."sms_sequences" TO "authenticated";
GRANT ALL ON TABLE "public"."sms_sequences" TO "service_role";



GRANT ALL ON TABLE "public"."sms_templates" TO "anon";
GRANT ALL ON TABLE "public"."sms_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."sms_templates" TO "service_role";



GRANT ALL ON TABLE "public"."submissions" TO "anon";
GRANT ALL ON TABLE "public"."submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."submissions" TO "service_role";



GRANT ALL ON TABLE "public"."subscriber_tags" TO "anon";
GRANT ALL ON TABLE "public"."subscriber_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriber_tags" TO "service_role";



GRANT ALL ON TABLE "public"."subscribers" TO "anon";
GRANT ALL ON TABLE "public"."subscribers" TO "authenticated";
GRANT ALL ON TABLE "public"."subscribers" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."suppression_emails" TO "anon";
GRANT ALL ON TABLE "public"."suppression_emails" TO "authenticated";
GRANT ALL ON TABLE "public"."suppression_emails" TO "service_role";



GRANT ALL ON TABLE "public"."tags" TO "anon";
GRANT ALL ON TABLE "public"."tags" TO "authenticated";
GRANT ALL ON TABLE "public"."tags" TO "service_role";



GRANT ALL ON TABLE "public"."telephony_messages" TO "anon";
GRANT ALL ON TABLE "public"."telephony_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."telephony_messages" TO "service_role";



GRANT ALL ON SEQUENCE "public"."telephony_messages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."telephony_messages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."telephony_messages_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."templates" TO "anon";
GRANT ALL ON TABLE "public"."templates" TO "authenticated";
GRANT ALL ON TABLE "public"."templates" TO "service_role";



GRANT ALL ON TABLE "public"."test" TO "anon";
GRANT ALL ON TABLE "public"."test" TO "authenticated";
GRANT ALL ON TABLE "public"."test" TO "service_role";



GRANT ALL ON SEQUENCE "public"."test_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."test_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."test_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."trigger_logs" TO "anon";
GRANT ALL ON TABLE "public"."trigger_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."trigger_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."trigger_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."trigger_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."trigger_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."twilio_callback_routes" TO "anon";
GRANT ALL ON TABLE "public"."twilio_callback_routes" TO "authenticated";
GRANT ALL ON TABLE "public"."twilio_callback_routes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."twilio_callback_routes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."twilio_callback_routes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."twilio_callback_routes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_emails" TO "anon";
GRANT ALL ON TABLE "public"."user_emails" TO "authenticated";
GRANT ALL ON TABLE "public"."user_emails" TO "service_role";



GRANT ALL ON TABLE "public"."user_modules" TO "anon";
GRANT ALL ON TABLE "public"."user_modules" TO "authenticated";
GRANT ALL ON TABLE "public"."user_modules" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_agreements" TO "anon";
GRANT ALL ON TABLE "public"."vendor_agreements" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_agreements" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_assets" TO "anon";
GRANT ALL ON TABLE "public"."vendor_assets" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_assets" TO "service_role";



GRANT ALL ON TABLE "public"."website_pages" TO "anon";
GRANT ALL ON TABLE "public"."website_pages" TO "authenticated";
GRANT ALL ON TABLE "public"."website_pages" TO "service_role";



GRANT ALL ON TABLE "public"."website_templates" TO "anon";
GRANT ALL ON TABLE "public"."website_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."website_templates" TO "service_role";



GRANT ALL ON TABLE "public"."workspace_settings" TO "anon";
GRANT ALL ON TABLE "public"."workspace_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."workspace_settings" TO "service_role";



GRANT ALL ON TABLE "public"."xero_connections" TO "anon";
GRANT ALL ON TABLE "public"."xero_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."xero_connections" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






