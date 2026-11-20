// Reports what the storage cannot do; the adapter passes one that names itself in the debug log.
export type TabStorageLogger = (message: string) => void;

// Flags and values the checkout events pass from one page of the tab to the next, e.g. that the shopper clicked to start the checkout.
// Storage that is switched off, e.g. in a private window that blocks it, keeps nothing: those events are then not sent, the shop works on.
export class TabStorage {
    constructor(protected log: TabStorageLogger) {}

    get(key: string): string | null {
        try {
            return window.sessionStorage.getItem(key);
        } catch (error) {
            this.log(`${key} cannot be read: ${error}`);

            return null;
        }
    }

    set(key: string, value: string): void {
        try {
            window.sessionStorage.setItem(key, value);
        } catch (error) {
            this.log(`${key} cannot be stored: ${error}`);
        }
    }

    remove(key: string): void {
        try {
            window.sessionStorage.removeItem(key);
        } catch {
            // Storage that is switched off has nothing stored; reading it reports that.
        }
    }

    // Read and removed, so only the next page load can use it.
    take(key: string): string | null {
        const value = this.get(key);

        this.remove(key);

        return value;
    }
}
