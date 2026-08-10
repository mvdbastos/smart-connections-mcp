export type EditMode = 'overwrite' | 'append' | 'append-section' | 'replace' | 'insert-after-heading';
export interface EditOptions {
    content?: string;
    mode: EditMode;
    heading?: string;
    find?: string;
    regex?: boolean;
    count?: number;
    dryRun?: boolean;
}
export interface EditResult {
    path: string;
    mode: string;
    changed: boolean;
    written: boolean;
    diff?: string;
    previousHash: string;
    newHash: string;
}
export declare function createNote(vault: string, notePath: string, body: string, frontmatter?: Record<string, unknown>): string;
export declare function editNote(vault: string, notePath: string, options: EditOptions): EditResult;
export declare function editNote(vault: string, notePath: string, content: string, mode: EditMode, heading?: string): EditResult;
export declare function deleteNote(vault: string, notePath: string): void;
//# sourceMappingURL=note-writer.d.ts.map