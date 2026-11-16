// The query parameters Google Analytics reads for campaign attribution. Every other query parameter, and the fragment, is left out of
// the page URLs sent with every hit, as they may carry personal data, e.g. the token of a password reset link.
export const CAMPAIGN_QUERY_PARAMETERS: ReadonlySet<string> = new Set([
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'utm_id',
    'utm_source_platform',
    'utm_creative_format',
    'utm_marketing_tactic',
    'gclid',
    'gbraid',
    'wbraid',
    'dclid',
    '_gl',
]);

// A quote request page has the quote request reference in its path, e.g. /quote-request/details/DE--21-8, and in its title. The
// reference contains the customer reference, so it is left out of the page URLs and the title, for the agent's pages as well.
const QUOTE_REQUEST_REFERENCE_PATH_PATTERN = /(\/quote-request\/[\w-]+\/)([^/]+)/;

// Origin and path, and only the kept query parameters; an empty or invalid URL, e.g. no referrer, stays empty.
export const removePersonalDataFromUrl = (url: string, keptQueryParameters: ReadonlySet<string>): string => {
    let parsedUrl: URL;

    try {
        parsedUrl = new URL(url);
    } catch {
        return '';
    }

    const keptQuery = new URLSearchParams();

    for (const [name, value] of parsedUrl.searchParams) {
        if (keptQueryParameters.has(name)) {
            keptQuery.append(name, value);
        }
    }

    const query = keptQuery.toString();
    const path = parsedUrl.pathname.replace(QUOTE_REQUEST_REFERENCE_PATH_PATTERN, '$1');

    return query ? `${parsedUrl.origin}${path}?${query}` : `${parsedUrl.origin}${path}`;
};

// The title of a quote request page shows its reference, which the path of the page names.
export const removePersonalDataFromTitle = (title: string, pagePath: string): string => {
    const quoteRequestReferenceMatch = pagePath.match(QUOTE_REQUEST_REFERENCE_PATH_PATTERN);

    if (!quoteRequestReferenceMatch) {
        return title;
    }

    const quoteRequestReference = decodeURIComponent(quoteRequestReferenceMatch[2]);

    return title.split(quoteRequestReference).join('').trim();
};
