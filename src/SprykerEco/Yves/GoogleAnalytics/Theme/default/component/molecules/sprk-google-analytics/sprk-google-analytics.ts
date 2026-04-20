
import Component from "ShopUi/models/component";
import { SPRYKER_SEARCH_RESULTS, SPRYKER_ZERO_SEARCH_RESULTS_EVENT ,  SPRYKER_SEARCH_RESULTS_EVENT } from 'ShopUi/components/molecules/suggest-search';

declare function gtag(command: string, eventName: string, params: Record<string, string | number>): void;
export default class SprkGoogleAnalytics extends Component {
    protected readyCallback(): void {}

    protected init(): void {

    }

    protected mapEvents(): void {
        document.addEventListener(SPRYKER_ZERO_SEARCH_RESULTS_EVENT, (e) => this.sendData(e))
        document.addEventListener(SPRYKER_SEARCH_RESULTS_EVENT, (e) => this.sendData(e))
    }

    protected sendData(event): void {
        console.log(event);
        // gtag('event', SPRYKER_ZERO_SEARCH_RESULTS_EVENT, {
                    
        // });    
    }
}