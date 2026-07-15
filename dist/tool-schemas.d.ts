import { z } from 'zod';
export declare const EditNoteSchema: z.ZodEffects<z.ZodObject<{
    note_path: z.ZodString;
    content: z.ZodString;
    mode: z.ZodDefault<z.ZodEnum<["overwrite", "append", "append-section", "replace", "insert-after-heading"]>>;
    heading: z.ZodOptional<z.ZodString>;
    find: z.ZodOptional<z.ZodString>;
    regex: z.ZodOptional<z.ZodBoolean>;
    count: z.ZodOptional<z.ZodNumber>;
    dry_run: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    content: string;
    note_path: string;
    mode: "replace" | "append-section" | "overwrite" | "append" | "insert-after-heading";
    find?: string | undefined;
    heading?: string | undefined;
    regex?: boolean | undefined;
    count?: number | undefined;
    dry_run?: boolean | undefined;
}, {
    content: string;
    note_path: string;
    find?: string | undefined;
    mode?: "replace" | "append-section" | "overwrite" | "append" | "insert-after-heading" | undefined;
    heading?: string | undefined;
    regex?: boolean | undefined;
    count?: number | undefined;
    dry_run?: boolean | undefined;
}>, {
    content: string;
    note_path: string;
    mode: "replace" | "append-section" | "overwrite" | "append" | "insert-after-heading";
    find?: string | undefined;
    heading?: string | undefined;
    regex?: boolean | undefined;
    count?: number | undefined;
    dry_run?: boolean | undefined;
}, {
    content: string;
    note_path: string;
    find?: string | undefined;
    mode?: "replace" | "append-section" | "overwrite" | "append" | "insert-after-heading" | undefined;
    heading?: string | undefined;
    regex?: boolean | undefined;
    count?: number | undefined;
    dry_run?: boolean | undefined;
}>;
export declare const NoteWorkflowSchema: z.ZodEffects<z.ZodObject<{
    action: z.ZodEnum<["create", "edit", "delete"]>;
    note_path: z.ZodString;
    content: z.ZodOptional<z.ZodString>;
    frontmatter: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    mode: z.ZodDefault<z.ZodEnum<["overwrite", "append", "append-section", "replace", "insert-after-heading"]>>;
    heading: z.ZodOptional<z.ZodString>;
    find: z.ZodOptional<z.ZodString>;
    regex: z.ZodOptional<z.ZodBoolean>;
    count: z.ZodOptional<z.ZodNumber>;
    dry_run: z.ZodOptional<z.ZodBoolean>;
    defer_hint_seconds: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    note_path: string;
    mode: "replace" | "append-section" | "overwrite" | "append" | "insert-after-heading";
    action: "create" | "edit" | "delete";
    find?: string | undefined;
    content?: string | undefined;
    heading?: string | undefined;
    regex?: boolean | undefined;
    count?: number | undefined;
    dry_run?: boolean | undefined;
    frontmatter?: Record<string, unknown> | undefined;
    defer_hint_seconds?: number | undefined;
}, {
    note_path: string;
    action: "create" | "edit" | "delete";
    find?: string | undefined;
    content?: string | undefined;
    mode?: "replace" | "append-section" | "overwrite" | "append" | "insert-after-heading" | undefined;
    heading?: string | undefined;
    regex?: boolean | undefined;
    count?: number | undefined;
    dry_run?: boolean | undefined;
    frontmatter?: Record<string, unknown> | undefined;
    defer_hint_seconds?: number | undefined;
}>, {
    note_path: string;
    mode: "replace" | "append-section" | "overwrite" | "append" | "insert-after-heading";
    action: "create" | "edit" | "delete";
    find?: string | undefined;
    content?: string | undefined;
    heading?: string | undefined;
    regex?: boolean | undefined;
    count?: number | undefined;
    dry_run?: boolean | undefined;
    frontmatter?: Record<string, unknown> | undefined;
    defer_hint_seconds?: number | undefined;
}, {
    note_path: string;
    action: "create" | "edit" | "delete";
    find?: string | undefined;
    content?: string | undefined;
    mode?: "replace" | "append-section" | "overwrite" | "append" | "insert-after-heading" | undefined;
    heading?: string | undefined;
    regex?: boolean | undefined;
    count?: number | undefined;
    dry_run?: boolean | undefined;
    frontmatter?: Record<string, unknown> | undefined;
    defer_hint_seconds?: number | undefined;
}>;
export declare function formatToolError(toolName: string, error: unknown): string;
//# sourceMappingURL=tool-schemas.d.ts.map