-- =====================================================================
-- SliqDesk - PostgreSQL schema
-- Executed automatically by the official postgres image ONLY when the
-- data directory (named volume) is initialised for the first time.
-- =====================================================================

SET client_min_messages TO WARNING;

-- ---------------------------------------------------------------------
-- Helper: keep updated_at current on every UPDATE
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- organizations (tenants)
-- ---------------------------------------------------------------------
CREATE TABLE organizations (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(150) NOT NULL CHECK (length(btrim(name)) > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------
-- users (each user belongs to exactly one organization, one role)
-- Users are soft-deleted (is_active = false) so historical references
-- (ticket creator, comment author, audit trail) stay intact.
-- token_version is bumped to invalidate every issued JWT for the user.
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id               SERIAL PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             VARCHAR(100) NOT NULL CHECK (length(btrim(name)) > 0),
  email            VARCHAR(150) NOT NULL CHECK (email = lower(email)),
  password_hash    TEXT NOT NULL,
  role             VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'agent', 'viewer')),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  token_version    INTEGER NOT NULL DEFAULT 0,
  deactivated_at   TIMESTAMPTZ NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_users_org_email UNIQUE (organization_id, email),
  CONSTRAINT uq_users_org_id    UNIQUE (organization_id, id)
);
CREATE INDEX idx_users_org_email ON users (organization_id, email);
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_org_role_active ON users (organization_id, role) WHERE is_active;

