import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { fileSystemDocument } from "@/modules/documents/service";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";

// Filing the signed copy in the Documents of the people who signed it with an ELEVATE account. The contractor then finds what they
// signed under their own Documents, with the other files, instead of only inside the signing screen. A signer who is not an ELEVATE
// user (an applicant who signed an offer by emailed link) has no Documents and gets nothing.
//
// A document that holds personal details typed while signing (bank details) is restricted to the contractor who typed them and HR:
// it is filed ONLY for the signers who typed details, never for the Company's countersigner.

/** Envelopes filed per run (catching up older ones a few at a time). */
const BATCH = 50;

type Row = { signer_id: string; user_id: string; employee_id: string; envelope_id: string; title: string; sealed_path: string };

/** The signers (with an account and a people record) of completed envelopes whose copy has not been filed yet. */
async function pending(envelopeId?: string): Promise<Row[]> {
  return (await db.execute(sql`
    select s.id as signer_id, s.user_id, e2.id as employee_id, env.id as envelope_id, env.title, env.sealed_path
    from docs.esign_envelopes env
    join docs.esign_signers s on s.envelope_id = env.id
    join lateral (select e.id from core.employees e where e.user_id = s.user_id and e.archived_at is null order by e.created_at desc limit 1) e2 on true
    where env.status = 'completed' and env.sealed_path is not null
      and s.user_id is not null and s.status = 'signed'
      and (coalesce(array_length(env.signee_details, 1), 0) = 0 or s.fills_details)
      and not exists (select 1 from docs.system_documents d where d.source_kind = 'esign_signer' and d.source_id = s.id)
      ${envelopeId ? sql`and env.id = ${envelopeId}::uuid` : sql``}
    order by env.sealed_at
    limit ${BATCH * 4}`)) as unknown as Row[];
}

/**
 * Files the signed copy for the signers who do not have it yet: for one envelope (right after it is sealed), or for the oldest
 * completed envelopes that were never filed (the sweep catches up the ones signed before this existed). Safe to repeat.
 */
export async function fileSignedCopies(envelopeId?: string): Promise<{ filed: number }> {
  const todo = await pending(envelopeId);
  const storage = getDocumentStorage();
  const bytesOf = new Map<string, Uint8Array | null>();
  let filed = 0;
  let envelopes = 0;
  for (const r of todo) {
    if (!bytesOf.has(r.envelope_id)) {
      if (!envelopeId && envelopes >= BATCH) break;
      envelopes += 1;
      bytesOf.set(r.envelope_id, await storage.read(BUCKETS.signed, r.sealed_path));
    }
    const bytes = bytesOf.get(r.envelope_id);
    if (!bytes) continue;
    try {
      const result = await fileSystemDocument({ employeeId: r.employee_id, typeSlug: "signed_document", title: r.title, fileName: `${r.title}.pdf`, bytes, sourceKind: "esign_signer", sourceId: r.signer_id });
      if (result === "filed") filed += 1;
    } catch (error) {
      console.error("filing a signed copy failed:", error instanceof Error ? error.name : "unknown error");
    }
  }
  return { filed };
}
