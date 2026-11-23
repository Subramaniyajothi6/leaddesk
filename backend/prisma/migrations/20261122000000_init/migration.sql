-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'TEAM_LEAD', 'BDE');

-- CreateEnum
CREATE TYPE "UserState" AS ENUM ('ACTIVE', 'INACTIVE', 'EXITED');

-- CreateEnum
CREATE TYPE "TeamState" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "StatusCategory" AS ENUM ('OPEN', 'WON', 'LOST', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "AssignLevel" AS ENUM ('TEAM', 'BDE');

-- CreateEnum
CREATE TYPE "AllocMethod" AS ENUM ('EQUAL', 'CAPACITY', 'WORKLOAD', 'SMART', 'MANUAL', 'AUTO_REFILL', 'RECYCLE');

-- CreateEnum
CREATE TYPE "EndReason" AS ENUM ('REASSIGNED', 'USER_INACTIVE', 'USER_EXITED', 'TRANSFERRED', 'RECYCLED', 'CLOSED', 'TAKEN_BACK', 'UNDONE');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('CALL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "FollowUpType" AS ENUM ('CALL', 'WHATSAPP', 'MEETING', 'TASK');

-- CreateEnum
CREATE TYPE "FollowUpState" AS ENUM ('PENDING', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DayStatus" AS ENUM ('PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE', 'HOLIDAY', 'WEEK_OFF');

-- CreateEnum
CREATE TYPE "RequestState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Scope" AS ENUM ('COMPANY', 'TEAM', 'USER');

-- CreateEnum
CREATE TYPE "TxnKind" AS ENUM ('REVENUE', 'INVESTMENT');

-- CreateEnum
CREATE TYPE "TxnState" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CalcType" AS ENUM ('REVENUE_SHARE', 'PROFIT_SHARE', 'PERCENT_OF', 'DISCOUNT', 'CHANGE', 'GROWTH');

-- CreateEnum
CREATE TYPE "BulkKind" AS ENUM ('ASSIGN', 'STATUS', 'DELETE', 'IMPORT');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "emp_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL,
    "state" "UserState" NOT NULL DEFAULT 'ACTIVE',
    "password_hash" TEXT NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "joined_on" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exited_on" DATE,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "state" "TeamState" NOT NULL DEFAULT 'ACTIVE',
    "auto_distribute" BOOLEAN NOT NULL DEFAULT false,
    "method" "AllocMethod" NOT NULL DEFAULT 'SMART',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_memberships" (
    "id" SERIAL NOT NULL,
    "team_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "from_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "to_at" TIMESTAMP(3),

    CONSTRAINT "team_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_lead_links" (
    "id" SERIAL NOT NULL,
    "team_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "from_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "to_at" TIMESTAMP(3),

    CONSTRAINT "team_lead_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_sources" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" SERIAL NOT NULL,
    "file_name" TEXT NOT NULL,
    "uploaded_by" INTEGER NOT NULL,
    "total_rows" INTEGER NOT NULL,
    "accepted" INTEGER NOT NULL,
    "duplicates" INTEGER NOT NULL,
    "rejected" INTEGER NOT NULL,
    "mapping" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rejects" (
    "id" SERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ERROR',
    "existing_lead_id" INTEGER,

    CONSTRAINT "import_rejects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "email" TEXT,
    "source_id" INTEGER,
    "batch_id" INTEGER,
    "custom" JSONB NOT NULL DEFAULT '{}',
    "status_id" INTEGER NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "team_id" INTEGER,
    "owner_id" INTEGER,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "first_attempt_at" TIMESTAMP(3),
    "recycle_count" INTEGER NOT NULL DEFAULT 0,
    "dnd" BOOLEAN NOT NULL DEFAULT false,
    "last_activity_at" TIMESTAMP(3),
    "next_follow_up_at" TIMESTAMP(3),
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_defs" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "show_in_list" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "custom_field_defs_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "statuses" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" "StatusCategory" NOT NULL,
    "counts_as_contact" BOOLEAN NOT NULL DEFAULT false,
    "needs_follow_up" BOOLEAN NOT NULL DEFAULT false,
    "remarks_required" BOOLEAN NOT NULL DEFAULT false,
    "required_fields" JSONB NOT NULL DEFAULT '[]',
    "follow_up_hours" INTEGER,
    "colour" TEXT NOT NULL DEFAULT '#64748b',
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_transitions" (
    "from_status_id" INTEGER NOT NULL,
    "to_status_id" INTEGER NOT NULL,

    CONSTRAINT "status_transitions_pkey" PRIMARY KEY ("from_status_id","to_status_id")
);

-- CreateTable
CREATE TABLE "status_history" (
    "id" SERIAL NOT NULL,
    "lead_id" INTEGER NOT NULL,
    "from_status_id" INTEGER,
    "to_status_id" INTEGER NOT NULL,
    "by_user_id" INTEGER NOT NULL,
    "owner_id" INTEGER,
    "team_id" INTEGER,
    "remarks" TEXT,
    "reopen" BOOLEAN NOT NULL DEFAULT false,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_remarks" (
    "id" SERIAL NOT NULL,
    "lead_id" INTEGER NOT NULL,
    "by_user_id" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_remarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_outcomes" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "connected" BOOLEAN NOT NULL,
    "counts_as_attempt" BOOLEAN NOT NULL,
    "needs_follow_up" BOOLEAN NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "call_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_logs" (
    "id" SERIAL NOT NULL,
    "lead_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "channel" "Channel" NOT NULL DEFAULT 'CALL',
    "direction" TEXT NOT NULL DEFAULT 'OUT',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_sec" INTEGER NOT NULL DEFAULT 0,
    "outcome_id" INTEGER,
    "status_before_id" INTEGER,
    "status_after_id" INTEGER,
    "remarks" TEXT,

    CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" SERIAL NOT NULL,
    "lead_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" "FollowUpType" NOT NULL DEFAULT 'CALL',
    "due_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "state" "FollowUpState" NOT NULL DEFAULT 'PENDING',
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "reminded_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "Channel" NOT NULL DEFAULT 'WHATSAPP',
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_rules" (
    "id" SERIAL NOT NULL,
    "field" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "scoring_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_views" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "page" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_actions" (
    "id" SERIAL NOT NULL,
    "kind" "BulkKind" NOT NULL,
    "by_user_id" INTEGER NOT NULL,
    "lead_count" INTEGER NOT NULL,
    "before" JSONB NOT NULL,
    "run_id" INTEGER,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undone_at" TIMESTAMP(3),
    "undone_by" INTEGER,

    CONSTRAINT "bulk_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_runs" (
    "id" SERIAL NOT NULL,
    "level" "AssignLevel" NOT NULL,
    "method" "AllocMethod" NOT NULL,
    "team_id" INTEGER,
    "started_by" INTEGER,
    "params" JSONB NOT NULL DEFAULT '{}',
    "lead_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_assignments" (
    "id" SERIAL NOT NULL,
    "lead_id" INTEGER NOT NULL,
    "level" "AssignLevel" NOT NULL,
    "team_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "run_id" INTEGER,
    "assigned_by" INTEGER,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" JSONB NOT NULL DEFAULT '{}',
    "over_max" BOOLEAN NOT NULL DEFAULT false,
    "ended_at" TIMESTAMP(3),
    "end_reason" "EndReason",

    CONSTRAINT "lead_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_match_values" (
    "user_id" INTEGER NOT NULL,
    "field_key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "user_match_values_pkey" PRIMARY KEY ("user_id","field_key","value")
);

-- CreateTable
CREATE TABLE "allocation_limits" (
    "id" SERIAL NOT NULL,
    "scope" "Scope" NOT NULL,
    "scope_id" INTEGER NOT NULL DEFAULT 0,
    "max_open" INTEGER,
    "max_per_day" INTEGER,

    CONSTRAINT "allocation_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "work_date" DATE NOT NULL,
    "punch_in_at" TIMESTAMP(3),
    "punch_out_at" TIMESTAMP(3),
    "worked_min" INTEGER NOT NULL DEFAULT 0,
    "day_status" "DayStatus",
    "late" BOOLEAN NOT NULL DEFAULT false,
    "early_out" BOOLEAN NOT NULL DEFAULT false,
    "missing_punch_out" BOOLEAN NOT NULL DEFAULT false,
    "punch_in_ip" TEXT,
    "location" JSONB,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_corrections" (
    "id" SERIAL NOT NULL,
    "attendance_id" INTEGER NOT NULL,
    "requested_by" INTEGER NOT NULL,
    "approved_by" INTEGER,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "state" "RequestState" NOT NULL DEFAULT 'PENDING',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "time_off" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'LEAVE',
    "entered_by" INTEGER NOT NULL,

    CONSTRAINT "time_off_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "targets" (
    "id" SERIAL NOT NULL,
    "scope" "Scope" NOT NULL,
    "scope_id" INTEGER NOT NULL DEFAULT 0,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "value" BIGINT NOT NULL,
    "from_date" DATE NOT NULL,

    CONSTRAINT "targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "dedupe_key" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keys" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" SERIAL NOT NULL,
    "kind" "TxnKind" NOT NULL,
    "lead_id" INTEGER,
    "team_id" INTEGER,
    "amount_paise" BIGINT NOT NULL,
    "method" TEXT,
    "reference_no" TEXT,
    "received_on" DATE NOT NULL,
    "state" "TxnState" NOT NULL DEFAULT 'PENDING',
    "recorded_by" INTEGER NOT NULL,
    "confirmed_by" INTEGER,
    "confirmed_at" TIMESTAMP(3),
    "company_share_bp" INTEGER,
    "company_share_paise" BIGINT,
    "remaining_paise" BIGINT,
    "cancel_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_calculations" (
    "id" SERIAL NOT NULL,
    "type" "CalcType" NOT NULL,
    "inputs" JSONB NOT NULL,
    "percent_bp" INTEGER,
    "result_paise" BIGINT,
    "remaining_paise" BIGINT,
    "result_bp" INTEGER,
    "note" TEXT,
    "transaction_id" INTEGER,
    "period_from" DATE,
    "period_to" DATE,
    "by_user_id" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_calculations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_emp_code_key" ON "users"("emp_code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "teams_name_key" ON "teams"("name");

-- CreateIndex
CREATE INDEX "team_memberships_team_id_idx" ON "team_memberships"("team_id");

-- CreateIndex
CREATE INDEX "team_lead_links_user_id_idx" ON "team_lead_links"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sources_name_key" ON "lead_sources"("name");

-- CreateIndex
CREATE INDEX "import_rejects_batch_id_idx" ON "import_rejects"("batch_id");

-- CreateIndex
CREATE INDEX "leads_team_id_owner_id_idx" ON "leads"("team_id", "owner_id");

-- CreateIndex
CREATE INDEX "leads_owner_id_status_id_idx" ON "leads"("owner_id", "status_id");

-- CreateIndex
CREATE INDEX "leads_email_idx" ON "leads"("email");

-- CreateIndex
CREATE UNIQUE INDEX "statuses_key_key" ON "statuses"("key");

-- CreateIndex
CREATE INDEX "status_history_lead_id_idx" ON "status_history"("lead_id");

-- CreateIndex
CREATE INDEX "status_history_to_status_id_at_idx" ON "status_history"("to_status_id", "at");

-- CreateIndex
CREATE INDEX "lead_remarks_lead_id_idx" ON "lead_remarks"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "call_outcomes_label_key" ON "call_outcomes"("label");

-- CreateIndex
CREATE INDEX "call_logs_lead_id_idx" ON "call_logs"("lead_id");

-- CreateIndex
CREATE INDEX "call_logs_user_id_started_at_idx" ON "call_logs"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "follow_ups_user_id_state_due_at_idx" ON "follow_ups"("user_id", "state", "due_at");

-- CreateIndex
CREATE INDEX "follow_ups_lead_id_state_idx" ON "follow_ups"("lead_id", "state");

-- CreateIndex
CREATE INDEX "lead_assignments_lead_id_idx" ON "lead_assignments"("lead_id");

-- CreateIndex
CREATE INDEX "lead_assignments_user_id_assigned_at_idx" ON "lead_assignments"("user_id", "assigned_at");

-- CreateIndex
CREATE INDEX "lead_assignments_team_id_assigned_at_idx" ON "lead_assignments"("team_id", "assigned_at");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_limits_scope_scope_id_key" ON "allocation_limits"("scope", "scope_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_user_id_work_date_key" ON "attendance"("user_id", "work_date");

-- CreateIndex
CREATE INDEX "time_off_user_id_idx" ON "time_off"("user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");

-- CreateIndex
CREATE INDEX "transactions_state_received_on_idx" ON "transactions"("state", "received_on");

-- CreateIndex
CREATE INDEX "fin_calculations_type_at_idx" ON "fin_calculations"("type", "at");

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_lead_links" ADD CONSTRAINT "team_lead_links_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_lead_links" ADD CONSTRAINT "team_lead_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rejects" ADD CONSTRAINT "import_rejects_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_transitions" ADD CONSTRAINT "status_transitions_from_status_id_fkey" FOREIGN KEY ("from_status_id") REFERENCES "statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_transitions" ADD CONSTRAINT "status_transitions_to_status_id_fkey" FOREIGN KEY ("to_status_id") REFERENCES "statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_remarks" ADD CONSTRAINT "lead_remarks_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "allocation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_match_values" ADD CONSTRAINT "user_match_values_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Rules Prisma cannot express (docs/SYSTEM-DESIGN.md §4, §5.6)
-- ---------------------------------------------------------------------------

-- A lead can have only one OPEN assignment per level: the database refuses a second one.
CREATE UNIQUE INDEX "lead_assignments_one_open" ON "lead_assignments" ("lead_id", "level") WHERE "ended_at" IS NULL;

-- A BDE is in only one team at a time; a team has at most one active Team Lead.
CREATE UNIQUE INDEX "team_memberships_one_active" ON "team_memberships" ("user_id") WHERE "to_at" IS NULL;
CREATE UNIQUE INDEX "team_lead_links_one_active" ON "team_lead_links" ("team_id") WHERE "to_at" IS NULL;

-- The same phone number cannot be two live leads.
CREATE UNIQUE INDEX "leads_phone_live" ON "leads" ("phone_e164") WHERE "deleted_at" IS NULL;

-- History tables are append-only.
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be changed or deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER status_history_append_only BEFORE UPDATE OR DELETE ON "status_history" FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER fin_calculations_append_only BEFORE UPDATE OR DELETE ON "fin_calculations" FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Money and counts can never be negative.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_positive" CHECK ("amount_paise" > 0);
ALTER TABLE "leads" ADD CONSTRAINT "leads_counts_non_negative" CHECK ("attempt_count" >= 0 AND "recycle_count" >= 0);
