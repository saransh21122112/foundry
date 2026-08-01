CREATE TYPE "public"."activity_event_type" AS ENUM('tool_call_attempted', 'tool_call_allowed', 'tool_call_blocked', 'tool_call_executed', 'tool_call_failed', 'approval_granted', 'approval_rejected', 'kill_switch_triggered');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."autonomy_level" AS ENUM('off', 'draft_only', 'bounded_autonomous');--> statement-breakpoint
CREATE TYPE "public"."department" AS ENUM('eng-lead', 'product-lead', 'researcher', 'ops-manager', 'design-lead', 'data-lead', 'sales-lead');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."risk_class" AS ENUM('reversible-low', 'reversible-high', 'irreversible', 'financial', 'legal');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"department" "department" NOT NULL,
	"agent_run_id" text NOT NULL,
	"event_type" "activity_event_type" NOT NULL,
	"tool_name" text,
	"tool_input" jsonb,
	"tool_output" jsonb,
	"actor" text NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"department" "department" NOT NULL,
	"agent_run_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"tool_input" jsonb NOT NULL,
	"reason" text NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_clerk_user_id" text,
	"resolution_note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_caps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"department" "department" NOT NULL,
	"scope" text NOT NULL,
	"unit" text NOT NULL,
	"cap_amount" numeric(12, 4) NOT NULL,
	"period_start" timestamp with time zone DEFAULT now() NOT NULL,
	"current_spend" numeric(12, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "department_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"department" "department" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"autonomy_level" "autonomy_level" DEFAULT 'draft_only' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "department_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"department" "department" NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"connect_token_ref" text NOT NULL,
	"scopes" jsonb DEFAULT '[]' NOT NULL,
	"connected_by_clerk_user_id" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "integration_status" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kill_switches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"department" "department",
	"active" boolean DEFAULT true NOT NULL,
	"triggered_by_clerk_user_id" text NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tool_allowlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"department" "department" NOT NULL,
	"tool_name" text NOT NULL,
	"allowed" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_caps" ADD CONSTRAINT "budget_caps_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "department_configs" ADD CONSTRAINT "department_configs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "department_settings" ADD CONSTRAINT "department_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "integrations" ADD CONSTRAINT "integrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kill_switches" ADD CONSTRAINT "kill_switches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_allowlists" ADD CONSTRAINT "tool_allowlists_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_log_org_time_idx" ON "activity_log" USING btree ("org_id","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_org_status_idx" ON "approval_requests" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "budget_caps_org_dept_scope_unit_idx" ON "budget_caps" USING btree ("org_id","department","scope","unit");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "department_configs_org_dept_idx" ON "department_configs" USING btree ("org_id","department");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "department_settings_org_dept_key_idx" ON "department_settings" USING btree ("org_id","department","key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integrations_org_provider_idx" ON "integrations" USING btree ("org_id","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kill_switches_org_dept_active_idx" ON "kill_switches" USING btree ("org_id","department","active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memberships_org_user_idx" ON "memberships" USING btree ("org_id","clerk_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_clerk_org_id_idx" ON "organizations" USING btree ("clerk_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tool_allowlists_org_dept_tool_idx" ON "tool_allowlists" USING btree ("org_id","department","tool_name");