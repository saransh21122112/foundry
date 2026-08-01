CREATE TABLE IF NOT EXISTS "run_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"created_by_clerk_user_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_sessions" ADD CONSTRAINT "run_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_sessions_org_created_idx" ON "run_sessions" USING btree ("org_id","created_at");