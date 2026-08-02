ALTER TABLE "integrations" ALTER COLUMN "connect_token_ref" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "config" jsonb;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "website" text;