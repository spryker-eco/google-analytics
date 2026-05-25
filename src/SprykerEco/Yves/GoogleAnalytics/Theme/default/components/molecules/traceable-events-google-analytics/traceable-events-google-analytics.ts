
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
        window.gtag = function gtag(): void {
            // eslint-disable-next-line prefer-rest-params
            window.dataLayer.push(arguments);
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
        const { searchTerm, resultsCount } = data.eventDetail;
        const hasNoResults = resultsCount === 0 && searchTerm;
        const eventName = hasNoResults ? 'zero_search_results' : 'search_results';
        
        if (!searchTerm) {
            return;
        }

        window.gtag('event', eventName, {
            search_term: searchTerm,
            event_category: 'Search results',
            event_label: hasNoResults ? 'No results' : 'Search results',
            results_count: resultsCount,
            store: this.currentStore,
            locale: this.currentLocale,
        });
    }

    protected get initialData(): InitialData {
        return JSON.parse(this.getAttribute('initial'));
    }
}
