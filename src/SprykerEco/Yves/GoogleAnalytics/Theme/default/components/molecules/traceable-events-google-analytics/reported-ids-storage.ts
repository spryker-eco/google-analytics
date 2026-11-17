// Reports what the storage cannot do; the adapter passes one that names itself in the debug log.
export type ReportedIdsStorageLogger = (message: string) => void;

// The ids already reported, e.g. order references, kept in the local storage, so reloading or returning to a page does not report
// them again, also in another tab. Only the newest ones are kept. Storage that is switched off keeps none: a reload can then report
// an id again, the shop works on.
export class ReportedIdsStorage {
    constructor(
        protected storageKey: string,
        protected maxIds: number,
        protected log: ReportedIdsStorageLogger,
    ) {}

    has(id: string): boolean {
        return this.read().includes(id);
    }

    add(id: string): void {
        const reportedIds = [...this.read(), id].slice(-this.maxIds);

        try {
            window.localStorage.setItem(this.storageKey, JSON.stringify(reportedIds));
        } catch (error) {
            this.log(`${id} is not kept as reported, the local storage refused it: ${error}`);
        }
    }

    // A value that is not a JSON list, e.g. one another script wrote, holds no ids.
    protected read(): string[] {
        try {
            const reportedIds: unknown = JSON.parse(window.localStorage.getItem(this.storageKey) ?? '[]');

            return Array.isArray(reportedIds) ? reportedIds.map(String) : [];
        } catch (error) {
            this.log(`the reported ids cannot be read: ${error}`);

            return [];
        }
    }
}
