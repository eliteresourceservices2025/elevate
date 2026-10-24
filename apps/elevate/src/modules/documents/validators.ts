import { z } from "zod";
import { isoDate } from "@/modules/people/validators";
import { MAX_FILE_BYTES } from "./files";

const uuid = z.uuid();
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const name = (label: string, max = 120) => z.string().trim().min(2, `Enter ${label}`).max(max, `Use ${max} characters or fewer`);

export const requestUploadSchema = z.object({
  /** "employee" files belong to a person; "company" files are policies and forms. */
  target: z.enum(["employee", "company"]),
  employeeId: z.preprocess(blankToUndefined, uuid.optional()),
  typeId: uuid,
  title: name("a title"),
  clientId: z.preprocess(blankToUndefined, uuid.optional()),
  /** One of the person's own folders (optional). */
  folderId: z.preprocess(blankToUndefined, uuid.optional()),
  expiresOn: z.preprocess(blankToUndefined, isoDate.optional()),
  audience: z.enum(["all_staff", "hr_only"]).default("all_staff"),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().max(120),
  sizeBytes: z.number().int().min(1, "That file is empty").max(MAX_FILE_BYTES, "Files can be 10 MB at most"),
  /** The person confirms the file holds no client or patient information (CLAUDE.md, HIPAA rule). */
  acknowledged: z.literal(true, { error: "Confirm the file has no client or patient information" }),
});

export const documentIdSchema = z.object({ documentId: uuid });

const folderName = z.string().trim().min(1, "Name the folder").max(60, "Use 60 characters or fewer");
export const createFolderSchema = z.object({ employeeId: uuid, name: folderName });
export const renameFolderSchema = z.object({ folderId: uuid, name: folderName });
export const folderIdSchema = z.object({ folderId: uuid });
export const moveDocumentSchema = z.object({ documentId: uuid, folderId: uuid.nullable() });

export const changeDocumentTypeSchema = z.object({
  documentId: uuid,
  typeId: uuid,
  title: name("a title"),
  clientId: z.preprocess(blankToUndefined, uuid.optional()),
  expiresOn: z.preprocess(blankToUndefined, isoDate.optional()),
  /** Company files only: who may read it. */
  audience: z.enum(["all_staff", "hr_only"]).optional(),
});

export const renameDocumentSchema = z.object({ documentId: uuid, name: z.string().trim().min(1, "Enter a file name").max(255, "Use 255 characters or fewer") });

const documentIds = z.array(uuid).min(1, "Select at least one document").max(100, "Select 100 documents at most");
export const bulkDocumentsSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("archive"), documentIds }),
  z.object({ action: z.literal("restore"), documentIds }),
  z.object({ action: z.literal("delete"), documentIds, reason: z.string().trim().min(3, "Give a short reason").max(500, "Use 500 characters or fewer") }),
]);

export const verifyDocumentSchema =z.object({ documentId: uuid, verified: z.boolean() });

export const documentTypeSchema = z.object({
  name: name("a name", 80),
  scope: z.enum(["employee", "company"]),
  requiresExpiry: z.boolean().default(false),
  requiresClient: z.boolean().default(false),
  requiredForAll: z.boolean().default(false),
});
export const updateDocumentTypeSchema = documentTypeSchema.extend({ typeId: uuid });
export const archiveDocumentTypeSchema = z.object({ typeId: uuid });

export type RequestUploadInput = z.input<typeof requestUploadSchema>;