-- ---------------------------------------------------------------------
-- invitations (member onboarding). Only a SHA-256 hash of the random
-- token is stored; the raw token is shown once to the inviting admin.
-- ---------------------------------------------------------------------
CREATE TABLE invitations (
  id               SERIAL PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             VARCHAR(100) NOT NULL,
  email            VARCHAR(150) NOT NULL CHECK (email = lower(email)),
  role             VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'agent', 'viewer')),
  token_hash       CHAR(64) NOT NULL UNIQUE,
  expires_at       TIMESTAMPTZ NOT NULL,
  invited_by       INTEGER NOT NULL,
  accepted_at      TIMESTAMPTZ NULL,
  revoked_at       TIMESTAMPTZ NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_invitations_org_id UNIQUE (organization_id, id),
  CONSTRAINT fk_invitations_inviter FOREIGN KEY (organization_id, invited_by)
    REFERENCES users (organization_id, id)
);
-- at most one open invitation per email per organization
CREATE UNIQUE INDEX uq_invitations_open_email
  ON invitations (organization_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- ---------------------------------------------------------------------
-- tickets
-- Composite FKs guarantee creator/assignee belong to the SAME organization.
-- ---------------------------------------------------------------------
CREATE TABLE tickets (
  id                 SERIAL PRIMARY KEY,
  organization_id    INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title              VARCHAR(200) NOT NULL CHECK (length(btrim(title)) > 0),
  description        TEXT NOT NULL CHECK (length(btrim(description)) > 0),
  status             VARCHAR(30) NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  priority           VARCHAR(30) NOT NULL DEFAULT 'medium'
                     CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assignee_id        INTEGER NULL,
  created_by         INTEGER NOT NULL,
  overdue            BOOLEAN NOT NULL DEFAULT FALSE,
  sla_due_at         TIMESTAMPTZ NULL,
  version            INTEGER NOT NULL DEFAULT 1,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_tickets_org_id UNIQUE (organization_id, id),
  CONSTRAINT fk_tickets_assignee FOREIGN KEY (organization_id, assignee_id)
    REFERENCES users (organization_id, id),
  CONSTRAINT fk_tickets_creator FOREIGN KEY (organization_id, created_by)
    REFERENCES users (organization_id, id)
);
CREATE INDEX idx_tickets_org_status     ON tickets (organization_id, status);
CREATE INDEX idx_tickets_org_priority   ON tickets (organization_id, priority);
CREATE INDEX idx_tickets_org_assignee   ON tickets (organization_id, assignee_id);
CREATE INDEX idx_tickets_org_created_at ON tickets (organization_id, created_at);

-- ---------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------
CREATE TABLE comments (
  id                 SERIAL PRIMARY KEY,
  organization_id    INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id          INTEGER NOT NULL,
  user_id            INTEGER NOT NULL,
  message            TEXT NOT NULL CHECK (length(btrim(message)) > 0),
  is_staff_response  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_comments_ticket FOREIGN KEY (organization_id, ticket_id)
    REFERENCES tickets (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_user FOREIGN KEY (organization_id, user_id)
    REFERENCES users (organization_id, id)
);
CREATE INDEX idx_comments_org_ticket_created ON comments (organization_id, ticket_id, created_at);

-- ---------------------------------------------------------------------
-- sla_settings (one row per organization)
-- ---------------------------------------------------------------------
CREATE TABLE sla_settings (
  id                     SERIAL PRIMARY KEY,
  organization_id        INTEGER UNIQUE NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  response_time_minutes  INTEGER NOT NULL DEFAULT 5
                         CHECK (response_time_minutes > 0 AND response_time_minutes <= 43200),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------
-- notifications + per-user recipients (independent read state)
-- dedupe_key makes notification creation idempotent (e.g. one overdue
-- notification per ticket per SLA cycle, even with concurrent workers).
-- notifications.read_at is kept for schema compatibility; per-user read
-- state lives in notification_recipients.read_at.
-- ---------------------------------------------------------------------
CREATE TABLE notifications (
  id                 SERIAL PRIMARY KEY,
  organization_id    INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id          INTEGER NOT NULL,
  type               VARCHAR(50) NOT NULL,
  message            TEXT NOT NULL,
  dedupe_key         VARCHAR(120) NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at            TIMESTAMPTZ NULL,
  CONSTRAINT uq_notifications_org_id UNIQUE (organization_id, id),
  CONSTRAINT uq_notifications_dedupe UNIQUE (organization_id, dedupe_key),
  CONSTRAINT fk_notifications_ticket FOREIGN KEY (organization_id, ticket_id)
    REFERENCES tickets (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_notifications_org_created ON notifications (organization_id, created_at);

CREATE TABLE notification_recipients (
  notification_id  INTEGER NOT NULL,
  user_id          INTEGER NOT NULL,
  organization_id  INTEGER NOT NULL,
  read_at          TIMESTAMPTZ NULL,
  PRIMARY KEY (notification_id, user_id),
  CONSTRAINT fk_recipients_notification FOREIGN KEY (organization_id, notification_id)
    REFERENCES notifications (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_recipients_user FOREIGN KEY (organization_id, user_id)
    REFERENCES users (organization_id, id)
);
CREATE INDEX idx_recipients_user_unread ON notification_recipients (organization_id, user_id, read_at);

-- ---------------------------------------------------------------------
-- sla_jobs - persistent SLA work queue (one row per ticket; re-used and
-- re-armed for every SLA cycle). Status values:
--   pending   : waiting for deadline (scheduled_at)
--   completed : qualifying staff response arrived before deadline
--   cancelled : no longer applicable (resolved/closed/de-prioritised)
--   overdue   : deadline passed without qualifying response
-- ---------------------------------------------------------------------
CREATE TABLE sla_jobs (
  id               SERIAL PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id        INTEGER NOT NULL,
  cycle            INTEGER NOT NULL DEFAULT 1,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  scheduled_at     TIMESTAMPTZ NOT NULL,
  status           VARCHAR(30) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'completed', 'cancelled', 'overdue')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at     TIMESTAMPTZ NULL,
  CONSTRAINT uq_sla_jobs_org_ticket UNIQUE (organization_id, ticket_id),
  CONSTRAINT fk_sla_jobs_ticket FOREIGN KEY (organization_id, ticket_id)
    REFERENCES tickets (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_sla_jobs_status_scheduled ON sla_jobs (status, scheduled_at);

-- ---------------------------------------------------------------------
-- audit_logs - immutable audit trail (UPDATE/DELETE blocked by trigger)
-- Never store passwords, password hashes or tokens here.
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  INTEGER NULL REFERENCES organizations(id),
  event_type       VARCHAR(60) NOT NULL,
  entity_type      VARCHAR(40) NOT NULL,
  entity_id        INTEGER NULL,
  performed_by     INTEGER NULL,
  performed_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  old_value        JSONB NULL,
  new_value        JSONB NULL,
  ip_address       VARCHAR(64) NULL
);
CREATE INDEX idx_audit_org_performed ON audit_logs (organization_id, performed_at);
CREATE INDEX idx_audit_entity ON audit_logs (organization_id, entity_type, entity_id);

CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_organizations_updated BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tickets_updated BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_sla_settings_updated BEFORE UPDATE ON sla_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_sla_jobs_updated BEFORE UPDATE ON sla_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
