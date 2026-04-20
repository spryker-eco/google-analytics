
import Component from "ShopUi/models/component";
import { SPRYKER_ZERO_SEARCH_RESULTS_EVENT ,  SPRYKER_SEARCH_RESULTS_EVENT } from 'ShopUi/components/molecules/suggest-search/suggest-search';

declare global {
  interface Window {
    gtag?: (command: 'event', eventName: string, params?: Record<string, unknown>) => void;
  }
}

export default class SprkGoogleAnalytics extends Component {
    protected readyCallback(): void {}

    protected init(): void {
        this.mapEvents();
    }

    protected mapEvents(): void {
        document.addEventListener(SPRYKER_ZERO_SEARCH_RESULTS_EVENT, (e) => this.sendData(e))
        document.addEventListener(SPRYKER_SEARCH_RESULTS_EVENT, (e) => this.sendData(e))
    }

    protected sendData(event: Event): void {
        const customEvent = event as CustomEvent<Record<string, unknown>>;

        const payload: Record<string, unknown> = {
            ...(customEvent.detail ?? {}),
            store: this.currentStore,
            locale: this.currentLocale,
        };

        window.gtag?.('event', event.type, payload);
    }


    protected get currentStore(): string {
        return this.dataset.store ?? '';
    }

    protected get currentLocale(): string {
        return this.dataset.locale ?? '';
    }
}