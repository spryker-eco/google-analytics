import { PendingEvent } from './types';

// Reports what the storage cannot do; the adapter passes one that names itself in the debug log.
export type PendingEventsStorageLogger = (message: string) => void;

// A tab whose gtag script never loads passes the events on from page to page; only the newest ones are kept.
const MAX_STORED_EVENTS = 50;
// An event the tab could not send for this long is dropped: sent later, it would land in another session and at another time.
// 30 minutes.
const MAX_PENDING_EVENT_AGE_MILLISECONDS = 1800000;

const isPendingEvent = (value: unknown): value is PendingEvent => {
    const pendingEvent = value as PendingEvent;

    return (
        typeof pendingEvent?.name === 'string' &&
        typeof pendingEvent.params === 'object' &&
        pendingEvent.params !== null &&
        typeof pendingEvent.raisedAt === 'number'
    );
};

// The events a page could not send before it was left, kept in the session storage of the tab for the next page. Storage that
// is switched off or full loses them, as the navigation would; tracking never breaks the page.
export class PendingEventsStorage {
    constructor(
        protected storageKey: string,
        protected log: PendingEventsStorageLogger,
    ) {}

    // Added to what is stored already, e.g. by the same page when it was hidden before.
    add(events: PendingEvent[]): void {
        const storedEvents = [...this.read(), ...events].slice(-MAX_STORED_EVENTS);

        try {
            window.sessionStorage.setItem(this.storageKey, JSON.stringify(storedEvents));
        } catch (error) {
            this.log(`${storedEvents.length} pending events are lost, the session storage refused them: ${error}`);
        }
    }

    // Taken off the storage, so every page sends them once at most; events older than the maximum age are dropped.
    // Runs on every page load and tab focus; with nothing stored, the usual case, it only reads the storage once.
    take(): PendingEvent[] {
        const storedEventsJson = this.readJson();

        if (storedEventsJson === null) {
            return [];
        }

        this.remove();

        const storedEvents = this.parse(storedEventsJson);
        const oldestRaisedAt = Date.now() - MAX_PENDING_EVENT_AGE_MILLISECONDS;
        const currentEvents = storedEvents.filter((storedEvent) => storedEvent.raisedAt >= oldestRaisedAt);

        if (currentEvents.length < storedEvents.length) {
            this.log(
                `${storedEvents.length - currentEvents.length} stored events are older than the maximum age and dropped`,
            );
        }

        return currentEvents;
    }

    protected read(): PendingEvent[] {
        const storedEventsJson = this.readJson();

        return storedEventsJson === null ? [] : this.parse(storedEventsJson);
    }

    // Null when nothing is stored, or when the storage is switched off.
    protected readJson(): string | null {
        try {
            return window.sessionStorage.getItem(this.storageKey);
        } catch (error) {
            this.log(`the stored events cannot be read: ${error}`);

            return null;
        }
    }

    // A value that is not JSON, or entries that are not events, have nothing to send.
    protected parse(storedEventsJson: string): PendingEvent[] {
        let storedEvents: unknown;

        try {
            storedEvents = JSON.parse(storedEventsJson);
        } catch (error) {
            this.log(`the stored events cannot be read: ${error}`);

            return [];
        }

        if (!Array.isArray(storedEvents)) {
            return [];
        }

        return storedEvents.filter(isPendingEvent);
    }

    protected remove(): void {
        try {
            window.sessionStorage.removeItem(this.storageKey);
        } catch {
            // Storage that is switched off has nothing stored; reading it already reported that.
        }
    }
}
