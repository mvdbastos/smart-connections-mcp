export declare class Embedder {
    private pipe;
    private available;
    tryInit(): Promise<boolean>;
    isAvailable(): boolean;
    embed(text: string): Promise<number[]>;
    private truncateToTokenLimit;
}
//# sourceMappingURL=embedder.d.ts.map