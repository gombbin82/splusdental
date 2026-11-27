CREATE TYPE "public"."coverage_priority" AS ENUM('primary', 'secondary');--> statement-breakpoint
CREATE TYPE "public"."relationship" AS ENUM('18', '01', '19', '53', 'G8');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('female', 'male', 'other', 'unknown');--> statement-breakpoint
CREATE TABLE "coverages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"payer_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"relationship" "relationship" NOT NULL,
	"priority" "coverage_priority" DEFAULT 'primary' NOT NULL,
	"member_id" text NOT NULL,
	"group_number" text,
	"group_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chart_number" text,
	"first_name" text NOT NULL,
	"middle_name" text,
	"last_name" text NOT NULL,
	"birth_date" date NOT NULL,
	"sex" "sex" DEFAULT 'unknown' NOT NULL,
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
CREATE TABLE "payers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"payer_id" text NOT NULL,
	"filing_indicator" text DEFAULT 'CI' NOT NULL,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coverages" ADD CONSTRAINT "coverages_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverages" ADD CONSTRAINT "coverages_payer_id_payers_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."payers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverages" ADD CONSTRAINT "coverages_subscriber_id_patients_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coverages_patient_priority_uq" ON "coverages" USING btree ("patient_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_chart_uq" ON "patients" USING btree ("chart_number");--> statement-breakpoint
CREATE INDEX "patients_name_idx" ON "patients" USING btree ("last_name","first_name");