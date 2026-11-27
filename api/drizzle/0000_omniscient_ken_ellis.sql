CREATE TYPE "public"."provider_kind" AS ENUM('organization', 'person');--> statement-breakpoint
CREATE TYPE "public"."provider_role" AS ENUM('dentist', 'hygienist', 'assistant');--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "provider_kind" NOT NULL,
	"org_name" text,
	"first_name" text,
	"last_name" text,
	"credential" text,
	"role" "provider_role",
	"npi" text NOT NULL,
	"tax_id" text,
	"taxonomy" text,
	"address1" text,
	"address2" text,
	"city" text,
	"state" text,
	"zip" text,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "providers_npi_uq" ON "providers" USING btree ("npi");