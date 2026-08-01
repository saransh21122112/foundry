import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db, ensureOrganization, toolAllowlists } from "@foundry/db";
import { DEPARTMENTS, KNOWN_TOOLS, type RiskClass } from "@foundry/shared-types";
import { RISK_CLASS_DESCRIPTION, RISK_CLASS_LABEL } from "@/lib/copy";
import { setToolAllowed } from "./actions";

export default async function ToolsPage() {
  const { orgId: clerkOrgId, orgSlug } = await auth();

  if (!clerkOrgId) {
    return (
      <main>
        <h1>Tool allowlist</h1>
        <p className="lede">Sign in and select or create an organization to configure tool access.</p>
      </main>
    );
  }

  const org = await ensureOrganization({ clerkOrgId, slug: orgSlug ?? undefined });
  const rows = await db.select().from(toolAllowlists).where(eq(toolAllowlists.orgId, org.id));
  const allowedByKey = new Map(rows.map((r) => [`${r.department}:${r.toolName}`, r.allowed]));

  const gatedTools = DEPARTMENTS.flatMap((department) =>
    KNOWN_TOOLS[department].filter((tool) => tool.gated).map((tool) => ({ department, ...tool })),
  );

  return (
    <main>
      <p className="eyebrow">Turn off specific actions</p>
      <h1>Tool allowlist</h1>
      <p className="lede">
        Switch off a specific action for a department, separately from its
        overall autonomy level — e.g. let sales-lead draft outreach but
        never actually let it send email. Leave a switch on and it follows
        whatever autonomy level the department is set to. Pure lookups
        aren&apos;t listed here — they never need a switch since they can
        never do anything with a real effect.
      </p>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Department</th>
              <th>Tool</th>
              <th>Risk</th>
              <th>Allowed</th>
            </tr>
          </thead>
          <tbody>
            {gatedTools.map((tool) => {
              const key = `${tool.department}:${tool.name}`;
              const allowed = allowedByKey.get(key) ?? true;
              const risk = tool.riskClass as RiskClass;
              return (
                <tr key={key}>
                  <td className="mono">{tool.department}</td>
                  <td className="mono">{tool.name}</td>
                  <td>
                    <span className={`badge badge-risk-${risk}`} title={RISK_CLASS_DESCRIPTION[risk]}>
                      {RISK_CLASS_LABEL[risk]}
                    </span>
                  </td>
                  <td>
                    <form action={setToolAllowed} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input type="hidden" name="department" value={tool.department} />
                      <input type="hidden" name="toolName" value={tool.name} />
                      <input type="checkbox" name="allowed" defaultChecked={allowed} />
                      <button type="submit" className="btn">
                        Save
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
