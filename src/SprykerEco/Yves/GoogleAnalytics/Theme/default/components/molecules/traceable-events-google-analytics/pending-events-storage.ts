import { debug } from 'ShopUi/app/logger';
import { PendingEvent } from './types';

// The events a page could not send before it was left, kept in the session storage of the tab for the next page.
export const STORED_EVENTS_KEY = 'traceable-events-google-analytics:pending-events';
// A tab whose gtag script never loads passes the events on from page to page; only the newest ones are kept.
export const MAX_STORED_EVENTS = 50;
// An event the tab could not send for this long is dropped: sent later, it would land in another session and at another time.
// 30 minutes.
export const MAX_PENDING_EVENT_AGE_MILLISECONDS = 1800000;

// Null when nothing is stored, or when the storage is switched off. `adapterName` names the adapter in the debug messages.
export const readStoredEventsJson = (storedEventsKey: string, adapterName: string): string | null => {
    try {
        return window.sessionStorage.getItem(storedEventsKey);
    } catch (error) {
        debug(`${adapterName}: the stored events cannot be read: ${error}`);

        return null;
    }
};

// Only the entries that are events are kept; the adapter passes its own check, so a project that overrides it decides.
export const parseStoredEvents = (
    storedEventsJson: string,
    adapterName: string,
    isPendingEvent: (value: unknown) => boolean = isPendingEventValue,
): PendingEvent[] => {
    let storedEvents: unknown;

    try {
        storedEvents = JSON.parse(storedEventsJson);
    } catch (error) {
        // A value that is not JSON has no events to send; the adapter removes it when it sends the stored events.
        debug(`${adapterName}: the stored events cannot be read: ${error}`);

        return [];
    }

    if (!Array.isArray(storedEvents)) {
        return [];
    }

    return storedEvents.filter((storedEvent: unknown): storedEvent is PendingEvent => isPendingEvent(storedEvent));
};

export const isPendingEventValue = (value: unknown): value is PendingEvent => {
    const pendingEvent = value as PendingEvent;

    return (
        typeof pendingEvent?.name === 'string' &&
        typeof pendingEvent.params === 'object' &&
        pendingEvent.params !== null &&
        typeof pendingEvent.raisedAt === 'number'
    );
};

// Replaces what is stored; storage that is switched off or full loses the events, as the navigation would, and tracking never
// breaks the page.
export const writeStoredEvents = (storedEventsKey: string, storedEvents: PendingEvent[], adapterName: string): void => {
    try {
        window.sessionStorage.setItem(storedEventsKey, JSON.stringify(storedEvents));
    } catch (error) {
        debug(
            `${adapterName}: ${storedEvents.length} pending events are lost, the session storage refused them: ${error}`,
        );
    }
};

export const removeStoredEvents = (storedEventsKey: string): void => {
    try {
        window.sessionStorage.removeItem(storedEventsKey);
    } catch {
        // Storage that is switched off has nothing stored; reading it already reported that.
    }
};

// The events raised within the maximum age; older ones are dropped.
export const getCurrentEvents = (
    storedEvents: PendingEvent[],
    maxPendingEventAgeMilliseconds: number,
    adapterName: string,
): PendingEvent[] => {
    const oldestRaisedAt = Date.now() - maxPendingEventAgeMilliseconds;
    const currentEvents = storedEvents.filter((storedEvent) => storedEvent.raisedAt >= oldestRaisedAt);

    if (currentEvents.length < storedEvents.length) {
        debug(
            `${adapterName}: ${storedEvents.length - currentEvents.length} stored events are older than the maximum age and dropped`,
        );
    }

    return currentEvents;
};
