import { relations } from "drizzle-orm";
import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ *
 * Enums
 * ------------------------------------------------------------------ */

export const userRole = pgEnum("user_role", ["admin", "user"]);

/** Level of the education entity a row of data belongs to. */
export const entityType = pgEnum("entity_type", ["school", "district", "state"]);

/**
 * How a metric's value should be interpreted / rendered. Drives formatting
 * in the UI and how the AI reasons about the number.
 */
export const dataType = pgEnum("data_type", [
  "numeric", // a plain number
  "percent", // 0-100 (stored as-is, e.g. 87.4)
  "count", // whole-number tallies (enrollment, # of teachers)
  "currency", // dollars
  "ratio", // e.g. student:teacher
  "categorical", // a label from a fixed set (stored in value_text)
  "text", // free text
]);

/* ------------------------------------------------------------------ *
 * Auth: users + sessions
 * ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 255 }),
  // The FIRST user to sign up is promoted to "admin" (see auth/actions.ts).
  role: userRole("role").notNull().default("user"),
  // Optional "home" district — the district a user cares about by default.
  homeDistrictId: integer("home_district_id").references(
    (): AnyPgColumn => entities.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Server-side sessions. `id` is the SHA-256 hash of the opaque token handed to
 * the browser in an httpOnly cookie, so a database leak never exposes a usable
 * session token.
 */
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // When an admin is impersonating (logged in as) another user, this holds the
  // admin's id so they can return to their own account.
  impersonatorId: integer("impersonator_id").references(() => users.id, {
    onDelete: "set null",
  }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ------------------------------------------------------------------ *
 * Data dictionary: metrics
 * ------------------------------------------------------------------ */

/**
 * The data dictionary. One row = one datapoint definition (e.g. "4-year
 * graduation rate"). Every value in `facts` points back here, which is the tie
 * between the raw data and its human-readable description.
 */
export const metrics = pgTable("metrics", {
  id: serial("id").primaryKey(),
  // Stable machine key, e.g. "grad_rate_4yr". Used by importers so re-ingesting
  // the same dataset updates rather than duplicates.
  code: varchar("code", { length: 128 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Grouping for the UI, e.g. "Graduation", "Enrollment", "Assessment".
  category: varchar("category", { length: 128 }),
  dataType: dataType("data_type").notNull().default("numeric"),
  unit: varchar("unit", { length: 64 }),
  // Provenance, e.g. "NYSED Report Card 2022-23".
  source: varchar("source", { length: 255 }),
  // Semantic-search embedding of this datapoint's text (name + category +
  // description). Stored as a JSON number[]; no pgvector needed since the
  // metric catalog is small enough for brute-force cosine ranking. `model`
  // records which Ollama model produced it and `hash` = sha256(model + input),
  // so the embed script can (re)embed only what's missing or stale.
  embedding: jsonb("embedding").$type<number[]>(),
  embeddingModel: varchar("embedding_model", { length: 128 }),
  embeddingHash: varchar("embedding_hash", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ------------------------------------------------------------------ *
 * Entities: schools, districts, state
 * ------------------------------------------------------------------ */

export const entities = pgTable(
  "entities",
  {
    id: serial("id").primaryKey(),
    // NY's Basic Educational Data System code — the natural key for a school
    // or district. Nullable for synthetic rows (e.g. statewide totals).
    bedsCode: varchar("beds_code", { length: 32 }).unique(),
    name: varchar("name", { length: 512 }).notNull(),
    type: entityType("type").notNull(),
    // Schools roll up into their district; districts have this null.
    parentDistrictId: integer("parent_district_id").references(
      (): AnyPgColumn => entities.id,
      { onDelete: "set null" },
    ),
    county: varchar("county", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("entities_type_idx").on(t.type),
    index("entities_parent_idx").on(t.parentDistrictId),
  ],
);

/* ------------------------------------------------------------------ *
 * Facts: the actual data, in long / tidy form
 * ------------------------------------------------------------------ */

/**
 * One row = one (entity, metric, school-year, subgroup) observation. Long
 * format means ingesting a brand-new dataset never requires a schema change —
 * you just add rows — and the front end can pivot any set of metrics into
 * spreadsheet columns on demand.
 *
 * `subgroup` captures NYSED's ubiquitous demographic breakdowns (race, gender,
 * SWD, ELL, econ-disadvantaged…). Rows that aren't broken down use the default
 * "All Students", which keeps the upsert key stable (Postgres treats NULLs as
 * distinct, so a NOT NULL default is required here). Finer dimensions
 * (grade, subject, assessment level) are folded into the metric code.
 */
export const facts = pgTable(
  "facts",
  {
    id: serial("id").primaryKey(),
    entityId: integer("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    metricId: integer("metric_id")
      .notNull()
      .references(() => metrics.id, { onDelete: "cascade" }),
    // e.g. "2022-23". Kept as a string to preserve NY's academic-year labels.
    schoolYear: varchar("school_year", { length: 16 }).notNull(),
    // Demographic breakdown, e.g. "All Students", "Black", "Female", "SWD".
    subgroup: varchar("subgroup", { length: 128 })
      .notNull()
      .default("All Students"),
    // Numeric values live here; categorical/text values live in valueText.
    valueNumeric: doublePrecision("value_numeric"),
    valueText: text("value_text"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One observation per entity/metric/year/subgroup — lets importers upsert.
    uniqueIndex("facts_entity_metric_year_subgroup_uniq").on(
      t.entityId,
      t.metricId,
      t.schoolYear,
      t.subgroup,
    ),
    // Fast column pulls ("metric X across all entities for year Y, subgroup S").
    index("facts_metric_year_subgroup_idx").on(
      t.metricId,
      t.schoolYear,
      t.subgroup,
    ),
    index("facts_entity_idx").on(t.entityId),
  ],
);

/* ------------------------------------------------------------------ *
 * Saved groups: user-curated sets of entities
 * ------------------------------------------------------------------ */

/**
 * A user-defined collection of schools/districts, used as a one-click filter
 * in the Data Workshop ("show only this group"). Membership is stored as a
 * JSON array of entity ids rather than a join table: the sets are small,
 * strictly user-scoped, and always read/written whole. Ids that later point at
 * a deleted entity are simply filtered out on read.
 */
export const entityGroups = pgTable(
  "entity_groups",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    entityIds: jsonb("entity_ids").$type<number[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("entity_groups_user_idx").on(t.userId)],
);

/**
 * A saved Data Workshop session: a named, serialized snapshot of every filter,
 * sort, and column (including calculated fields). Stored per-user as opaque
 * JSON — the workshop knows how to (de)serialize it; the DB just holds it.
 */
export const savedViews = pgTable(
  "saved_views",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    state: jsonb("state").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("saved_views_user_idx").on(t.userId)],
);

/**
 * A saved Visualizer chart: a named, declarative chart spec (data query +
 * encoding). Stored per-user as opaque JSON — the Visualizer knows the spec
 * schema; the DB just holds it.
 */
export const savedCharts = pgTable(
  "saved_charts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("saved_charts_user_idx").on(t.userId)],
);

/* ------------------------------------------------------------------ *
 * Activity log (audit trail: sign-ins, saves, loads)
 * ------------------------------------------------------------------ */

export const activityLog = pgTable(
  "activity_log",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 64 }).notNull(), // e.g. login, view.save, chart.load
    targetType: varchar("target_type", { length: 32 }), // view | group | visualization
    targetName: varchar("target_name", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_log_user_idx").on(t.userId),
    index("activity_log_created_idx").on(t.createdAt),
  ],
);

export type ActivityLog = typeof activityLog.$inferSelect;

/* ------------------------------------------------------------------ *
 * App settings (key/value)
 * ------------------------------------------------------------------ */

/**
 * Simple key/value store for admin-configured application settings, e.g. the
 * Ollama server URL and the selected model. Kept generic so new settings don't
 * need schema changes.
 */
export const settings = pgTable("settings", {
  key: varchar("key", { length: 128 }).primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedByUserId: integer("updated_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
});

/* ------------------------------------------------------------------ *
 * Relations (for Drizzle's relational query API)
 * ------------------------------------------------------------------ */

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const entitiesRelations = relations(entities, ({ one, many }) => ({
  parentDistrict: one(entities, {
    fields: [entities.parentDistrictId],
    references: [entities.id],
    relationName: "district_schools",
  }),
  schools: many(entities, { relationName: "district_schools" }),
  facts: many(facts),
}));

export const metricsRelations = relations(metrics, ({ many }) => ({
  facts: many(facts),
}));

export const factsRelations = relations(facts, ({ one }) => ({
  entity: one(entities, {
    fields: [facts.entityId],
    references: [entities.id],
  }),
  metric: one(metrics, {
    fields: [facts.metricId],
    references: [metrics.id],
  }),
}));

/* ------------------------------------------------------------------ *
 * Inferred types
 * ------------------------------------------------------------------ */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Metric = typeof metrics.$inferSelect;
export type NewMetric = typeof metrics.$inferInsert;
export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;
export type Fact = typeof facts.$inferSelect;
export type NewFact = typeof facts.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type EntityGroup = typeof entityGroups.$inferSelect;
export type NewEntityGroup = typeof entityGroups.$inferInsert;
export type SavedView = typeof savedViews.$inferSelect;
export type NewSavedView = typeof savedViews.$inferInsert;
export type SavedChart = typeof savedCharts.$inferSelect;
export type NewSavedChart = typeof savedCharts.$inferInsert;

export type UserRole = (typeof userRole.enumValues)[number];
export type EntityType = (typeof entityType.enumValues)[number];
export type DataType = (typeof dataType.enumValues)[number];
