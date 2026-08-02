CREATE TABLE IF NOT EXISTS "agent_prompt_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"content" text NOT NULL,
	"updated_by_clerk_user_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_caps" ALTER COLUMN "department" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_prompt_overrides" ADD CONSTRAINT "agent_prompt_overrides_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_prompt_overrides_org_agent_idx" ON "agent_prompt_overrides" USING btree ("org_id","agent_id");