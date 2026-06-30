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
export declare function formatToolError(toolName: string, error: unknown): string;
//# sourceMappingURL=tool-schemas.d.ts.map