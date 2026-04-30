
import {
    BaseTraceableEventAdapter,
    TraceableEventHandlers,
} from 'TraceableEventWidget/components/molecules/traceable-events-orchestrator/base-traceable-event-adapter';
import { EventsHandlerData, EventName } from 'TraceableEventWidget/components/molecules/traceable-events-orchestrator/traceable-events-orchestrator';

declare global {
    interface SPRYKER_EVENTS {
        SEARCH_EVENT: undefined;
    }

    interface Window {
        dataLayer: unknown[];
        gtag: GtagFunction;
    }
}

interface GtagFunction {
    (command: 'js', date: Date): void;
    (command: 'config', targetId: string, config?: Record<string, unknown>): void;
    (command: 'event', eventName: string, params?: Record<string, unknown>): void;
}

interface InitialData {
    appId: string;
    store: string;
    locale: string;
}

interface SearchEventData extends EventsHandlerData<EventName> {
    eventDetail: {
        searchTerm: string;
        eventCategory: string;
        eventLabel: string;
        resultsCount: number;
        eventName: string;
    }   
}

export default class TraceableEventsGoogleAnalytics extends BaseTraceableEventAdapter {
    protected currentStore = '';
    protected currentLocale = '';

    override init(): void {
        const { appId, store, locale } = this.initialData;

        this.currentStore = store;
        this.currentLocale = locale;

        window.dataLayer = window.dataLayer || [];
        window.gtag = (...args: unknown[]): void => {
            window.dataLayer.push(args);
        };
        window.gtag('js', new Date());
        window.gtag('config', appId);

        super.init();
    }

    override getHandlers(): Partial<TraceableEventHandlers> {
        return {
            SEARCH_EVENT: [this.searchEventHandler],
        };
    }

    protected searchEventHandler(data: SearchEventData): void {
        const { searchTerm, eventCategory, eventLabel = 'Search results', resultsCount = 0, eventName } = data.eventDetail;

        window.gtag('event', eventName, {
            search_term: searchTerm,
            event_category: eventCategory,
            event_label: eventLabel,
            results_count: resultsCount,
            store: this.currentStore,
            locale: this.currentLocale,
        });
    }

    protected get initialData(): InitialData {
        return JSON.parse(this.getAttribute('initial'));
    }
}
