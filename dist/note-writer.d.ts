export type EditMode = 'overwrite' | 'append' | 'append-section';
export declare function createNote(vault: string, notePath: string, body: string, frontmatter?: Record<string, unknown>): void;
export declare function editNote(vault: string, notePath: string, content: string, mode: EditMode, heading?: string): void;
export declare function deleteNote(vault: string, notePath: string): void;
//# sourceMappingURL=note-writer.d.ts.map