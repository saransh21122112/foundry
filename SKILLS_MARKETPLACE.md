# Skills marketplace — design (not built yet)

A real implementation plan, written so a future session can build this
without re-deriving the design. Not built this pass — see `ROADMAP.md` for
where this sits relative to everything else.

## What this is

eve (the framework `apps/agent-runtime` runs on) has a native `Skill`
primitive: markdown/`SKILL.md`-based procedures a model loads on demand via
a framework-owned `load_skill` tool (`node_modules/eve/docs/skills.mdx`) —
the same convention as Claude Code's own Agent Skills standard, confirmed
by eve's own docs, not a different concept wearing the same name.

eve has **no marketplace/distribution concept of its own** — skills are
authored as files per-agent, compiled once. What makes a *marketplace*
possible at all is that `defineSkill` (from `eve/skills`) supports a
**dynamic resolver keyed on `ctx.session.auth`**, the exact same mechanism
`apps/agent-runtime/agent/lib/resolve-instructions.ts` already uses to
serve a different system prompt per org. That's the seam this design
builds on — nothing new needed from eve itself.

## Schema

Two new tables in `packages/db/src/schema.ts`:

```ts
// Shared library — Foundry-authored (orgId null) today; orgId column
// reserved for org-to-org sharing/publishing later, not built in v1.
export const skillsLibrary = pgTable("skills_library", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id),
  department: departmentEnum("department").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(), // shown in the browse UI; also load_skill's routing hint
  markdown: text("markdown").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// What an org has actually installed for a department — copy-on-install,
// not a live reference (same "predictable, doesn't change under you"
// reasoning as agentPromptOverrides).
export const orgSkills = pgTable("org_skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  department: departmentEnum("department").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  markdown: text("markdown").notNull(),
  installedFromLibraryId: uuid("installed_from_library_id").references(() => skillsLibrary.id), // null = custom-written
  installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgDeptNameIdx: uniqueIndex("org_skills_org_dept_name_idx").on(t.orgId, t.department, t.name),
}));
```

## Runtime wiring

One `defineSkill`-based dynamic skill per department:
`agent/subagents/<dept>/skills/org-skills.ts`. Resolver queries `orgSkills`
for that org + department (same `ctx.session.auth.current?.attributes?.orgId`
extraction every tool in this codebase already does) and returns each
installed skill's `{description, markdown}` to eve. Directly mirrors
`resolve-instructions.ts`'s existing per-org DB-lookup-on-session-start
pattern — same shape, different eve primitive on the receiving end
(`defineSkill` instead of `defineInstructions`).

## Dashboard UI

New `/dashboard/skills` page, modeled directly on `/dashboard/prompts`'s
existing browse/edit shape (`PromptsBoard.tsx`, `agents.ts`, `actions.ts`):

- Browse the shared library (`skillsLibrary` where `orgId IS NULL`),
  grouped by department.
- "Install" copies a library skill's *current* content into `orgSkills`
  for that org (copy-on-install — see below).
- A plain textarea editor (same shape `PromptsBoard.tsx` already uses) for
  writing a fully custom org-specific skill, bypassing the library.
- List currently-installed skills per department with an "Uninstall"
  action (deletes the `orgSkills` row).
- Register the new route in `apps/web/lib/nav.ts`'s `NAV` array, same as
  every other dashboard page.

## Explicitly deferred past v1

Named so a future session doesn't have to re-decide these, not because
they're unimportant:

- **Live-reference install vs. copy-on-install staleness.** v1 copies
  content at install time; if the library source is later edited, an
  org's installed copy doesn't change. An "update available" diff
  indicator is the natural v2, not built here.
- **Org-to-org sharing/publishing.** `skillsLibrary.orgId` exists as a
  column for this (a non-null value would mean "authored by this org,
  shared"), but nothing reads/writes it that way yet — v1 is Foundry-
  authored library content only.
- **Skill versioning/rollback.** No history table; `orgSkills` holds
  exactly one current version per (org, department, name).

## Why not built this pass

Scoped and designed at the user's explicit request, but this is a genuine
net-new subsystem (2 tables, a new dynamic-skill wiring pattern, a new
dashboard page) — building it blind in the same pass as two other features
risked rushing the one piece with real multi-tenant data-modeling
decisions (the copy-on-install call in particular). Build it as its own
pass, verifying against this doc rather than re-deriving the design.
